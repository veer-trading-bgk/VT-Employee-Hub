'use strict';

const AWS = require('aws-sdk');

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

async function generate(systemPrompt, messages, opts = {}) {
  const { model, maxTokens } = opts;
  const converseMessages = _coalesce(messages).map((m) => ({
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
