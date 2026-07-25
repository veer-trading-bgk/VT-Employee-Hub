// Redacts credential-shaped query-string params from any string value found
// anywhere in a Sentry breadcrumb or event object.
//
// Why this exists: @sentry/node's default Http/NodeFetch integrations
// auto-record every outbound request as a breadcrumb (method + full URL,
// including the query string) -- independent of anything the app itself
// logs. This app's Meta Graph API calls (WhatsApp + Instagram) universally
// pass access_token/client_secret/input_token as URL query params, not
// headers (see src/services/graphApiHelpers.js, igGraphApiHelpers.js,
// src/routes/whatsapp.js, src/routes/instagram.js -- dozens of call sites).
// Confirmed via a real captured Sentry envelope (not just code review) that
// a fake token in a Graph-API-shaped call landed in the breadcrumb's
// `http.query` field verbatim. beforeBreadcrumb below is the fix for that
// specific integration; beforeSend deep-scrubs the whole event as
// defense-in-depth against any other integration/future call site placing
// a token-shaped value anywhere in the payload (request context, extra,
// contexts, etc.) -- not just the one confirmed leak.
//
// Deliberately does NOT include a bare "code" (OAuth authorization code)
// pattern -- "code" is too generic a word (status code, verification code,
// pincode, ...) and would false-positive constantly. Auth codes are
// single-use and short-lived, unlike access/refresh tokens; flagged as a
// known, accepted gap rather than silently ignored.
//
// Boundary group ($1) intentionally covers more than "embedded in a full
// URL": Sentry's own RequestData integration populates `event.request.
// query_string` via `new URL(url).search.slice(1)` -- which strips the
// leading '?' -- so a secret-shaped param that is FIRST in the query string
// has no '?' or '&' before it in that field. '^' (start-of-string) covers
// that. The rest of the class (whitespace/quote/bracket/comma) covers a
// secret-shaped "key=value" pair appearing in free-text/log-style strings
// or inside a stringified tuple/array, not just literal URL text. Matching
// too broadly here (redacting a non-secret field that happens to sit next
// to one of these characters) is an acceptable trade-off vs. the
// alternative of under-redacting a real secret.
//
// The value class deliberately no longer excludes '"'/"'" -- a secret value
// that itself contains a literal quote character (e.g. arrives embedded in
// an already-quoted/escaped text blob) must not truncate the match early
// and leak the remainder past the quote. '&', whitespace and '\\' still end
// a value since those are real query-string/text delimiters.
// AWS SigV4 presigned-URL params (X-Amz-Signature, X-Amz-Credential) are
// added as literal, anchored alternatives rather than broadening the
// generic "signature"/"credential" words -- those words collide with real,
// non-secret uses elsewhere in this codebase (src/utils/fileSignature.js's
// file-type magic-byte constants, src/utils/verifyMetaWebhookSignature.js's
// HMAC `signature` variable). X-Amz-Security-Token is already covered by
// the generic "token" match; listed explicitly anyway for clarity.
const SECRET_QUERY_PARAM = /(^|[?&\s"'`(\[{,])([\w.-]*(?:token|secret|password|api[_-]?key|authorization|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)[\w.-]*=)[^&\s\\]*/gi;

// Catches an Authorization/Proxy-Authorization-style "Bearer <token>" or
// "Basic <base64>" value by its SHAPE, independent of what (if any) key
// it's stored under and independent of the '=' -based query-string form
// SECRET_QUERY_PARAM matches. Needed because "Authorization" as a key name
// doesn't contain token/secret/password/api[_-]?key, and its value ("Bearer
// xyz") isn't query-string shaped -- so a captured header object, a raw
// header-block string, or a [key, value] tuple array all carry this value
// in a shape neither SECRET_QUERY_PARAM nor a key-name check alone can see.
const AUTH_SCHEME_VALUE = /\b(Bearer|Basic)\s+[^\s&"'\\]+/gi;

function scrubSecretsFromString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(SECRET_QUERY_PARAM, '$1$2[Filtered]')
    .replace(AUTH_SCHEME_VALUE, '$1 [Filtered]');
}

// Second layer: some future/other integration could attach a secret as a
// plain object property (e.g. a captured header `{"x-api-key": "..."}` or a
// parsed-not-stringified `{"access_token": "..."}`) rather than embedded in
// query-string text -- SECRET_QUERY_PARAM only matches the latter shape.
// This matches by KEY NAME instead, independent of value shape. Includes
// "authorization" so a header object literally keyed Authorization/
// authorization is fully redacted (not just the Bearer/Basic-shaped value
// inside it) the same way x-api-key already is.
const SECRET_KEY_NAME = /(?:token|secret|password|api[_-]?key|authorization|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)/i;

// Generous but bounded -- no real Sentry event/breadcrumb shape nests this
// deep (the confirmed leak's own breadcrumb shape is flat). Caps recursion
// so a pathologically deep object (attacker-influenced or not) degrades to
// a placeholder instead of a stack overflow that would throw out of
// beforeBreadcrumb/beforeSend and break Sentry capture entirely.
const MAX_DEPTH = 25;

// Mutates and returns `value` in place (matches beforeBreadcrumb/beforeSend's
// expected return-the-object contract). `seen` guards against circular
// references, which Sentry event objects are not expected to contain, but
// costs nothing to guard against.
//
// Every property read/write below is wrapped in try/catch: a throwing
// getter or Proxy trap on ONE field must degrade that field to a safe
// placeholder, not abort the whole walk (Sentry's own addBreadcrumb() has
// no try/catch around calling beforeBreadcrumb, so an uncaught throw here
// propagates out and breaks Sentry capture, not just this one breadcrumb).
function deepScrubSecrets(value, seen, depth) {
  seen = seen || new WeakSet();
  depth = depth || 0;

  if (typeof value === 'string') return scrubSecretsFromString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  if (depth >= MAX_DEPTH) return '[MaxDepthExceeded]';
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      try {
        value[i] = deepScrubSecrets(value[i], seen, depth + 1);
      } catch (_e) {
        try { value[i] = '[Unreadable]'; } catch (_e2) { /* best effort -- give up on this slot */ }
      }
    }
    return value;
  }

  let keys;
  try {
    keys = Object.keys(value);
  } catch (_e) {
    // Can't enumerate (e.g. a throwing ownKeys trap) -- leave as-is rather
    // than crash the hook. No worse than not scrubbing this subtree.
    return value;
  }

  for (const key of keys) {
    let current;
    try {
      current = value[key];
    } catch (_e) {
      try { value[key] = '[Unreadable]'; } catch (_e2) { /* best effort */ }
      continue;
    }
    if (SECRET_KEY_NAME.test(key)) {
      // Numbers under a secret-shaped key are never real secrets in this
      // codebase -- they're AI-cost/usage counters (totalTokens,
      // inputTokens, outputTokens, maxTokens, embedTokens, ...) in
      // AiCostReportService.js/AIService.js/EmbeddingService.js. Redacting
      // them silently destroys real debugging data with no security
      // benefit (found during the adversarial review of this file).
      // Strings and nested objects/arrays are still redacted wholesale --
      // a secret-named key can hold a nested object/array too, and that
      // whole subtree is exactly as sensitive as a flat string would be.
      if (typeof current === 'number') continue;
      try { value[key] = '[Filtered]'; } catch (_e) { /* best effort */ }
      continue;
    }
    try {
      value[key] = deepScrubSecrets(current, seen, depth + 1);
    } catch (_e) {
      try { value[key] = '[Unreadable]'; } catch (_e2) { /* best effort */ }
    }
  }
  return value;
}

module.exports = { scrubSecretsFromString, deepScrubSecrets };
