'use strict';

/**
 * Regression tests for verifyMetaWebhookSignature's per-app secret param.
 *
 * Locks out the 2026-07-18 production incident (DECISION_LOG Era 54): the
 * Instagram DM webhook is delivered by a SEPARATE Meta app (Instagram Login)
 * and signed with INSTAGRAM_APP_SECRET, but the shared verifier was hardcoded
 * to META_APP_SECRET (the WhatsApp Tech Provider app), so every real Instagram
 * delivery was rejected with 401. The fix is a per-app `secret` param; these
 * tests assert an Instagram-signed payload PASSES against INSTAGRAM_APP_SECRET
 * and FAILS against META_APP_SECRET (the old broken behavior), so this exact
 * bug class can never silently reappear.
 */

const crypto = require('crypto');
const { verifyMetaWebhookSignature } = require('../src/utils/verifyMetaWebhookSignature');

const META_SECRET = 'meta_app_secret_test_AAAA';
const IG_SECRET   = 'instagram_app_secret_test_BBBB';

// Build a request signed exactly the way Meta signs it: HMAC-SHA256 over the
// raw body bytes, hex, prefixed 'sha256='.
function signedReq(body, secret) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return { headers: { 'x-hub-signature-256': sig }, rawBody };
}

const IG_PAYLOAD = { object: 'instagram', entry: [{ id: 'igba_1', messaging: [{ sender: { id: 'ig_1' }, message: { text: 'price' } }] }] };

describe('verifyMetaWebhookSignature — per-app secret (2026-07-18 Instagram signature-mismatch regression)', () => {
  const OLD_META = process.env.META_APP_SECRET;
  beforeAll(() => { process.env.META_APP_SECRET = META_SECRET; });
  afterAll(() => {
    if (OLD_META === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = OLD_META;
  });

  test('an Instagram-signed payload PASSES when verified against INSTAGRAM_APP_SECRET (the fix)', () => {
    const req = signedReq(IG_PAYLOAD, IG_SECRET);
    expect(verifyMetaWebhookSignature(req, IG_SECRET)).toBe(true);
  });

  test('the SAME Instagram-signed payload FAILS against META_APP_SECRET — the old broken behavior, now locked out', () => {
    const req = signedReq(IG_PAYLOAD, IG_SECRET);
    // Explicit wrong-secret (what a hardcoded META_APP_SECRET verifier did):
    expect(verifyMetaWebhookSignature(req, META_SECRET)).toBe(false);
    // ...and via the default param — exactly what instagram.js used to call —
    // also false, which is the 401 the incident produced 47 times.
    expect(verifyMetaWebhookSignature(req)).toBe(false);
  });

  test('backward compat: a Meta/WhatsApp-signed payload still passes via the default param (WhatsApp/Lead-Ads call sites unchanged)', () => {
    const req = signedReq({ object: 'whatsapp_business_account', entry: [{ changes: [] }] }, META_SECRET);
    expect(verifyMetaWebhookSignature(req)).toBe(true); // default secret === META_APP_SECRET
  });

  test('cross-check: a Meta-signed payload FAILS when verified against INSTAGRAM_APP_SECRET (secrets are not interchangeable in either direction)', () => {
    const req = signedReq({ object: 'whatsapp_business_account', entry: [] }, META_SECRET);
    expect(verifyMetaWebhookSignature(req, IG_SECRET)).toBe(false);
  });

  test('a tampered body fails even against the correct secret', () => {
    const req = signedReq(IG_PAYLOAD, IG_SECRET);
    req.rawBody = Buffer.from(JSON.stringify({ ...IG_PAYLOAD, entry: [{ id: 'TAMPERED' }] }));
    expect(verifyMetaWebhookSignature(req, IG_SECRET)).toBe(false);
  });

  test('missing signature header fails closed when a secret is configured', () => {
    expect(verifyMetaWebhookSignature({ headers: {}, rawBody: Buffer.from('{}') }, IG_SECRET)).toBe(false);
  });

  test('missing rawBody fails closed when a secret is configured', () => {
    const sig = 'sha256=' + crypto.createHmac('sha256', IG_SECRET).update(Buffer.from('{}')).digest('hex');
    expect(verifyMetaWebhookSignature({ headers: { 'x-hub-signature-256': sig } }, IG_SECRET)).toBe(false);
  });

  test('a falsy explicit secret skips verification (dev-only fail-open, unchanged from original) — passing INSTAGRAM_APP_SECRET when it is unset must not silently accept in prod, so this documents the deploy-time requirement', () => {
    // Empty string is falsy but, unlike undefined, does NOT trigger the default
    // param — so this exercises the fail-open branch directly.
    const req = signedReq(IG_PAYLOAD, IG_SECRET);
    expect(verifyMetaWebhookSignature(req, '')).toBe(true);
  });
});
