'use strict';

// Narrow, deliberate variable set for free-text welcome-message bodies
// (reply_buttons / cta_buttons). This is NOT Meta's real template {{n}}
// syntax — that has genuine server-side substitution on approved templates
// only. This free-text path has no such engine, so a template's {{1}} typed
// here would (and did, in production) reach the customer literally
// unsubstituted. This is a small, explicit find-and-replace over exactly two
// known tokens. Any other {{...}} pattern is left untouched on purpose — a
// visible leftover placeholder is a safer failure mode than silently
// swallowing an unrecognised token.
const SUPPORTED_VARS = {
  '{{name}}':  (ctx) => (ctx.name && ctx.name.trim()) || 'there',
  '{{phone}}': (ctx) => ctx.phone ?? '',
};

function resolveWelcomeVariables(text, ctx) {
  if (!text) return text;
  return Object.entries(SUPPORTED_VARS).reduce(
    (acc, [token, resolve]) => acc.split(token).join(resolve(ctx ?? {})),
    text,
  );
}

module.exports = { resolveWelcomeVariables };
