'use strict';

// Narrow, deliberate variable set for free-text welcome-message bodies
// (reply_buttons / cta_buttons), OOO, Delayed Response, and the AutomationEngine
// send_buttons step. This is NOT Meta's real template {{n}} syntax — that has
// genuine server-side substitution on approved templates only. This free-text
// path has no such engine, so a template's {{1}} typed here would (and did, in
// production, 2026-07-09 — see docs/phase3/TECHNICAL_DEBT.md) reach the customer
// literally unsubstituted. This is a small, explicit find-and-replace over
// exactly the known tokens below. Any other {{...}} pattern is left untouched on
// purpose — a visible leftover placeholder is a safer failure mode than silently
// swallowing an unrecognised token. findUnsupportedTokens() below is what
// upgrades that safe-but-silent failure mode into a save-time rejection.
const SOURCE_LABELS = {
  whatsapp: 'WhatsApp', whatsapp_ai: 'WhatsApp', website: 'our website',
  facebook: 'Facebook', instagram: 'Instagram', referral: 'a referral',
  walk_in: 'a walk-in visit', webinar: 'our webinar', social: 'social media',
  manual: 'our team', import: 'our team',
};

const SUPPORTED_VARS = {
  '{{name}}':   (ctx) => (ctx.name && ctx.name.trim()) || 'there',
  '{{phone}}':  (ctx) => ctx.phone ?? '',
  '{{source}}': (ctx) => (ctx.source && (SOURCE_LABELS[ctx.source] ?? ctx.source)) || '',
};

function resolveWelcomeVariables(text, ctx) {
  if (!text) return text;
  return Object.entries(SUPPORTED_VARS).reduce(
    (acc, [token, resolve]) => acc.split(token).join(resolve(ctx ?? {})),
    text,
  );
}

// Meta template positional-parameter resolution — same token registry as
// resolveWelcomeVariables() above, different output shape: an ordered params
// array (for WhatsAppSendService.sendTemplate()'s variableValues) instead of a
// substituted string. A value not in SUPPORTED_VARS is sent through as a
// literal string — an admin can type a fixed constant into a template variable
// slot instead of picking {{name}}/{{phone}}/{{source}}, and that's intentional,
// not an error (unlike the free-text path, this array has no "unknown token in
// admin-authored prose" failure mode to guard against — each slot is chosen
// from a fixed dropdown, not typed freehand).
function resolveTemplateParams(variableValues, ctx) {
  return (variableValues ?? []).map((v) => (
    Object.prototype.hasOwnProperty.call(SUPPORTED_VARS, v) ? SUPPORTED_VARS[v](ctx ?? {}) : String(v)
  ));
}

// Finds {{...}} patterns in free-text that aren't in SUPPORTED_VARS — used by
// validation.js's config schemas to reject a save before it can ever reach a
// customer literally unsubstituted (the actual gap that shipped the {{1}} bug,
// not the substitution engine itself — see docs/phase3/TECHNICAL_DEBT.md).
const ANY_TOKEN_RE = /\{\{[^{}]*\}\}/g;
function findUnsupportedTokens(text) {
  if (!text) return [];
  const found = text.match(ANY_TOKEN_RE) ?? [];
  return [...new Set(found)].filter((t) => !Object.prototype.hasOwnProperty.call(SUPPORTED_VARS, t));
}

module.exports = {
  resolveWelcomeVariables,
  resolveTemplateParams,
  findUnsupportedTokens,
  SUPPORTED_VARS,
};
