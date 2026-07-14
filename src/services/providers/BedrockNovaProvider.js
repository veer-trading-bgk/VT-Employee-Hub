'use strict';

const AWS = require('aws-sdk');
const logger = require('../../config/logger');

/**
 * BedrockNovaProvider — Amazon Nova (Bedrock Converse API) behind AIService's
 * internal provider contract, so calling code stays provider-agnostic (ADR-015
 * boundary unchanged — this is only reached via AIService, never directly).
 *
 * Contract (matches the Anthropic path's normalized shape in AIService):
 *   generate(systemPrompt, messages, { model, maxTokens })
 *     -> { text, usage: { inputTokens, outputTokens } }
 *
 * `messages` is AIService's shape — [{ role: 'user'|'assistant', content: string }] —
 * converted here to Bedrock Converse's [{ role, content: [{ text }] }].
 *
 * Region: ap-south-1, and the model id is the apac inference profile
 * (`apac.amazon.nova-lite-v1:0`), both confirmed working in-region 2026-07-14
 * (Era for the migration). us-east-1 / the `us.` profile is NOT used — apac keeps
 * inference in the same region as the rest of the stack (no cross-region latency
 * or data-residency detour).
 */

const REGION = 'ap-south-1';

let _client = null;
function client() {
  // Lazy singleton — one BedrockRuntime client reused across calls, same as the
  // shared DocumentClient elsewhere. Region is fixed (apac profile is region-bound).
  if (!_client) _client = new AWS.BedrockRuntime({ region: REGION });
  return _client;
}

// Bedrock Converse requires messages to strictly alternate user/assistant and
// forbids empty content — unlike the Anthropic Messages API, which silently
// merges consecutive same-role turns. AIService's message list (conversation
// history + the appended user prompt, plus the JSON-retry loop's appended
// assistant+user pair) can legitimately produce two same-role turns in a row,
// so coalesce adjacent same-role messages into one before converting. This is a
// transport-shape fix only — it changes nothing about what the model sees
// versus the Anthropic path, which would have merged the same turns anyway.
function _coalesce(messages) {
  const out = [];
  for (const m of messages) {
    const content = String(m.content ?? '');
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n${content}`;
    else out.push({ role: m.role, content });
  }
  return out;
}

// Bedrock Converse has a SECOND hard rule beyond same-role alternation: the
// message array MUST begin with a `user` turn. The Anthropic Messages API
// tolerated an assistant-first history, so AIService can hand us a list whose
// first element is an assistant turn — and in normal multi-turn flow it does:
// the AI's own turn-1 reply is the first message ever written under a
// freshly-created lead, so from turn 2 onward the fetched history starts with
// an assistant turn. Left unstripped, Converse rejects the whole call with
// "A conversation must start with a user message", silently breaking every
// turn after the first. Strip any leading assistant turn(s) so the array
// starts with user. (After _coalesce there is at most one leading assistant,
// but the loop is defensive against being called on a non-coalesced array.)
function _stripLeadingAssistant(messages) {
  let i = 0;
  while (i < messages.length && messages[i].role === 'assistant') i += 1;
  return messages.slice(i);
}

async function generate(systemPrompt, messages, opts = {}) {
  const { model, maxTokens } = opts;
  const coalesced = _coalesce(messages);
  let normalized = _stripLeadingAssistant(coalesced);

  // Only reachable if the ENTIRE input was assistant turns (no user message at
  // all). AIService always appends the rendered prompt as the final user
  // message, so this does not happen on the real path — but rather than send an
  // empty array (Converse rejects it) or throw, degrade to a single user-role
  // turn carrying the last message's content, matching turn-1's working
  // prompt-only shape, and flag the anomaly for investigation.
  if (normalized.length === 0) {
    logger.warn('BedrockNovaProvider: no user turn after stripping leading assistant(s) — falling back to a single prompt-only user turn. This should not occur via AIService (which always appends a user prompt).');
    const lastContent = coalesced.length ? coalesced[coalesced.length - 1].content : '';
    normalized = [{ role: 'user', content: lastContent }];
  }

  const converseMessages = normalized.map((m) => ({
    role: m.role,
    content: [{ text: m.content }],
  }));

  const params = {
    modelId: model,
    messages: converseMessages,
    inferenceConfig: { maxTokens },
    // AIService embeds the entire prompt in the user message today (no separate
    // system block on the Anthropic path either), so systemPrompt is normally
    // null; supported here for future callers that do split it out.
    ...(systemPrompt ? { system: [{ text: systemPrompt }] } : {}),
  };

  const resp = await client().converse(params).promise();
  const text = (resp.output?.message?.content ?? []).map((b) => b.text ?? '').join('');
  return {
    text,
    usage: {
      // Verified field path against a live Converse response (2026-07-14):
      // resp.usage = { inputTokens, outputTokens, totalTokens }.
      inputTokens: resp.usage?.inputTokens ?? 0,
      outputTokens: resp.usage?.outputTokens ?? 0,
    },
  };
}

module.exports = { generate, REGION };
