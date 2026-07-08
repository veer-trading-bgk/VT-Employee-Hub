'use strict';

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { atomicIncrement } = require('../middleware/rateLimiter');
const { redactContext, scrubSensitivePatterns } = require('../utils/aiRedaction');
// Accessed as aiConfig.AI_CONFIG / aiConfig.PRICING (not destructured at require
// time) so every call reads the registry fresh — destructuring once here would
// otherwise silently freeze whichever values existed the instant this module
// first loaded.
const aiConfig = require('../config/aiConfig');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * AIService — the single governed entry point for every LLM call APForce makes
 * (ADR-015). No route, component, or other service may call an LLM provider
 * directly; every AI feature is a `useCase` entry in src/config/aiConfig.js plus a
 * call to generate() here, never a new method and never a new fetch() elsewhere.
 *
 * HARD BOUNDARY — this module has NO dependency on WhatsAppSendService and never
 * sends anything itself (ADR-012 owns all outbound sends exclusively). It also has
 * no dependency on WalletService in this phase: AI usage is fully covered by the
 * subscription plan today, so nothing here debits a wallet (see WalletService's own
 * doc comment — it exists as infrastructure for WhatsApp Calling's real per-minute
 * deduction, not wired to AI yet).
 */

// ── Public entry point ────────────────────────────────────────────────────────
// Deliberately NOT an async function: the two caller-bug validations below throw
// synchronously, before any Promise is created, so a caller that forgets
// companyId or typos a useCase name gets an immediate exception rather than a
// silently-rejected promise. Every expected runtime condition (disabled,
// rate-limited, provider error, invalid output) is instead returned as a typed
// { ok: false, reason, detail } result from the inner async function — generate()
// never throws for those.
function generate(params) {
  const { useCase, companyId } = params ?? {};
  if (!companyId) throw new Error('AIService.generate(): companyId is required');
  if (!useCase || !aiConfig.AI_CONFIG[useCase]) throw new Error(`AIService.generate(): unknown useCase "${useCase}"`);
  return _generate(params);
}

