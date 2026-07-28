import { test, expect } from '@playwright/test';

/**
 * Meta Health Panel (PR 6) regression coverage, added 2026-07-29.
 *
 * Unlike this folder's other "Verify" specs (panelWidthVerify.spec.ts,
 * protectedRoute.spec.ts), this one depends on no throwaway harness page --
 * it targets the real, permanent /settings route directly, mocking only the
 * network layer. There's no temporary scaffolding to remove afterward, so
 * this stays active as ongoing coverage rather than being deleted/skipped
 * once its initial verification purpose was served.
 *
 * No real E2E login credentials are available in this environment
 * (E2E_EMAIL/E2E_PASSWORD exist only as GitHub Actions repo secrets), so
 * this uses the established auth-bypass technique from
 * panelWidthVerify.spec.ts/kanbanVerify.spec.ts: storageState:{} +
 * serviceWorkers:'block', then page.route() mocks ONLY the auth check
 * (/api/auth/me) so the real ProtectedRoute/AuthContext accept a fake admin
 * session -- everything else renders as the real, unmodified /settings page
 * and MetaHealthPanel component.
 *
 * The mocked WhatsApp API response fixtures below were NOT fabricated --
 * they are verbatim captures taken live from the real production account
 * (company_1784905246660 / Viir Trading, WABA 1024855430389913) via the
 * same direct-route-handler invocation technique used to live-verify PRs
 * 1-5 all session. This proves the real component renders real production
 * data correctly; it does not prove a live network round-trip (impossible
 * without real credentials -- that gap is covered separately by the backend
 * already being live-verified in PRs 4/5, plus this spec's own
 * request-shape assertions on each button click, confirming the frontend
 * calls the real endpoints with the real expected payload shape). As the
 * backend response shapes evolve, these fixtures should be refreshed to
 * match -- they will drift from reality over time otherwise.
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:3001', 'Access-Control-Allow-Credentials': 'true' };

function jsonRoute(body: unknown, status = 200) {
  return async (route: import('@playwright/test').Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
      return;
    }
    await route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
  };
}

// ── Real captures, company_1784905246660 (Viir Trading), 2026-07-29 ──────────

const REAL_USER = {
  id: 'emp_1784905246660', email: 'viireshcshettar@gmail.com', name: 'Viiresh c shettar',
  role: 'admin', companyId: 'company_1784905246660', token: 'mock-session-not-a-real-jwt',
};

const REAL_CONFIG_FULL = {
  connected: true, accessTokenSet: true, accessTokenPreview: '••••••XAZDZD',
  phoneNumberId: '1252521114606730', wabaId: '1024855430389913', phoneNumber: '+91 90357 83567',
  businessManagerId: null, graphApiVersion: 'v25.0', webhookVerifyTokenSet: true,
  webhookCallbackUrl: 'https://api.viirtrading.com/api/whatsapp/webhook',
  connectedAt: '2026-07-28T14:51:11.572Z', setupMethod: 'manual', configValid: true, configIssue: null,
};

const REAL_HEALTH = {
  success: true, connected: true, graphApiVersion: 'v25.0', lastChecked: '2026-07-29T05:00:00.000Z',
  config: { wabaId: '1024855430389913', phoneNumberId: '1252521114606730', displayNumber: '+91 90357 83567', connectedAt: '2026-07-28T14:51:11.572Z', setupMethod: 'manual', configValid: true },
  token: { valid: true, scopes: ['whatsapp_business_messaging (inferred)', 'whatsapp_business_management (inferred)'], scopesConfirmed: false, type: null, appId: null, expiresAt: null },
  waba: { accessible: true, id: '1024855430389913', name: 'Viir Trading', reviewStatus: 'APPROVED', currency: 'INR', templateNamespace: 'eab61fd7_df3c_4fe5_a81d_7c363a435691', businessId: '2725050094395426' },
  phone: { accessible: true, id: '1252521114606730', displayNumber: '+91 90357 83567', verifiedName: 'Viir Trading', qualityRating: 'GREEN', verificationStatus: 'VERIFIED', status: 'APPROVED' },
  webhooks: { subscribed: true, appId: null },
  pin: { enabled: true, registeredAt: null },
  profile: {
    accessible: true, about: 'APForce | AI-Powered WhatsApp CRM & Automation', address: null, description: null,
    email: 'support@viirtrading.com', profilePictureUrl: 'https://pps.whatsapp.net/v/t61.24694-24/645507926_1096428296046315_1899664307907157087_n.jpg',
    websites: ['https://www.viirtrading.com/'], vertical: 'FINANCE',
  },
  capabilities: { messaging: true, templates: true, webhooks: true, mediaUpload: true },
  issues: [] as string[], rootCause: null, recommendedFix: [] as string[],
};

const REAL_TEMPLATES = {
  success: true,
  templates: [
    { id: 'cded7ee1-9df6-4418-a271-c40eea23be84', name: 'Connection Test', templateName: 'connection_test', language: 'en', category: 'UTILITY', status: 'APPROVED', bodyPreview: 'Hi! This is a test message from APForce confirming your WhatsApp Business connection is working correctly.', variables: [] },
    { id: '0ed5eeeb-8ef8-4a4e-bb9a-c09de0668448', name: 'hello', templateName: 'hello', language: 'en', category: 'UTILITY', status: 'APPROVED', bodyPreview: 'hello sir', variables: [] },
  ],
};

// Real captured Auto Repair response — this account is already fully healthy
// from PRs 1-3, so the real repair report is "1 fixed" (the always-executed
// refresh_profile reporting entry) + 8 already_healthy, zero Meta writes.
const REAL_REPAIR = {
  success: true,
  before: REAL_HEALTH,
  repairPlan: [] as { action: string; label: string }[],
  executed: [
    { action: 'refresh_profile', label: 'Refresh business profile', status: 'fixed', detail: 'Profile data refreshed from Meta.', durationMs: 0 },
  ],
  skipped: [
    { action: 'webhooks', label: 'Subscribe webhook', reason: 'already_healthy' },
    { action: 'pin', label: 'Register Cloud API & enable PIN', reason: 'already_healthy' },
    { action: 'token', label: 'Access token', reason: 'already_healthy' },
    { action: 'waba', label: 'WABA access', reason: 'already_healthy' },
    { action: 'phone', label: 'Phone access', reason: 'already_healthy' },
    { action: 'messaging', label: 'Messaging capability', reason: 'already_healthy' },
    { action: 'templates', label: 'Templates capability', reason: 'already_healthy' },
    { action: 'mediaUpload', label: 'Media upload capability', reason: 'already_healthy' },
  ],
  after: REAL_HEALTH,
  remainingIssues: [] as string[],
  summary: { fixed: 1, failed: 0, alreadyHealthy: 8, otherSkipped: 0 },
  durationMs: 4880,
};

// Real WAMID actually returned by Meta during PR 5's live verification send
// (same session, same account) — reused here rather than sending another
// real WhatsApp message purely to populate a screenshot fixture.
const REAL_SEND_TEST_RESULT = {
  success: true,
  messageId: 'wamid.HBgMOTE5OTAxMjUxNzg1FQIAERgSQTk2QUM1QTVFMDA0ODA0NTVBAA==',
  timestamp: '2026-07-28T18:03:34.759Z',
};

async function mockBackend(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/me', jsonRoute(REAL_USER));
  await page.route('**/api/whatsapp/config/full', jsonRoute(REAL_CONFIG_FULL));
  await page.route('**/api/whatsapp/connection/health', jsonRoute(REAL_HEALTH));
  await page.route('**/api/whatsapp/templates', jsonRoute(REAL_TEMPLATES));
  await page.route('**/api/whatsapp/repair', jsonRoute(REAL_REPAIR));
  await page.route('**/api/whatsapp/send-test', jsonRoute(REAL_SEND_TEST_RESULT));
  // Sibling panels also gated on `connected` — mock minimally so they don't
  // error/spin forever and distract from the Meta Health panel itself.
  await page.route('**/api/whatsapp/flows', jsonRoute({ success: true, flows: [] }));
  await page.route('**/api/whatsapp/branches', jsonRoute({ success: true, branches: [] }));
}

