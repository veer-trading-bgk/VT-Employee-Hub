// Frontend port of src/config/sentryScrub.js (backend, VT-Employee-Hub repo
// root). Same algorithm, same regexes -- ported rather than imported because
// dashboard/ is a physically separate npm project (its own package.json,
// node_modules, Next.js webpack build) from the backend, so a cross-project
// require()/import isn't viable, especially for instrumentation-client.ts
// which must bundle for the browser. Keep the two files in sync by hand if
// the scrub logic changes on either side.
//
// Why this exists on the frontend too: confirmed (2026-07) that
// NEXT_PUBLIC_SENTRY_DSN went live in Vercel production with NO scrubbing —
// this app's own dashboard/src/lib/wsClient.ts embeds the live session JWT
// directly in the WebSocket connection URL (`${baseUrl}?token=${token}`,
// see connect()/_open() below), which is the same "secret in a URL that a
// breadcrumb/resource-error/exception could carry" shape as the backend's
// confirmed Meta Graph API token leak. Sentry's browser SDK also has
// GlobalHandlers, which can capture failed resource loads (e.g. a broken
// <img src>) with the failing URL -- relevant here because this app uses
// presigned S3 URLs for avatars/media (useAvatarUrl.ts, mediaUpload.ts);
// those carry X-Amz-Signature/X-Amz-Credential, which this scrub does NOT
// currently redact (same "code" param precedent as the backend file: a
// deliberate scope decision, not an oversight -- flagged for review, not
// added silently).
// AWS SigV4 presigned-URL params (X-Amz-Signature, X-Amz-Credential) are
// added as literal, anchored alternatives rather than broadening the
// generic "signature"/"credential" words -- confirmed live leak via
// mediaUpload.ts's real XHR-to-presigned-URL uploads (2026-07-25
// adversarial review), but a broad word match would collide with real,
// non-secret uses elsewhere (backend's file-type magic-byte constants,
// Meta webhook HMAC `signature` variable). X-Amz-Security-Token is already
// covered by the generic "token" match; listed explicitly for clarity.
const SECRET_QUERY_PARAM = /(^|[?&\s"'`(\[{,])([\w.-]*(?:token|secret|password|api[_-]?key|authorization|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)[\w.-]*=)[^&\s\\]*/gi;

const AUTH_SCHEME_VALUE = /\b(Bearer|Basic)\s+[^\s&"'\\]+/gi;

export function scrubSecretsFromString(str: unknown): unknown {
  if (typeof str !== 'string') return str;
  return str
    .replace(SECRET_QUERY_PARAM, '$1$2[Filtered]')
    .replace(AUTH_SCHEME_VALUE, '$1 [Filtered]');
}

const SECRET_KEY_NAME = /(?:token|secret|password|api[_-]?key|authorization|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)/i;

// Known gap (browser-only, not yet triggered by any current call site, found
// during the 2026-07-25 adversarial review of this file): a bare secret
// value with no `key=value` text shape and no secret-shaped object key is
// invisible to both scrubSecretsFromString (needs key=value or Bearer/Basic
// shape) and this key-name check (needs the value to sit under a
// secret-shaped key). @sentry/browser's BrowserApiErrors integration
// manufactures exactly that shape: when a setTimeout/setInterval/
// addEventListener-wrapped callback throws, its wrap() helper (see
// @sentry/browser's helpers.js) stuffs the callback's raw `arguments` array
// into `event.extra.arguments` -- so a raw token passed as
// `setTimeout(fn, ms, token)` or `dispatchEvent(new CustomEvent(name, {
// detail: token }))` would ride along unredacted. Confirmed reproducible
// against the real SDK; not live today (no current setTimeout/setInterval
// call in this codebase forwards extra arguments, and wsClient.ts's
// WebSocket handlers use `.onopen =`-style property assignment, which
// BrowserApiErrors does not wrap). Closing this would mean matching bare
// token-shaped strings by pattern alone, independent of key name or
// query-string shape -- a real widening of this file's matching philosophy
// that needs the same review as the boundary/quote/Authorization-header
// hardening above, not a silent addition here. Route any future
// setTimeout(fn, ms, secret)-style or CustomEvent({ detail: secret })-style
// pattern through a secret-shaped key instead, or flag it for review first.
const MAX_DEPTH = 25;

export function deepScrubSecrets(value: unknown, seen?: WeakSet<object>, depth?: number): unknown {
  const _seen = seen || new WeakSet<object>();
  const _depth = depth || 0;

  if (typeof value === 'string') return scrubSecretsFromString(value);
  if (!value || typeof value !== 'object') return value;
  if (_seen.has(value as object)) return value;
  if (_depth >= MAX_DEPTH) return '[MaxDepthExceeded]';
  _seen.add(value as object);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      try {
        value[i] = deepScrubSecrets(value[i], _seen, _depth + 1);
      } catch {
        try { value[i] = '[Unreadable]'; } catch { /* best effort -- give up on this slot */ }
      }
    }
    return value;
  }

  let keys: string[];
  try {
    keys = Object.keys(value as object);
  } catch {
    return value;
  }

  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    let current: unknown;
    try {
      current = obj[key];
    } catch {
      try { obj[key] = '[Unreadable]'; } catch { /* best effort */ }
      continue;
    }
    if (SECRET_KEY_NAME.test(key)) {
      if (typeof current === 'number') continue;
      try { obj[key] = '[Filtered]'; } catch { /* best effort */ }
      continue;
    }
    try {
      obj[key] = deepScrubSecrets(current, _seen, _depth + 1);
    } catch {
      try { obj[key] = '[Unreadable]'; } catch { /* best effort */ }
    }
  }
  return value;
}