async function _generate({
  useCase, companyId, context = {}, user, conversationHistory = [], assigneeId,
  // Usage-attribution fields, all optional (2026-07-08, cost-audit Part 5) —
  // pure additive metadata on the AIUSAGE# record, never read by generate()'s
  // own logic. entityType/entityId let a future dashboard group cost by
  // conversation/employee/team/etc. instead of just useCase+date. source
  // defaults to 'production'; only PromptTestService's compliance-test call
  // sites pass 'admin_test', so real customer/employee traffic is never
  // miscounted as a test artifact (see 19_DECISION_LOG.md Era 32 addendum —
  // this is exactly the blending problem the cost audit found).
  //
  // Known limitation (2026-07-08, see 19_DECISION_LOG.md Era 36): 'admin_test'
  // only distinguishes PromptTestService/testKnowledgeEntry's own compliance-
  // gate calls. It does NOT distinguish an admin manually testing the bot via
  // real WhatsApp messages (which calls this same generate() path with
  // source defaulting to 'production', identical to genuine customer
  // traffic) from an actual external customer. Era 36 found every real
  // 'production'-tagged conversational-sales-agent record for viir_trading
  // to date is the account holder's own test traffic, indistinguishable from
  // a real customer by this field alone. Documented as a known gap, not
  // designed around here.
  entityType, entityId, source = 'production',
}) {
  const useCaseCfg = aiConfig.AI_CONFIG[useCase];

  // 1. Master switch, then module switch — read fresh every call, no caching, so
  //    toggling either off takes effect on the very next request.
  const aiCfg = await _getAIConfig(companyId);
  if (!aiCfg.masterEnabled) {
    return { ok: false, reason: 'disabled_master', detail: 'AI is disabled for this company (master switch is off).' };
  }
  if (aiCfg.moduleToggles[useCase] === false) {
    return { ok: false, reason: 'disabled_usecase', detail: `The "${useCase}" AI feature is disabled for this company.` };
  }

  // 2. Per-company/per-useCase rate limit — reuses rateLimiter.js's atomicIncrement
  //    directly rather than reinventing atomic-counter DynamoDB semantics.
  const { limit, windowMs } = useCaseCfg.rateLimit;
  const rlWindowKey = `window#${Math.floor(Date.now() / windowMs) * windowMs}`;
  const rlCount = await atomicIncrement(`ai_ratelimit#${companyId}#${useCase}`, rlWindowKey, windowMs);
  if (rlCount > limit) {
    return { ok: false, reason: 'rate_limited', detail: 'AI rate limit exceeded for this feature — try again shortly.' };
  }

  // 3. Monthly free-call quota — LOGS ONLY in this phase. AI usage is fully
  //    covered by the subscription plan today; crossing 300 calls/month does not
  //    block or charge anything yet (see PRICING.freeCallsPerMonth). This is the
  //    seam real metering attaches to later without a second migration.
  const monthKey = `month#${new Date().toISOString().slice(0, 7)}`;
  const quotaCount = await atomicIncrement(`ai_quota#${companyId}`, monthKey, 32 * 24 * 3600 * 1000);
  const overQuota = quotaCount > aiConfig.PRICING.freeCallsPerMonth;
  if (overQuota) {
    logger.info(`AIService: company ${companyId} crossed the free monthly AI-call quota (useCase: ${useCase}, count: ${quotaCount}) — logged only, not gated or charged in this phase.`);
  }

  // 4. PII/sensitive-data redaction — mandatory, default-safe. Field denylist runs
  //    before the prompt template ever sees context; a useCase may opt a specific
  //    field back in only with a logged justification (audit trail for the opt-out).
  const allowFields = useCaseCfg.redaction?.allowFields ?? [];
  if (allowFields.length > 0) {
    logger.info(`AIService: useCase "${useCase}" opts out of redacting [${allowFields.join(', ')}] — justification: ${useCaseCfg.redaction.justification}`);
  }
  const redactedContext = redactContext(context, allowFields);

  // 5. Assemble the prompt. localeAware/outputMode instructions are appended here
  //    (generic, useCase-agnostic wording) rather than duplicated in every
  //    promptTemplate. The pattern-scrub below is unconditional, no opt-out —
  //    defense-in-depth for a PAN/Aadhaar value that leaked in through a freeform
  //    field the denylist wouldn't have seen (e.g. a lead's notes).
  let promptText = useCaseCfg.promptTemplate(redactedContext);
  if (useCaseCfg.localeAware && redactedContext.preferredLanguage) {
    promptText += `\n\nRespond in ${redactedContext.preferredLanguage}.`;
  }
  if (useCaseCfg.outputMode === 'json') {
    promptText += '\n\nRespond with ONLY a single valid JSON object matching the shape described above — no prose, no markdown code fences.';
  }
  promptText = scrubSensitivePatterns(promptText);

  const scrubbedHistory = conversationHistory.map((m) => ({ ...m, content: scrubSensitivePatterns(m.content) }));
  const messages = [...scrubbedHistory, { role: 'user', content: promptText }];

  // 6. Call Anthropic — structured (JSON) mode gets one automatic retry-then-degrade
  //    on invalid output; a caller never sees raw, unvalidated JSON.
  let inputTokens;
  let outputTokens;
  let data;
  let jsonFailed = false;
  let attempts;
  try {
    if (useCaseCfg.outputMode === 'json') {
      const jsonResult = await _generateJsonWithRetry({
        model: useCaseCfg.model, maxTokens: useCaseCfg.maxTokens, messages, schema: useCaseCfg.schema,
      });
      inputTokens = jsonResult.inputTokens;
      outputTokens = jsonResult.outputTokens;
      attempts = jsonResult.attempts;
      if (jsonResult.ok) data = jsonResult.data;
      else jsonFailed = true;
    } else {
      const res = await _callAnthropic({ model: useCaseCfg.model, maxTokens: useCaseCfg.maxTokens, messages });
      inputTokens = res.usage?.input_tokens ?? 0;
      outputTokens = res.usage?.output_tokens ?? 0;
      data = _extractText(res);
      attempts = 1; // text mode has no retry loop — always exactly one call
    }
  } catch (err) {
    return { ok: false, reason: 'provider_error', detail: err.message };
  }

  // 7. Usage tracking — logged whenever real tokens were spent, regardless of
  //    whether JSON validation ultimately succeeded (the model call itself
  //    happened either way). Never blocks or throws on a logging failure.
  const { costUsd, walletPoints, inputRatePerMillion, outputRatePerMillion } = _computeCost({ model: useCaseCfg.model, inputTokens, outputTokens });
  await _logUsage({
    companyId, useCase, promptVersion: useCaseCfg.promptVersion, model: useCaseCfg.model,
    inputTokens, outputTokens, costUsd, walletPoints, userId: user.id, overQuota,
    entityType, entityId, source, attempts, inputRatePerMillion, outputRatePerMillion,
  });

  if (jsonFailed) {
    return { ok: false, reason: 'invalid_output', detail: 'Model did not return valid JSON matching the required schema after a retry.' };
  }

  return {
    ok: true,
    data,
    usage: {
      inputTokens, outputTokens, costUsd, walletPoints,
      model: useCaseCfg.model, promptVersion: useCaseCfg.promptVersion,
    },
  };
}

// ── Internals ──────────────────────────────────────────────────────────────────

