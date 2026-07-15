'use strict';

const { z } = require('zod');

/**
 * Use-case registry for AIService.generate() — per ADR-015 Rule 3. Adding a new AI
 * feature is a new entry here plus a caller; it is never a new method on AIService
 * and never a new fetch() call anywhere else in the codebase.
 *
 * Field meaning:
 *   model            — Anthropic model id, never hardcoded at a call site.
 *   maxTokens         — passed straight through to the Messages API.
 *   promptVersion     — bumped by hand whenever promptTemplate's text changes; written
 *                       onto every AIUSAGE# record for compliance auditability.
 *   promptTemplate    — (context) => string. Receives the ALREADY-REDACTED context
 *                       (AIService redacts before calling this) and returns the full
 *                       prompt text. No prompt string is ever built outside this file.
 *   outputMode        — 'text' (raw string returned as-is) | 'json' (parsed +
 *                       validated against `schema` before ever reaching the caller).
 *   schema            — required when outputMode is 'json'; a zod schema.
 *   rateLimit         — { limit, windowMs } passed to rateLimiter's atomicIncrement().
 *   customerFacing    — whether this useCase's output is itself a customer-facing
 *                       action (vs. an internal report the requesting user reads
 *                       directly). No approval-routing behavior reads this anymore
 *                       (removed 2026-07-06 — see 19_DECISION_LOG.md: customer
 *                       replies now send directly, no human-in-the-loop gate) —
 *                       kept purely as a label for anyone auditing which useCases
 *                       produce content a real customer sees.
 *   localeAware       — whether to append a "respond in {preferredLanguage}"
 *                       instruction when the caller supplies one. Only useCases
 *                       generating real customer-facing prose need this; internal/
 *                       employee-facing English-only output sets it false.
 */
