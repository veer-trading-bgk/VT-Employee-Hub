'use strict';

/**
 * Regression tests for the 2026-07-25 Sentry token-leak fix.
 *
 * Background: Sentry's default Http/NodeFetch integrations auto-record
 * every outbound request as a breadcrumb, including the full URL/query
 * string. This app's Meta Graph API calls (WhatsApp + Instagram) pass
 * access_token/client_secret/input_token as URL query params, not
 * headers -- confirmed via a real captured Sentry envelope (not just code
 * review) that a fake token leaked verbatim through this path. Fixed by
 * wiring deepScrubSecrets into Sentry.init's beforeBreadcrumb/beforeSend
 * hooks (src/handler.js).
 *
 * An adversarial 6-angle red-team pass (see conversation/commit history)
 * found 4 confirmed bypasses in the first draft of this fix, all covered
 * below as named regression cases so they can't silently reappear:
 *   1. Boundary anchoring — SECRET_QUERY_PARAM required a literal '?'/'&'
 *      immediately before the key. Sentry's own RequestData integration
 *      builds event.request.query_string via `.search.slice(1)`, which
 *      strips the leading '?' -- so a secret-shaped param first in the
 *      query string leaked unredacted through that field (and through any
 *      free-text message/tag value where a secret-shaped param has no
 *      leading delimiter at all).
 *   2. Same root cause, broader impact — free-text exception messages,
 *      tag values, and contexts.*.data all leaked for the same reason.
 *   3. Crash safety — a throwing getter/Proxy trap, or ~8500+ levels of
 *      nesting, crashed deepScrubSecrets, which (since Sentry's own
 *      addBreadcrumb() has no try/catch around calling beforeBreadcrumb)
 *      would have broken Sentry capture entirely -- worse than the leak.
 *   4. Header-shaped secrets — an Authorization: Bearer <token> value
 *      wasn't caught by either layer (key name doesn't contain
 *      token/secret/password/apikey; value isn't query-string shaped).
 */

const { scrubSecretsFromString, deepScrubSecrets } = require('../src/config/sentryScrub');