async function _getAIConfig(companyId) {
  const r = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#AI#${companyId}`, SK: 'CURRENT' },
  }).promise();
  const item = r.Item;
  // No row yet → default to enabled. AI already works today (metrics-insights is
  // live, ungated); a company shouldn't lose it just because nobody has opened the
  // Settings > AI tab yet. The master switch is an opt-out kill switch, not opt-in.
  return { masterEnabled: item?.masterEnabled ?? true, moduleToggles: item?.moduleToggles ?? {} };
}

async function _callAnthropic({ model, maxTokens, messages }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${errText}`);
  }
  return response.json();
}

// Anthropic's response `content` array is not always [{type:'text',...}] at
// index 0 — a model may emit a `thinking` block first (seen live, 2026-07-06,
// with claude-sonnet-5, intermittently — the model decides per-call, not a
// request flag this codebase sets). Blindly reading content[0].text silently
// produced '' whenever that happened, which _generateJsonWithRetry then burned
// its one retry on and still failed — a live, intermittent bug across every
// json-mode AND text-mode useCase, not just one. Find the text block by type.
function _extractText(res) {
  const block = (res.content ?? []).find((b) => b.type === 'text');
  return block?.text ?? '';
}

function _tryParseJson(text) {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
}

const JSON_RETRY_CORRECTION = 'That was not valid JSON matching the required schema. Respond again with ONLY a single valid JSON object — no prose, no markdown fences.';

/**
 * Up to 2 total attempts: the original call, and one corrective retry on
 * invalid output. `attempts` (1 or 2) is the real observed retry outcome —
 * not inferred later from token counts — so a future dashboard can measure
 * actual retry rate per useCase directly instead of guessing from a doubled
 * output-token total.
 */
async function _generateJsonWithRetry({ model, maxTokens, messages, schema }) {
  let workingMessages = messages;
  let cumulativeInput = 0;
  let cumulativeOutput = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await _callAnthropic({ model, maxTokens, messages: workingMessages });
    cumulativeInput += res.usage?.input_tokens ?? 0;
    cumulativeOutput += res.usage?.output_tokens ?? 0;
    const rawText = _extractText(res);

    const parsed = _tryParseJson(rawText);
    if (parsed !== undefined) {
      const validation = schema.safeParse(parsed);
      if (validation.success) {
        return { ok: true, data: validation.data, inputTokens: cumulativeInput, outputTokens: cumulativeOutput, attempts: attempt + 1 };
      }
    }

    workingMessages = [
      ...workingMessages,
      { role: 'assistant', content: rawText },
      { role: 'user', content: JSON_RETRY_CORRECTION },
    ];
  }

  return { ok: false, inputTokens: cumulativeInput, outputTokens: cumulativeOutput, attempts: 2 };
}

function _computeCost({ model, inputTokens, outputTokens }) {
  const rates = aiConfig.PRICING.models[model];
  if (!rates) return { costUsd: 0, walletPoints: 0, inputRatePerMillion: null, outputRatePerMillion: null };
  const rawCost = (inputTokens / 1e6) * rates.inputPerMillion + (outputTokens / 1e6) * rates.outputPerMillion;
  const costUsd = rawCost * aiConfig.PRICING.marginMultiplier;
  const walletPoints = Math.ceil(costUsd * aiConfig.PRICING.pointsPerUsd);
  // Snapshot the exact rate used, so a future PRICING.models change (e.g. an
  // intro-rate expiry) can never silently reprice this specific historical
  // record if anyone recomputes cost from it later (Era 40, 19_DECISION_LOG.md).
  return { costUsd, walletPoints, inputRatePerMillion: rates.inputPerMillion, outputRatePerMillion: rates.outputPerMillion };
}

async function _logUsage({
  companyId, useCase, promptVersion, model, inputTokens, outputTokens, costUsd, walletPoints, userId, overQuota,
  entityType, entityId, source, attempts, inputRatePerMillion, outputRatePerMillion,
}) {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  try {
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `AIUSAGE#${companyId}#${date}`,
        SK: `${now}#${useCase}`,
        companyId, useCase, promptVersion, model, inputTokens, outputTokens, costUsd, walletPoints, userId, overQuota,
        createdAt: now, source, attempts,
        // Optional, additive (2026-07-08) — omitted entirely rather than
        // written as null/undefined when a caller doesn't have one, so
        // every pre-existing record shape and every caller that hasn't been
        // updated yet stays byte-identical to before this change.
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        // Rate snapshot (2026-07-08, Era 40) — omitted when PRICING had no
        // entry for this model at write time (costUsd is 0 in that case
        // too), so a genuine historical pricing-gap record stays
        // distinguishable from a normal, correctly-priced call.
        ...(inputRatePerMillion != null ? { inputRatePerMillion } : {}),
        ...(outputRatePerMillion != null ? { outputRatePerMillion } : {}),
      },
    }).promise();
  } catch (err) {
    logger.error('AIService: failed to write AIUSAGE# record', err.message);
  }
}

module.exports = { generate };