// Phase 2A / PR 1 — turns AI Administration's Conversation-tab settings into
// prompt text, ADDITIVELY: returns '' (no extra text at all) when every field
// is still at its aiAdminConversationSchema default, so a company that never
// opens AI Administration gets byte-identical prompt output to before this
// PR existed. Only conversational-sales-agent's promptTemplate calls this —
// kept here, not duplicated, since it's specific to that one prompt's shape.
const PERSONA_TEXT = {
  professional_rm: null, // default — the base persona line above already says this
  friendly_advisor: 'Lean warmer and more casual than a typical RM — still professional, just friendlier.',
  concise_expert: 'Lean terser and more matter-of-fact — an expert who values the customer\'s time above rapport-building.',
};
const TONE_TEXT = {
  professional: null, // default
  friendly: 'Tone: friendly and warm.',
  formal: 'Tone: more formal than the examples above — fewer emoji, more measured phrasing.',
  casual: 'Tone: casual and relaxed, like texting a friend who happens to be your RM.',
};
const STYLE_TEXT = {
  concise: null, // default — the STYLE section above already specifies this
  balanced: 'You may use up to 3 short lines when it genuinely helps, not just 1-2.',
  detailed: 'More detail is welcome here than the default style guide above — still WhatsApp-appropriate, not an essay.',
};
function _buildConversationAdjustments({ persona, tone, languageRules, conversationStyle, qualificationRules }) {
  const lines = [
    PERSONA_TEXT[persona] ?? null,
    TONE_TEXT[tone] ?? null,
    STYLE_TEXT[conversationStyle] ?? null,
    languageRules?.trim() ? `Language rules: ${languageRules.trim()}` : null,
    qualificationRules?.trim() ? `Additional qualification guidance: ${qualificationRules.trim()}` : null,
  ].filter(Boolean);
  if (lines.length === 0) return '';
  return `\nADMIN-CONFIGURED ADJUSTMENTS (from AI Administration > Conversation):\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
}

// 'metrics-insights' and 'team-metrics-insights' useCase entries removed
// 2026-07-08 (Era 33, 19_DECISION_LOG.md) — deliberate product decision to
// disconnect AI from these two features, not a bug fix. Both worked
// correctly right up to this change; there was simply no real caller for
// either (dashboard has zero live UI for them — see Era 33). The routes
// (src/routes/ai.js), their tests, and the AI Administration toggle labels
// (AISection.tsx) are all intentionally left in place, unlike the full
// removal precedent set for ApprovalService in Era 21 — see Era 33 for why
// this case deviates from that precedent. Removing these two entries here
// is the actual "cut the AI service" action; POST /insights and
// POST /team-insights now short-circuit before ever reaching
// AIService.generate() (which throws synchronously for an unknown useCase).
const AI_CONFIG = {
  // AI Inbox — classifies an inbound WhatsApp message's intent so agents/queues
  // can triage faster. customerFacing: false — this only labels the conversation
  // internally, it never drafts or sends anything a customer sees, so it never
  // engages the approval gate (point 7 of ADR-015 only applies to customerFacing
  // useCases). Triggered once per conversation (see IntentDetectionService),
  // never on every message — a cost/noise tradeoff, not a technical limit.
  'inbox-intent-detection': {
    provider: 'bedrock-nova', // 2026-07-14 full Nova migration — see 19_DECISION_LOG.md
    model: 'apac.amazon.nova-lite-v1:0', // was 'claude-haiku-4-5-20251001' (Anthropic path dormant; revert = provider:'anthropic' + that model)
    maxTokens: 60,
    promptVersion: 'v1',
    outputMode: 'json',
    schema: z.object({
      intent: z.enum([
        'interested', 'not_interested', 'kyc_query', 'pricing_question',
        'complaint', 'support_request', 'renewal_inquiry', 'other',
      ]),
      confidence: z.number().min(0).max(1),
    }),
    customerFacing: false,
    localeAware: false,
    rateLimit: { limit: 60, windowMs: 60_000 },
    promptTemplate: (context) => {
      const { message } = context;
      return `You are classifying the intent of an inbound WhatsApp message sent by a customer to a stock broking / trading services company.

Classify the message into EXACTLY ONE of these categories:
- interested: general interest in opening an account or using services
- not_interested: explicitly declining or opting out
- kyc_query: questions about the KYC process, documents, or status
- pricing_question: questions about brokerage, fees, or charges
- complaint: dissatisfaction, a service issue, or a negative experience
- support_request: technical/app/platform help needed (not a complaint)
- renewal_inquiry: AMC or subscription renewal questions
- other: anything that doesn't clearly fit the above

CUSTOMER MESSAGE:
"""
${message}
"""

Respond with a JSON object: { "intent": "<one of the 8 categories above>", "confidence": <a number between 0 and 1> }`;
    },
  },

  // AI-Assisted Template Creation — drafts a Meta-compliant WhatsApp template
  // from an admin's plain-language description. customerFacing: false — the
  // output is a DRAFT an admin reviews/edits, then explicitly saves, then
  // explicitly submits to Meta for Meta's own independent multi-day review,
  // then explicitly sends to any real customer later. At least three separate
  // human/external gates sit between this output and any customer, none of
  // which this useCase touches — categorically an internal-analyst-output
  // case (same bucket as metrics-insights), never a customer-facing action.
  'template-creation': {
    provider: 'bedrock-nova', // 2026-07-14 full Nova migration — see 19_DECISION_LOG.md
    model: 'apac.amazon.nova-lite-v1:0', // was 'claude-haiku-4-5-20251001' (Anthropic path dormant; revert = provider:'anthropic' + that model)
    maxTokens: 700,
    promptVersion: 'v1',
    outputMode: 'json',
    schema: z.object({
      name: z.string().min(1).max(512),
      category: z.enum(['MARKETING', 'UTILITY']),
      categoryReasoning: z.string().min(1).max(300),
      bodyText: z.string().min(1).max(1024),
      bodyVariables: z.array(z.object({
        example: z.string(),
        description: z.string(),
      })).max(25),
      headerText: z.string().max(60).optional(),
      footerText: z.string().max(60).optional(),
      buttons: z.array(z.object({
        type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']),
        text: z.string().max(25),
        url: z.string().optional(),
        phoneNumber: z.string().optional(),
      })).max(3).optional(),
    }),
    customerFacing: false,
    localeAware: false, // the target language is explicit context (below), not an
                         // append-to-the-end instruction — this useCase's whole
                         // output IS the requested language, not commentary about it
    rateLimit: { limit: 10, windowMs: 60_000 }, // matches /templates/:id/submit's
                                                 // cadence — a deliberate admin
                                                 // action, not per-message traffic
    promptTemplate: (context) => {
      const { description, language } = context;
      return `You are drafting a WhatsApp Business message template for a fintech company (VT Trading), for an admin to review and edit before ever submitting it to Meta for approval.

ADMIN'S REQUEST:
"""
${description}
"""

TARGET LANGUAGE: ${language || 'en'} (write bodyText/headerText/footerText in this language)

You MUST follow these rules exactly — they are APForce's own enforced limits, some stricter than Meta's general limits, because APForce's editor validates against these specific numbers:

CATEGORY — choose exactly one of MARKETING or UTILITY (never AUTHENTICATION: Meta auto-generates OTP template bodies itself, there is nothing for you to draft there):
- UTILITY requires BOTH: (a) non-promotional, no persuasive or promotional intent, AND (b) tied to a specific user's order/account, or safety-essential. Order confirmations, delivery updates, account alerts, and purely informational reminders are UTILITY.
- MARKETING is anything with promotional or persuasive intent — including a message that is otherwise a plain reminder but adds an incentive. Concretely: "Your policy #{{2}} expires on {{3}}" is UTILITY; "Your policy expires soon — renew now and get 10% off" is MARKETING, because offering an incentive to secure a renewal is explicitly promotional even though the underlying event is account-specific.
- Set categoryReasoning to a short, specific explanation of why you picked this category for THIS content — the admin reads this to sanity-check your choice before ever saving, since miscategorization has real cost consequences.

BODY TEXT:
- Maximum 1024 characters.
- Variables use ONLY the positional placeholder format {{1}}, {{2}}, {{3}} — never named placeholders like {{first_name}}. Numbers must start at 1 and be sequential with no gaps or repeats.
- Provide one entry in bodyVariables per placeholder, in order, each with a realistic example value and a short description of what it represents.
- The body must contain real static text, not consist entirely of variables.
- Never use excessive punctuation, ALL CAPS runs, or spam-like phrasing.

HEADER (optional): plain text only, maximum 60 characters, at most one variable. Do not propose an image/video/document header — you cannot supply real media.

FOOTER (optional): maximum 60 characters, no variables allowed in the footer.

BUTTONS (optional, at most 3 total): each of type QUICK_REPLY, URL, or PHONE_NUMBER, button text maximum 25 characters. Never mix QUICK_REPLY with URL/PHONE_NUMBER buttons in the same template — Meta rejects that combination. Only include a URL button with a real url, or a PHONE_NUMBER button with a real phoneNumber, if the admin's request explicitly gave you that value — you do not know this company's actual website or phone number, so never invent either one; prefer QUICK_REPLY or omit buttons entirely rather than fabricate a URL or phone number.

Respond with ONLY a single JSON object matching this shape: { "name": string, "category": "MARKETING"|"UTILITY", "categoryReasoning": string, "bodyText": string, "bodyVariables": [{ "example": string, "description": string }], "headerText"?: string, "footerText"?: string, "buttons"?: [{ "type": "QUICK_REPLY"|"URL"|"PHONE_NUMBER", "text": string, "url"?: string, "phoneNumber"?: string }] }`;
    },
  },

  // AI Template Suggestions in Chat — the AI picks the best-fitting APPROVED
  // template from the existing registry (never authors free text — v1 is
  // deliberately template-only) and fills its variables. Sends directly via
  // WhatsAppSendService (src/routes/whatsapp.js's POST /inbox/suggest-reply) —
  // no human review step of any kind since 2026-07-06 (see 19_DECISION_LOG.md:
  // the prior approval-queue/agent-send-click gate was removed at the business
  // owner's explicit, informed direction). confidence is still generated and
  // still logged to the audit trail for oversight, but no longer gates or holds
  // anything — there is no "held for review" destination left to route to.
  'inbox-template-suggestion': {
    provider: 'bedrock-nova', // 2026-07-14 full Nova migration — see 19_DECISION_LOG.md
    model: 'apac.amazon.nova-lite-v1:0', // was 'claude-haiku-4-5-20251001' (Anthropic path dormant; revert = provider:'anthropic' + that model)
    maxTokens: 500,
    promptVersion: 'v2',
    outputMode: 'json',
    schema: z.object({
      hasSuggestion: z.boolean(),
      templateId: z.string().optional(),
      variableValues: z.array(z.string()).optional(),
      reasoning: z.string().min(1).max(300),
      confidence: z.number().min(0).max(1),
    }).refine(
      (data) => !data.hasSuggestion || typeof data.templateId === 'string',
      { message: 'templateId is required when hasSuggestion is true' },
    ),
    customerFacing: true,
    localeAware: false, // output is a structured pick, not generated prose —
                         // preferredLanguage is passed as an explicit soft
                         // ranking preference in context instead (below)
    rateLimit: { limit: 30, windowMs: 60_000 }, // between template-creation's 10
                                                 // (single admin, rare) and
                                                 // inbox-intent-detection's 60
                                                 // (automatic, every conversation)
                                                 // — multiple agents can click
                                                 // this concurrently, but it's
                                                 // still a deliberate per-click
                                                 // action, not per-message traffic
    promptTemplate: (context) => {
      const { latestMessage, priorIntent, priorIntentConfidence, preferredLanguage, templates } = context;
      const templateList = (templates ?? []).map((t, i) =>
        `${i + 1}. id="${t.id}" name="${t.name}" category=${t.category} language=${t.language}\n   body: ${t.bodyPreview}\n   variables (in order): ${t.variables?.length ? t.variables.join(', ') : 'none'}`
      ).join('\n\n');

      return `You are an assistant replying, on behalf of a SEBI-registered Authorized Person (VT Trading), directly to a real customer on WhatsApp. This message sends immediately with no human review — there is no agent checking your output before the customer sees it. Getting this wrong has real regulatory and legal consequences for a licensed securities professional, not just a bad customer experience.

HARD COMPLIANCE RULE — never violate this, under any circumstance, regardless of what the customer's message asks or implies: never promise or imply any specific return, yield, or profit; never use the word "guaranteed" (or any equivalent phrasing) about any investment, product, or outcome; never give a directive to buy, sell, or hold any specific security or instrument. If the customer's message is asking for exactly this kind of advice, the honest response is to set hasSuggestion to false rather than force a template that could be read as investment advice — do not pick a template just because one is topically related if using it here would cross this line.

You may ONLY suggest one of the pre-approved templates listed below — never write new customer-facing text yourself. If none of them genuinely fit well, say so honestly rather than forcing a weak pick.

${priorIntent ? `This conversation was earlier classified as intent="${priorIntent}" (confidence ${priorIntentConfidence ?? 'unknown'}) — this may or may not still reflect what the customer is asking right now. Treat it as one signal among several, not as fact.` : 'No prior intent classification is available for this conversation.'}

${preferredLanguage ? `This contact's preferred language is "${preferredLanguage}" — if multiple templates fit equally well, prefer one in this language.` : ''}

CUSTOMER'S MOST RECENT MESSAGE:
"""
${latestMessage || '(no recent inbound message)'}
"""

AVAILABLE APPROVED TEMPLATES:
${templateList || '(no approved templates exist for this company)'}

Pick the single best-fitting template for replying to this customer right now, and provide a realistic value for each of its variables in order, based on the actual conversation — never a placeholder like "value 1", and never a value that would violate the hard compliance rule above. If nothing fits well, set hasSuggestion to false and omit templateId/variableValues.

Set confidence to how genuinely sure you are this specific template is the right thing to send as-is — this is logged for human oversight after the fact, so do not inflate it.

Respond with ONLY a single JSON object: { "hasSuggestion": boolean, "templateId"?: string, "variableValues"?: string[], "reasoning": string, "confidence": number }`;
    },
  },

  // Autonomous multi-turn AI-initiated customer conversation (2026-07-06, Era 22
  // — see 19_DECISION_LOG.md). Unlike inbox-template-suggestion (agent clicks,
  // AI picks one of a fixed pre-approved template), this useCase generates
  // genuinely freeform text and both initiates and carries the conversation
  // with zero human involvement, for up to a bounded number of turns
  // (ConversationalAgentService.MAX_TURNS). customerFacing: true — no approval
  // gate exists to route to (removed entirely in Era 21); the compliance rule
  // below is the content-level control, and ConversationalAgentService's
  // deterministic keyword-based escalation check (never model-judgment-based,
  // by explicit design) is the human-availability control WhatsApp's own
  // Business Messaging Policy requires ("must also have available prompt,
  // clear, and direct escalation paths").
  //
  // Originally model: claude-sonnet-5, not claude-haiku-4-5 like every other
  // useCase here — a deliberate departure, because this useCase carries the
  // highest compliance stakes in the codebase (a live, unsupervised,
  // multi-turn conversation enforcing a nuanced regulatory boundary —
  // "explain what an IPO is" vs. "tell me whether to apply" is a real
  // distinction a model has to hold reliably across an entire conversation,
  // not just resist once) — instruction-following reliability on a nuanced
  // constraint was judged worth the extra cost/latency here specifically.
  // 2026-07-08: switched to claude-haiku-4-5-20251001 as a deliberate,
  // approved pre-launch cost trial (see the `model:` line below) — re-verified
  // against the same 5-question adversarial suite with no regression before
  // making the change. See 19_DECISION_LOG.md.
  'conversational-sales-agent': {
    provider: 'bedrock-nova', // 2026-07-14 full Nova migration — revert = provider:'anthropic' + the prior model (path dormant, not deleted)
    model: 'apac.amazon.nova-lite-v1:0', // 2026-07-14: was claude-haiku-4-5-20251001, which was — 2026-07-08: switched from claude-sonnet-5 —
    // deliberate, approved pre-launch cost trial (no real customers on this
    // useCase yet). 5-question adversarial suite re-verified against Haiku
    // with no regression vs. the Sonnet baseline. See 19_DECISION_LOG.md.
    // Rollback: revert this string to 'claude-sonnet-5'.
    maxTokens: 700, // 2026-07-08 (cost-audit retry-rate fix): raised from 600 —
                     // a small safety margin alongside the new reasoning-brevity
                     // instruction below, not a reduction in conciseness
                     // enforcement (still enforced by prompt + schema max
                     // length, same as before). kept at v1's original 600 for
                     // over a month; live data showed ~4.3% of real calls were
                     // hitting the 600-token ceiling mid-generation on
                     // compliance-sensitive turns whose reasoning ran long,
                     // forcing a full 2nd-attempt retry (double cost) on those
                     // calls — see 19_DECISION_LOG.md. This headroom is a
                     // complement to the brevity instruction, not a
                     // replacement: still watch for the same "thinking" block
                     // interaction noted below.
                     //
                     // Historical note (v1 rationale, still true): this model
                     // sometimes emits an internal "thinking" block that also
                     // counts against maxTokens (see AIService.js's
                     // _extractText fix); starving the total budget to enforce
                     // conciseness risks truncating the actual JSON reply
                     // before it's even written.
    promptVersion: 'v9', // v9 (2026-07-15): KNOWN SO FAR re-anchor tightened — the
                         // "confirm it in passing / still the plan?" clause that
                         // sanctioned re-asking already-known product interest (the
                         // root of the viir_trading re-ask loop, 19_DECISION_LOG.md)
                         // is replaced with a firm "do NOT re-ask / re-confirm /
                         // re-offer options for anything listed here." The PROVISIONAL
                         // latest-message-wins guard and ALL HARD COMPLIANCE RULE text
                         // are byte-identical to v8.
                         // v8 (2026-07-14): base-prompt cost trim — STYLE, PRODUCT
                         // SCOPE, and the WHO-YOU-ARE examples were compressed to cut
                         // per-turn input tokens (re-sent every turn). The 5 HARD
                         // COMPLIANCE RULES + their preamble + closing sentence, and
                         // PRODUCT SCOPE's neutrality sentence, are BYTE-IDENTICAL to
                         // v7 — no compliance wording was touched for cost. History:
                         // 2026-07-06 same-day: v2 was the production-readiness
                         // tuning pass (concise/WhatsApp-native style, see
                         // 19_DECISION_LOG.md Era 22 addendum). v3 added the
                         // additive, opt-in Conversation-tab adjustments block
                         // (Phase 2A / PR 1). v4 adds the additive, opt-in
                         // Prompt Management addendum (Phase 2A / PR 2),
                         // gated behind PromptTestService's live-generation
                         // test before it can ever reach this template. v5
                         // (2026-07-07) adds the additive, opt-in Structured
                         // Knowledge Center entries (Phase 2A / PR 3), matched
                         // per-turn by keyword and gated behind the same
                         // PromptTestService test before publish. v6
                         // (2026-07-07, RAG PR C) adds the additive, opt-in
                         // REFERENCE DOCUMENT EXCERPTS section (uploaded
                         // Document Knowledge chunks) — deliberately its own,
                         // less-trusted section AFTER Knowledge Center
                         // entries, never gated by PromptTestService (only
                         // publish-time's cheaper, non-blocking guardrail
                         // scan — see 19_DECISION_LOG.md Era 30/31), and
                         // never able to displace an entry. v7 (2026-07-08,
                         // cost-audit retry-rate fix) adds one sentence
                         // instructing brevity on the `reasoning` field only
                         // (audit-only, never customer-facing) to cut the
                         // ~4.3% retry rate found in real data — the
                         // customer-facing `reply` and all HARD COMPLIANCE
                         // RULES content are byte-identical to v6. A company
                         // that never configures any of the opt-in sections
                         // above still gets identical text to v2 plus this
                         // one new sentence.
    outputMode: 'json',
    schema: z.object({
      reply: z.string().min(1).max(500), // tightened from 1000 (v1) — a
                                          // technical backstop matching the
                                          // "extremely concise" style rule;
                                          // still enough room for a short
                                          // bulleted list, not a paragraph
      qualified: z.boolean(),
      productInterest: z.array(z.string()).default([]),
      budgetAmount: z.number().nullable().default(null),
      timelineDays: z.number().nullable().default(null),
      reasoning: z.string().min(1).max(500), // widened from 300 — live testing
      // showed compliance-sensitive turns (e.g. declining a specific-stock
      // request per the hard rules) naturally produce a longer justification;
      // at 300 this field alone (audit-only, never sent to the customer)
      // exhausted both JSON-retry attempts and discarded the ENTIRE customer
      // reply on exactly the turns where getting a reply right matters most.
    }),
    customerFacing: true,
    localeAware: true, // this IS generated prose, unlike inbox-template-suggestion's
                        // structured pick — a real customer conversation should
                        // follow their preferred language when known
    rateLimit: { limit: 60, windowMs: 60_000 }, // automatic, every inbound message,
                                                 // same cadence class as
                                                 // inbox-intent-detection
    promptTemplate: (context) => {
      const {
        latestMessage, turnNumber, maxTurns, preferredLanguage,
        // Phase 2A / PR 1 — AI Administration's Conversation tab
        // (CONFIG#CONVPROMPT). Defaults below match aiAdminConversationSchema's
        // own defaults exactly — a company that never opens AI Administration
        // gets these values and, per _buildConversationAdjustments, zero extra
        // prompt text: byte-identical output to before this PR existed.
        persona = 'professional_rm', tone = 'professional', languageRules = '',
        conversationStyle = 'concise', qualificationRules = '',
        // Phase 2A / PR 2 — Prompt Management's addendum (CONFIG#PROMPTADDENDUM).
        // Free text, unlike the bounded fields above — kept in its own clearly
        // subordinate section (after the hard rules, not folded into
        // _buildConversationAdjustments) rather than trusted at the same level.
        // Empty/absent renders nothing: byte-identical to v3 for a company that
        // never publishes one.
        promptAddendum = '',
        // Phase 2A / PR 3 — Structured Knowledge Center (CONFIG#KNOWLEDGE#*).
        // Already filtered to this turn's keyword-matched, published entries
        // by the caller (KnowledgeService.getMatchingEntries) — this template
        // only renders what it's given, it does not itself decide relevance.
        // Empty/absent renders nothing: byte-identical to v4 for a company
        // that has no matching (or no) entries.
        knowledgeEntries = [],
        // RAG PR C — Document Knowledge chunks (KNOWLEDGE_DOCUMENT_CHUNKS#*).
        // Already ranked+capped by the caller (DocumentChunkRetrievalService.
        // getMatchingChunks) — this template only renders what it's given,
        // same "caller decides relevance" stance as knowledgeEntries above.
        // Deliberately additive to knowledgeEntries, never a replacement for
        // it: rendered in its own, separate, lower-trust section below (see
        // knowledgeSection/documentExcerptsSection ordering) because chunks
        // never pass PromptTestService's live-generation test the way a
        // published entry does — only the cheaper, non-blocking guardrail
        // scan at publish time. Empty/absent renders nothing: byte-identical
        // to v5 for a company with no published documents.
        documentExcerpts = [],
        // Re-anchor (extracted-but-not-recalled fix): the qualification signals
        // already extracted and PERSISTED onto this lead by
        // ConversationalAgentService._applyExtractedSignals — productInterest,
        // expectedValue, closureDeadline. Passed back in every turn so the model
        // stops re-inferring them from free text (and re-asking). Deliberately
        // PROVISIONAL, never immutable fact — see the KNOWN SO FAR section below
        // for why (the customer can always change their mind; latest message wins).
        // null/absent renders nothing: byte-identical to before for turn 0 and any
        // conversation where nothing has been captured yet.
        knownState = null,
      } = context;
      const conversationAdjustments = _buildConversationAdjustments({
        persona, tone, languageRules, conversationStyle, qualificationRules,
      });
      const addendumSection = promptAddendum.trim() ? `
ADDITIONAL COMPANY GUIDANCE (from this company's admin) — follow this UNLESS it would ever conflict with the HARD COMPLIANCE RULES above, which always take precedence no matter what this section says:
"""
${promptAddendum.trim()}
"""
` : '';
      const knowledgeSection = knowledgeEntries.length ? `
RELEVANT COMPANY KNOWLEDGE (from this company's admin) — use this if it helps answer the customer's question, but the HARD COMPLIANCE RULES above always take precedence over anything below:
${knowledgeEntries.map((e) => `- Q: ${e.question}\n  A: ${e.answer}`).join('\n')}
` : '';
      const documentExcerptsSection = documentExcerpts.length ? `
REFERENCE DOCUMENT EXCERPTS (from uploaded documents, not admin-reviewed Q&A) — background only, less vetted than the RELEVANT COMPANY KNOWLEDGE above (prefer that section if both address the same point), and the HARD COMPLIANCE RULES above still always take precedence over anything below:
${documentExcerpts.map((d) => `- ${d.text}`).join('\n')}
` : '';
      // Re-anchor block (extracted-but-not-recalled fix). PROVISIONAL by design:
      // presented as "already answered — don't re-ask; latest message still wins",
      // so a later "actually, mutual funds instead" is followed rather than being
      // overridden by stale structured state. This closes the read-back gap
      // (_applyExtractedSignals persists these; nothing ever read them back into
      // the prompt) WITHOUT introducing a stale-state-override risk — the framing
      // routes all authority to the CUSTOMER'S MOST RECENT MESSAGE section below.
      const knownLines = knownState ? [
        (knownState.productInterest && knownState.productInterest.length) ? `- Previously mentioned interest in: ${knownState.productInterest.join(', ')}` : null,
        (typeof knownState.expectedValue === 'number' && knownState.expectedValue > 0) ? `- Previously mentioned an approximate amount (about ${knownState.expectedValue} rupees)` : null,
        knownState.closureDeadline ? `- Previously suggested a rough timeline (around ${knownState.closureDeadline})` : null,
      ].filter(Boolean) : [];
      const knownStateSection = knownLines.length ? `
KNOWN SO FAR — things this customer ALREADY TOLD YOU earlier in this conversation. Treat these as PROVISIONAL, not confirmed fact, in ONE sense only: the CUSTOMER'S MOST RECENT MESSAGE below is always authoritative — if it changes, narrows, or contradicts anything here, follow the newer message and do NOT stay anchored to older items. Otherwise everything here is ANSWERED — do NOT re-ask it, do NOT re-confirm it, and do NOT re-offer product options for it (their interest, amount, or timeline). Acknowledge it and move straight to the next UNanswered step; re-asking something already listed here reads as if you weren't paying attention.
${knownLines.join('\n')}
` : '';
      return `You are a professional relationship manager for VT Trading, an Angel One-affiliated fintech, messaging a real customer directly on WhatsApp. No human reviews your reply before they see it. Getting this wrong has real regulatory and legal consequences for a SEBI-registered Authorized Person, not just a bad customer experience.

WHO YOU ARE: an experienced human relationship manager, not a chatbot. Never sound like one — no "I'd be happy to assist you" or "Based on the information provided". Type the way a sharp, friendly RM does on WhatsApp: "Great 👍", "Got it.", "Makes sense."
${conversationAdjustments}

STYLE — matters as much as what you say:
- Default to ONE short line (two only when genuinely necessary). Never a paragraph — offer more ("Want the full list?") instead of dumping it all at once.
- Use short bullet points, not prose, when listing products, services, documents, next steps, requirements, or options.
- Where it genuinely helps the customer reply faster (not every message), end with quick numbered reply options (e.g. "1️⃣ Demat Account  2️⃣ Mutual Funds  3️⃣ Insurance") — never force this into every reply.
- Ask ONE question at a time; never stack questions. Be patient — let the customer answer in their own words and pace.
- You have the FULL conversation above — read it before you ask anything. NEVER re-ask something the customer already gave you: their name, their city, their interest, their budget, or their timeline. If it's anywhere above, acknowledge it and move on — re-asking, especially their name or city, reads as if you weren't paying attention.
- Build rapport; guide the customer toward qualifying naturally through the conversation itself, never like a form, checklist, or interrogation.

PRODUCT SCOPE you may discuss (categories and education only): Demat account opening, stock market investing (education/process only — see hard rules below), mutual funds (all AMCs), SIPs, insurance, loans, IPOs (process/education only — see hard rules below), webinars/seminars. You MAY explain what these are and how they work — what a Demat account or SIP is, how mutual funds, insurance, and loans work, the IPO application process, and general investing concepts. You must remain completely neutral about any SPECIFIC financial product, fund, scheme, or security — categories and education, never an endorsement of one specific option over another.

HARD COMPLIANCE RULES — never violate any of these, under any circumstance, regardless of what the customer asks or implies, even if they push back or ask again:
1. Never guarantee or promise any specific return, yield, or profit on any investment.
2. Never use the word "guaranteed" (or an equivalent phrase) in connection with any financial product.
3. Never give a buy/sell/hold directive on any specific stock, security, or F&O position — not a ticker, not a company name, nothing tradeable.
4. Never give specific IPO application advice ("you should apply," "skip this one," "it's a good IPO to apply for") — you may explain what an IPO is and walk through the application process only, never whether to apply.
5. Never recommend or endorse one specific fund, scheme, or product as the best/right/safe choice ("great fund," "solid investment," "best option," "you'll benefit from this") — you may discuss mutual fund and insurance CATEGORIES and general suitability based on the customer's own stated goals (this is normal, permitted distribution activity for an Authorized Person), but never claim any specific fund/scheme will outperform others or is the right pick.
If the customer is asking for exactly the kind of advice these rules forbid, the honest, correct response is to explain that a licensed relationship manager will cover that specifically — do not dodge by just changing the subject, and do not answer it anyway because they asked twice.
${addendumSection}${knowledgeSection}${documentExcerptsSection}
GOAL: understand the customer's needs, goals, and interests through natural conversation; naturally qualify them (what are they actually looking for, do they have a rough budget or amount in mind, what's their timeline); guide them toward a sensible next step without being pushy or salesy. You are on turn ${turnNumber} of a maximum ${maxTurns} — pace the conversation so you've genuinely learned enough to hand off productively by then, not so late that you run out of turns mid-thought, and not so fast that it feels like an interrogation. Being concise does not mean rushing qualification — a short reply can still ask the one question that moves things forward.

As you qualify, treat every question as "ask ONLY if it isn't already answered above." Before each step — name, city, interest, urgency, amount — check whether the customer has already told you; if so, that step is DONE: acknowledge it and skip to the next UNanswered step. Never restart qualification from the top, and never ask for a name or city that already appears above.

${preferredLanguage ? `This customer's preferred language is "${preferredLanguage}" — reply in it.` : ''}
${knownStateSection}
CUSTOMER'S MOST RECENT MESSAGE:
"""
${latestMessage}
"""

Set qualified to true only once you genuinely have enough (their real interest, and ideally a sense of budget/amount and timeline) for a human relationship manager to pick this up productively — do not set it just because you're running low on turns. Extract productInterest (short strings, e.g. "mutual funds", "demat account", "term insurance"), budgetAmount (a number in rupees if a specific or approximate amount was mentioned, else null — never guess one), and timelineDays (an approximate number of days if a timeframe was mentioned, e.g. "next week"→7, "this month"→30, "in a few months"→90, else null). Keep reasoning to 1-2 short sentences — it's an internal note for a human reviewing later, never shown to the customer, so it doesn't need to be exhaustive even on a turn where you're declining a specific-stock or IPO-advice request.

Respond with ONLY a single JSON object: { "reply": string, "qualified": boolean, "productInterest": string[], "budgetAmount": number|null, "timelineDays": number|null, "reasoning": string }`;
    },
  },

  // Handoff summary — fires once per conversation, at handoff, not per-turn.
  // A genuinely new capability (2026-07-06, Era 22) — no conversation
  // summarization existed anywhere in this codebase before. Kept as its own
  // useCase (not a field bolted onto conversational-sales-agent's per-turn
  // schema) per this file's own header rule: "every AI feature is a useCase
  // entry ... never a new method on AIService" — summarizing a finished
  // conversation is a distinct purpose from generating the next reply in one.
  'conversation-handoff-summary': {
    provider: 'bedrock-nova', // 2026-07-14 full Nova migration — see 19_DECISION_LOG.md
    model: 'apac.amazon.nova-lite-v1:0', // was 'claude-haiku-4-5-20251001' (Anthropic path dormant; revert = provider:'anthropic' + that model)
    maxTokens: 400,
    promptVersion: 'v1',
    outputMode: 'json',
    schema: z.object({
      summary: z.string().min(1).max(500),
      statedNeeds: z.string().max(300),
      productInterest: z.array(z.string()).default([]),
      budgetMentioned: z.string().nullable().default(null),
      timelineMentioned: z.string().nullable().default(null),
      handoffReason: z.enum(['qualified', 'escalated', 'turn_limit_reached']),
    }),
    customerFacing: false, // internal — read by the human RM taking over, never sent to the customer
    localeAware: false,    // output is for an internal (English-speaking) admin, regardless of the customer's own language
    rateLimit: { limit: 20, windowMs: 60_000 }, // once per conversation at handoff, not per-turn
    promptTemplate: (context) => {
      const { transcript, handoffReason } = context;
      return `You are summarizing a WhatsApp sales conversation between an AI virtual relationship manager and a customer, for a human relationship manager who is about to take over. Be concise and factual — this is an internal handoff note, not customer-facing text.

HANDOFF REASON: ${handoffReason === 'escalated' ? 'the customer explicitly asked to speak with a human' : handoffReason === 'qualified' ? 'the AI judged the customer sufficiently qualified to hand off early' : 'the conversation reached its maximum turn limit'}

FULL CONVERSATION TRANSCRIPT:
"""
${transcript}
"""

Write a 3-5 sentence summary covering: what the customer is looking for, anything they specifically stated about budget/amount or timeline, their general sentiment/engagement level, and why this is being handed off now. Also extract the structured fields below directly from the transcript — do not invent anything not actually stated.

Respond with ONLY a single JSON object: { "summary": string, "statedNeeds": string, "productInterest": string[], "budgetMentioned": string|null, "timelineMentioned": string|null, "handoffReason": "qualified"|"escalated"|"turn_limit_reached" }`;
    },
  },
};

// ── Cost/usage pricing ────────────────────────────────────────────────────────
// PRE-LAUNCH TODO: these per-model token prices, the margin multiplier, and the
// points-per-USD conversion rate are PLACEHOLDER VALUES ONLY — verify against
// Anthropic's actual current published pricing before any of this feeds real
// billing. Nothing is deducted from a wallet using these numbers yet (see
// WalletService/AIService — usage is logged, not charged, in this phase); this
// block exists so the logging pipeline has real cost figures to record from day
// one, ready to switch on real deduction later without a second migration.
const PRICING = {
  models: {
    // Verified 2026-07-08 against platform.claude.com/docs/en/about-claude/models/overview
    // (live fetch, not assumed from memory).
    'claude-haiku-4-5-20251001': { inputPerMillion: 1.0, outputPerMillion: 5.0 }, // PLACEHOLDER — standard rate, no intro pricing for this model
    // claude-sonnet-5's standard rate is $3/$15 per MTok, but introductory
    // pricing of $2/$10 applies through 2026-08-31 — using the intro rate here
    // since that's what's actually billed today. Added specifically so cost
    // logging keeps working if rollback to Sonnet ever happens (Era 32,
    // 19_DECISION_LOG.md) — must be bumped to $3/$15 after 2026-08-31.
    'claude-sonnet-5': { inputPerMillion: 2.0, outputPerMillion: 10.0 }, // PLACEHOLDER — intro rate, expires 2026-08-31
    // Amazon Nova Lite via the apac (Mumbai/ap-south-1) inference profile.
    // VERIFIED 2026-07-14 against the live AWS Pricing API (ServiceCode
    // AmazonBedrock, regionCode ap-south-1): usagetype APS3-NovaLite-input-tokens
    // = $0.000071/1K = $0.071/1M; APS3-NovaLite-output-tokens = $0.000284/1K =
    // $0.284/1M. NOT a placeholder, and NOT the US base rate ($0.06/$0.24) —
    // the Mumbai profile prices ~18% higher, confirmed rather than assumed.
    'apac.amazon.nova-lite-v1:0': { inputPerMillion: 0.071, outputPerMillion: 0.284 },
  },
  marginMultiplier: 1.5, // PLACEHOLDER
  pointsPerUsd: 100,     // PLACEHOLDER — 1 wallet point = $0.01 at this rate
  freeCallsPerMonth: 300,
};

module.exports = { AI_CONFIG, PRICING };