describe('scrubSecretsFromString — query-string-shaped secrets', () => {
  test('redacts access_token with a leading "?"', () => {
    expect(scrubSecretsFromString('/x?access_token=SECRET123')).toBe('/x?access_token=[Filtered]');
  });

  test('redacts the real Graph API shapes used in this codebase', () => {
    // whatsapp.js:806/939 debug_token shape
    expect(scrubSecretsFromString('/debug_token?input_token=USER_TOKEN&access_token=1234|APP_SECRET'))
      .toBe('/debug_token?input_token=[Filtered]&access_token=[Filtered]');
    // instagram.js:371 token-exchange shape
    expect(scrubSecretsFromString('/access_token?grant_type=ig_exchange_token&client_secret=IG_SECRET&access_token=SHORT_LIVED'))
      .toBe('/access_token?grant_type=ig_exchange_token&client_secret=[Filtered]&access_token=[Filtered]');
  });

  test('is case-insensitive and tolerant of camelCase param names', () => {
    expect(scrubSecretsFromString('?Access_Token=A')).toBe('?Access_Token=[Filtered]');
    expect(scrubSecretsFromString('?ACCESSTOKEN=B')).toBe('?ACCESSTOKEN=[Filtered]');
    expect(scrubSecretsFromString('?accessToken=C')).toBe('?accessToken=[Filtered]');
  });

  test('does not redact a non-secret param whose VALUE merely contains "token"', () => {
    expect(scrubSecretsFromString('?grant_type=ig_refresh_token&foo=bar')).toBe('?grant_type=ig_refresh_token&foo=bar');
  });

  describe('regression: AWS SigV4 presigned-URL params (confirmed live leak via frontend XHR breadcrumbs)', () => {
    test('redacts X-Amz-Signature and X-Amz-Credential in a real presigned-URL shape', () => {
      const url = 'https://bucket.s3.amazonaws.com/uploads/x.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAFAKE%2F20260725%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260725T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=deadbeef1234567890secretsignature';
      const result = scrubSecretsFromString(url);
      expect(result).not.toContain('AKIAFAKE');
      expect(result).not.toContain('deadbeef1234567890secretsignature');
      expect(result).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256'); // non-secret param untouched
    });

    test('redacts X-Amz-Signature/X-Amz-Credential as object keys too', () => {
      expect(deepScrubSecrets({ 'X-Amz-Signature': 'REAL_SIG', 'X-Amz-Credential': 'REAL_CRED' }))
        .toEqual({ 'X-Amz-Signature': '[Filtered]', 'X-Amz-Credential': '[Filtered]' });
    });

    test('does NOT redact unrelated, legitimate uses of the bare words "signature"/"credential" (false-positive check)', () => {
      // Matches this codebase's real non-AWS uses: file-type magic-byte
      // constants (src/utils/fileSignature.js) and a Meta webhook HMAC
      // variable (src/utils/verifyMetaWebhookSignature.js) -- neither is a
      // credential that should be redacted from Sentry.
      expect(deepScrubSecrets({ PDF_SIGNATURE: '%PDF' })).toEqual({ PDF_SIGNATURE: '%PDF' });
      expect(deepScrubSecrets({ signature: 'sha256=abc123' })).toEqual({ signature: 'sha256=abc123' });
      expect(scrubSecretsFromString('?callbackSignature=notAws&foo=1')).toBe('?callbackSignature=notAws&foo=1');
    });
  });

  test('leaves an adjacent legitimate param byte-for-byte untouched', () => {
    expect(scrubSecretsFromString('?access_token=ABC123&phone_number_id=987654321'))
      .toBe('?access_token=[Filtered]&phone_number_id=987654321');
  });

  test('redacts a secret as the last param (no trailing "&")', () => {
    expect(scrubSecretsFromString('?phone_number_id=123&access_token=SECRETVALUE'))
      .toBe('?phone_number_id=123&access_token=[Filtered]');
  });

  test('treats URL-encoded characters inside the value as literal text, not a delimiter', () => {
    expect(scrubSecretsFromString('?access_token=AAA%26BBB%3DCCC&next=1')).toBe('?access_token=[Filtered]&next=1');
  });

  test('a value containing a quote character no longer truncates early (regression: was leaking the remainder)', () => {
    expect(scrubSecretsFromString('?access_token=ABC"DEF&next=1')).toBe('?access_token=[Filtered]&next=1');
  });

  test('redacts a bare, real-shaped Graph API URL end to end', () => {
    expect(scrubSecretsFromString('https://graph.facebook.com/v25.0/123/subscribed_apps?access_token=EAAxyz123'))
      .toBe('https://graph.facebook.com/v25.0/123/subscribed_apps?access_token=[Filtered]');
  });

  describe('regression: secret-shaped param with NO leading "?"/"&" (the critical red-team finding)', () => {
    test('redacts a secret as the very first param in a bare string', () => {
      // This is exactly the shape Sentry's own RequestData integration
      // produces for event.request.query_string (.search.slice(1) strips
      // the leading "?"), and the shape a free-text log message takes.
      expect(scrubSecretsFromString('access_token=EAAbareNoDelim888&other=1')).toBe('access_token=[Filtered]&other=1');
    });

    test('redacts a secret embedded in a free-text exception message', () => {
      expect(scrubSecretsFromString('failed: access_token=SECRET_IN_MESSAGE&hub.mode=subscribe'))
        .toBe('failed: access_token=[Filtered]&hub.mode=subscribe');
    });
  });

  describe('regression: Authorization/Bearer-shaped values (the header-secret red-team finding)', () => {
    test('redacts a Bearer-scheme value regardless of key name (scheme word kept, secret redacted)', () => {
      const result = scrubSecretsFromString('Authorization: Bearer voy-xyz456REALSECRET');
      expect(result).toBe('Authorization: Bearer [Filtered]');
      expect(result).not.toContain('voy-xyz456REALSECRET');
    });

    test('redacts a Basic-scheme value (scheme word kept, secret redacted)', () => {
      const result = scrubSecretsFromString('Basic dXNlcjpwYXNzd29yZA==');
      expect(result).toBe('Basic [Filtered]');
      expect(result).not.toContain('dXNlcjpwYXNzd29yZA==');
    });
  });
});