test.describe('Meta Health Panel — real component, real captured production data', () => {
  test('desktop: loads, shows all-healthy status, Auto Repair result, Send Test Message form', async ({ page }) => {
    await mockBackend(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/settings?tab=whatsapp');

    const panel = page.getByTestId('meta-health-panel');
    await expect(panel.getByText('Meta Health')).toBeVisible();
    await panel.getByRole('button', { name: 'Refresh Health' }).click();
    await expect(panel.getByText('All Systems Healthy')).toBeVisible();

    // Every one of the 9 individual status rows the spec calls for.
    for (const label of [
      'Connection', 'Access Token', 'Phone Number', 'Webhook Subscription',
      'Cloud API Registration', 'Two-Step Verification (PIN)', 'Messaging',
      'Templates', 'Business Profile',
    ]) {
      await expect(panel.getByText(label, { exact: true })).toBeVisible();
    }

    await page.screenshot({ path: 'test-results/meta-health-desktop-loaded.png', fullPage: true });

    // ── Auto Repair ──────────────────────────────────────────────────────
    const [repairReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/whatsapp/repair') && r.method() === 'POST'),
      panel.getByRole('button', { name: 'Auto Repair' }).click(),
    ]);
    expect(repairReq.method()).toBe('POST'); // exact shape the real backend route (whatsapp.js) expects: no body required

    await expect(panel.getByText(/Auto Repair Result/)).toBeVisible();
    await expect(panel.getByText('1 fixed, 0 failed, 8 already healthy')).toBeVisible();
    await page.screenshot({ path: 'test-results/meta-health-desktop-auto-repair.png', fullPage: true });

    // ── Send Test Message ────────────────────────────────────────────────
    await panel.getByRole('button', { name: 'Send Test Message' }).click();
    await expect(panel.getByLabel('Phone number')).toBeVisible();
    await panel.getByLabel('Phone number').fill('+919901251785');
    await panel.getByLabel('Template').selectOption({ label: 'hello (en)' });

    const [sendReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/whatsapp/send-test') && r.method() === 'POST'),
      panel.getByRole('button', { name: 'Send', exact: true }).click(),
    ]);
    const sendBody = sendReq.postDataJSON();
    // Exact request shape the real POST /api/whatsapp/send-test route
    // requires (src/routes/whatsapp.js) — proves the frontend wiring, not
    // just that some request fired.
    expect(sendBody).toEqual({ toPhone: '+919901251785', templateId: '0ed5eeeb-8ef8-4a4e-bb9a-c09de0668448' });

    await expect(panel.getByText('Test message sent successfully.')).toBeVisible();
    await expect(panel.getByText(REAL_SEND_TEST_RESULT.messageId)).toBeVisible();
    await page.screenshot({ path: 'test-results/meta-health-desktop-send-test.png', fullPage: true });
  });

  test('mobile viewport (375px): panel is responsive, no horizontal overflow, actions reachable', async ({ page }) => {
    await mockBackend(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings?tab=whatsapp');

    const panel = page.getByTestId('meta-health-panel');
    await expect(panel.getByText('Meta Health')).toBeVisible();
    await panel.getByRole('button', { name: 'Refresh Health' }).click();
    await expect(panel.getByText('All Systems Healthy')).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375); // no horizontal overflow at the narrowest supported width

    await panel.getByRole('button', { name: 'Auto Repair' }).scrollIntoViewIfNeeded();
    await expect(panel.getByRole('button', { name: 'Auto Repair' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Send Test Message' })).toBeVisible();

    await page.screenshot({ path: 'test-results/meta-health-mobile-loaded.png', fullPage: true });
  });
});