describe('deepScrubSecrets — object/array traversal', () => {
  test('redacts a secret-named object key regardless of casing/separator convention', () => {
    expect(deepScrubSecrets({ accessToken: 'SECRET' })).toEqual({ accessToken: '[Filtered]' });
    expect(deepScrubSecrets({ 'x-api-key': 'sk-ant-abc123' })).toEqual({ 'x-api-key': '[Filtered]' });
    expect(deepScrubSecrets({ Authorization: 'Bearer abc123' })).toEqual({ Authorization: '[Filtered]' });
  });

  test('does not redact a key that merely contains "token" in an unrelated sense... only real secret-shaped keys', () => {
    expect(deepScrubSecrets({ grant_type: 'ig_refresh_token' })).toEqual({ grant_type: 'ig_refresh_token' });
  });

  test('redacts a nested object/array sitting under a secret-named key wholesale', () => {
    expect(deepScrubSecrets({ credentials: { access_token: { nested: 'still-sensitive' } } }))
      .not.toHaveProperty('credentials.access_token.nested');
  });

  describe('regression: over-redaction of numeric fields under a secret-shaped key name', () => {
    test('real AI-cost/usage counter fields survive untouched (AiCostReportService.js/AIService.js shapes)', () => {
      const usage = {
        totalTokens: 184320, registeredTokens: 150000, unregisteredTokens: 34320,
        inputTokens: 1500, outputTokens: 320, maxTokens: 700, embedTokens: 4096, tokens: 512,
      };
      expect(deepScrubSecrets({ ...usage })).toEqual(usage);
    });

    test('a STRING value under the same kind of key is still redacted (only numbers are exempt)', () => {
      expect(deepScrubSecrets({ accessToken: 'REAL_SECRET_VALUE' })).toEqual({ accessToken: '[Filtered]' });
    });

    test('an object/array under a secret-shaped key is still redacted wholesale (numeric exemption does not reopen the nested-object gap)', () => {
      expect(deepScrubSecrets({ tokenBundle: { access_token: 'X', refresh_token: 'Y' } }))
        .toEqual({ tokenBundle: '[Filtered]' });
    });
  });

  test('structural Sentry fields survive untouched (companyId tag, event_id, trace_id, environment)', () => {
    const event = {
      event_id: 'abc123',
      environment: 'production',
      level: 'error',
      tags: { companyId: 'acme-broking' },
      contexts: { trace: { trace_id: 'trace-abc' } },
    };
    const scrubbed = deepScrubSecrets(JSON.parse(JSON.stringify(event)));
    expect(scrubbed).toEqual(event);
  });

  test('does not throw on primitives, null, or undefined', () => {
    expect(() => deepScrubSecrets(null)).not.toThrow();
    expect(() => deepScrubSecrets(undefined)).not.toThrow();
    expect(() => deepScrubSecrets(42)).not.toThrow();
    expect(() => deepScrubSecrets(true)).not.toThrow();
  });

  test('does not infinite-loop or throw on a circular reference', () => {
    const o = { access_token: 'SECRET' };
    o.self = o;
    expect(() => deepScrubSecrets(o)).not.toThrow();
    expect(o.access_token).toBe('[Filtered]');
  });

  describe('regression: crash safety (the red-team crash-safety finding)', () => {
    test('a throwing getter degrades that one field instead of crashing the whole walk', () => {
      const evil = {};
      Object.defineProperty(evil, 'innocuousField', {
        enumerable: true, configurable: true,
        get() { throw new Error('getter exploded'); },
      });
      expect(() => deepScrubSecrets(evil)).not.toThrow();
    });

    test('deeply nested objects do not stack-overflow (bounded by MAX_DEPTH)', () => {
      let root = {};
      let cur = root;
      for (let i = 0; i < 9000; i++) {
        cur.child = { access_token: i === 8999 ? 'DEEP_SECRET' : undefined };
        cur = cur.child;
      }
      expect(() => deepScrubSecrets(root)).not.toThrow();
    });
  });

  describe('regression: event.request.query_string (the critical red-team finding)', () => {
    test('redacts a secret-shaped param that is first in query_string, matching how Sentry\'s RequestData integration actually builds this field (leading "?" stripped)', () => {
      const event = {
        request: {
          url: 'https://app.example.com/webhook/whatsapp?hub.verify_token=REAL_WEBHOOK_SECRET&hub.mode=subscribe&hub.challenge=abc123',
          // Sentry's extractQueryParamsFromUrl does `new URL(url).search.slice(1)` -- no leading '?'.
          query_string: 'hub.verify_token=REAL_WEBHOOK_SECRET&hub.mode=subscribe&hub.challenge=abc123',
        },
      };
      const scrubbed = deepScrubSecrets(event);
      expect(scrubbed.request.url).toBe('https://app.example.com/webhook/whatsapp?hub.verify_token=[Filtered]&hub.mode=subscribe&hub.challenge=abc123');
      expect(scrubbed.request.query_string).toBe('hub.verify_token=[Filtered]&hub.mode=subscribe&hub.challenge=abc123');
      expect(scrubbed.request.query_string).not.toContain('REAL_WEBHOOK_SECRET');
    });

    test('redacts a token-shaped value inside a free-text exception message and a tag value, not just breadcrumbs/URLs', () => {
      const event = {
        exception: { values: [{ value: 'Graph API call failed: access_token=FREE_TEXT_SECRET&other=1' }] },
        tags: { debugHint: 'retry with access_token=TAG_VALUE_SECRET&foo=1' },
      };
      const scrubbed = deepScrubSecrets(event);
      expect(scrubbed.exception.values[0].value).not.toContain('FREE_TEXT_SECRET');
      expect(scrubbed.tags.debugHint).not.toContain('TAG_VALUE_SECRET');
    });
  });

  describe('known, accepted gap (documented in sentryScrub.js, not fixed by design)', () => {
    test('a bare OAuth "code" param is NOT redacted — deliberate, "code" is too generic a word to scrub safely', () => {
      expect(scrubSecretsFromString('?code=auth_code_123&state=xyz')).toBe('?code=auth_code_123&state=xyz');
    });
  });
});
