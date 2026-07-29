import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Embedded Signup Wizard (PR 7a-7c, ADR-024) regression coverage.
 *
 * Follows metaHealthPanel.spec.ts's established pattern exactly: no
 * throwaway harness page, targets the real /settings route, auth-bypass via
 * storageState:{} + serviceWorkers:'block' with only /api/auth/me mocked so
 * the real ProtectedRoute/AuthContext accept a fake admin session, and mocks
 * the backend WhatsApp endpoints via page.route() rather than fabricating a
 * fake component tree.
 *
 * `window.FB` is mocked via page.addInitScript() rather than letting the real
 * Meta SDK load (no network access to connect.facebook.net in this
 * environment, and no real config_id exists yet — see ADR-024's open
 * questions). loadFacebookSdk() in src/lib/facebookSdk.ts checks `if
 * (window.FB)` before injecting the real script tag, so pre-seeding it here
 * is exactly the seam the production code already provides for this.
 *
 * The WA_EMBEDDED_SIGNUP `message` event is origin-gated in production
 * (embeddedSignupCorrelation.ts's TRUSTED_ORIGINS) — a same-page
 * `window.postMessage()` call can't produce a facebook.com origin, so this
 * suite dispatches it from a REAL popup window navigated to a stubbed
 * `https://www.facebook.com/...` route (intercepted, no real network call
 * leaves the browser) and posts via `window.opener.postMessage()` from
 * inside it. This is the same mechanism FB.login's real popup uses, and
 * proves the origin check actually passes for a real cross-origin sender —
 * not just that the app "would" handle a same-origin fake.
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:3001', 'Access-Control-Allow-Credentials': 'true' };

function jsonRoute(body: unknown, status = 200) {
  return async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
      return;
    }
    await route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
  };
}

const REAL_USER = {
  id: 'emp_1784905246660', email: 'viireshcshettar@gmail.com', name: 'Viiresh c shettar',
  role: 'admin', companyId: 'company_1784905246660', token: 'mock-session-not-a-real-jwt',
};

const NOT_CONNECTED_CONFIG = {
  connected: false, accessTokenSet: false, accessTokenPreview: null,
  phoneNumberId: null, wabaId: null, phoneNumber: null, businessManagerId: null,
  graphApiVersion: 'v25.0', webhookVerifyTokenSet: false,
  webhookCallbackUrl: 'https://api.viirtrading.com/api/whatsapp/webhook',
  connectedAt: null, setupMethod: null, configValid: false, configIssue: null,
};

const SIGNUP_CONFIG_AVAILABLE = { appId: 'test_app_id', configId: 'test_config_id', graphApiVersion: 'v25.0' };

const STEP_KEYS = ['persistConfig', 'subscribeWebhooks', 'registerPhone', 'syncBusinessProfile', 'syncTemplates', 'healthCheck'] as const;

function allDoneStatus() {
  const at = new Date().toISOString();
  return {
    startedAt: at,
    completedAt: at,
    steps: Object.fromEntries(STEP_KEYS.map((k) => [k, { status: 'done', at }])),
  };
}

function partialFailureStatus() {
  const at = new Date().toISOString();
  const steps: Record<string, { status: string; at: string; error?: string }> = {};
  for (const k of STEP_KEYS) steps[k] = { status: 'done', at };
  steps.syncTemplates = { status: 'failed', at, error: 'Meta rate-limited the template list — try again shortly.' };
  return { startedAt: at, completedAt: null, steps };
}

async function mockAuthAndBaseConfig(page: Page, configOverrides: Partial<typeof NOT_CONNECTED_CONFIG> = {}) {
  await page.route('**/api/auth/me', jsonRoute(REAL_USER));
  await page.route('**/api/whatsapp/config/full', jsonRoute({ ...NOT_CONNECTED_CONFIG, ...configOverrides }));
  await page.route('**/api/whatsapp/embedded-signup/config', jsonRoute(SIGNUP_CONFIG_AVAILABLE));
}

async function seedFakeFacebookSdk(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { FB: unknown }).FB = {
      init: () => {},
      login: (callback: (response: unknown) => void) => {
        (window as unknown as { __fbLoginCallback: typeof callback }).__fbLoginCallback = callback;
      },
    };
  });
}

async function resolveFbLogin(page: Page, response: unknown) {
  await page.waitForFunction(() => !!(window as unknown as { __fbLoginCallback?: unknown }).__fbLoginCallback);
  await page.evaluate((r) => {
    (window as unknown as { __fbLoginCallback: (response: unknown) => void }).__fbLoginCallback(r);
  }, response);
}

/** Posts a WA_EMBEDDED_SIGNUP message from a real cross-origin popup so the
 * app's origin check (embeddedSignupCorrelation.ts) genuinely passes.
 * Routed via the BROWSER CONTEXT, not the page — page.route() only applies
 * to that page's own requests, not a popup's (a separate Page object), so
 * without this the popup would hit the real facebook.com, whose COOP header
 * severs `window.opener` and silently drops the postMessage. */
async function postSignupMessageFromFacebookOrigin(page: Page, data: unknown) {
  await page.context().route('https://www.facebook.com/embedded-signup-test-stub', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>stub</body>' }));

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.evaluate(() => { window.open('https://www.facebook.com/embedded-signup-test-stub', 'wa_test'); }),
  ]);
  await popup.waitForLoadState();
  await popup.evaluate((msg) => window.opener?.postMessage(msg, '*'), data);
  await popup.close();
}

test.describe('Embedded Signup Wizard', () => {
  test('entry point disables itself with an explanatory message when not configured', async ({ page }) => {
    await page.route('**/api/auth/me', jsonRoute(REAL_USER));
    await page.route('**/api/whatsapp/config/full', jsonRoute(NOT_CONNECTED_CONFIG));
    await page.route('**/api/whatsapp/embedded-signup/config', jsonRoute(
      { error: 'Embedded Signup is not configured for this environment — set META_APP_ID and META_EMBEDDED_SIGNUP_CONFIG_ID.', code: 'EMBEDDED_SIGNUP_NOT_CONFIGURED' },
      501,
    ));
    await page.goto('/settings?tab=whatsapp');

    const cta = page.getByRole('button', { name: 'Connect WhatsApp (Guided Setup)' });
    await expect(cta).toBeVisible();
    await expect(cta).toBeDisabled();
    await expect(page.getByText(/Guided setup isn.t configured for this environment yet/)).toBeVisible();
  });

  test('happy path: full pipeline succeeds, auto-refreshes Meta Health on close', async ({ page }) => {
    await page.route('**/api/auth/me', jsonRoute(REAL_USER));
    await page.route('**/api/whatsapp/embedded-signup/config', jsonRoute(SIGNUP_CONFIG_AVAILABLE));
    await seedFakeFacebookSdk(page);
    // Stateful: /config/full must reflect "connected" only AFTER the exchange
    // succeeds — otherwise the settings page never mounts MetaHealthPanel
    // once the wizard's onOnboarded() invalidates the query, and the
    // auto-refresh this test is checking for could never fire regardless of
    // whether the real wiring works.
    let connected = false;
    await page.route('**/api/whatsapp/config/full', async (route) => {
      await jsonRoute(connected
        ? { ...NOT_CONNECTED_CONFIG, connected: true, setupMethod: 'embedded_signup', wabaId: 'waba_123', phoneNumberId: 'phone_456', configValid: true, onboardingStatus: allDoneStatus() }
        : NOT_CONNECTED_CONFIG)(route);
    });
    await page.route('**/api/whatsapp/embedded-signup/exchange', async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ code: 'mock_code_123', wabaId: 'waba_123', phoneNumberId: 'phone_456', businessId: 'biz_789' });
      connected = true;
      await jsonRoute({ success: true, onboardingStatus: allDoneStatus() })(route);
    });
    let healthChecked = false;
    await page.route('**/api/whatsapp/connection/health', async (route) => {
      healthChecked = true;
      await jsonRoute({ success: true, connected: true, issues: [], rootCause: null, recommendedFix: [], config: {}, token: {}, waba: {}, phone: {}, webhooks: {}, pin: {}, profile: {}, capabilities: {}, lastChecked: new Date().toISOString() })(route);
    });
    // Once connected, the settings page mounts these sibling panels too.
    await page.route('**/api/whatsapp/templates', jsonRoute({ success: true, templates: [] }));
    await page.route('**/api/whatsapp/flows', jsonRoute({ success: true, flows: [] }));
    await page.route('**/api/whatsapp/branches', jsonRoute({ success: true, branches: [] }));

    await page.goto('/settings?tab=whatsapp');
    await page.getByRole('button', { name: 'Connect WhatsApp (Guided Setup)' }).click();

    const dialog = page.getByRole('dialog', { name: 'Connect WhatsApp' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue with Facebook' }).click();
    await expect(dialog.getByText('Waiting for Facebook…')).toBeVisible();

    // Message arrives before FB.login's own callback resolves — proves the
    // "either order" correlation logic (embeddedSignupCorrelation.ts).
    await postSignupMessageFromFacebookOrigin(page, {
      type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH',
      data: { waba_id: 'waba_123', phone_number_id: 'phone_456', business_id: 'biz_789' },
    });
    await resolveFbLogin(page, { authResponse: { code: 'mock_code_123' } });

    await expect(dialog.getByText('Facebook returned the following')).toBeVisible();
    await expect(dialog.getByText('waba_123')).toBeVisible();

    const [exchangeReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/whatsapp/embedded-signup/exchange') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Confirm & Connect' }).click(),
    ]);
    expect(exchangeReq.method()).toBe('POST');

    await expect(dialog.getByText('WhatsApp is connected and fully configured.')).toBeVisible();
    for (const label of ['Saving configuration', 'Subscribing to webhooks', 'Registering phone number & PIN', 'Syncing business profile', 'Syncing message templates', 'Running health check']) {
      await expect(dialog.getByText(label)).toBeVisible();
    }

    await dialog.getByRole('button', { name: 'Go to Meta Health' }).click();
    // Drawer.tsx slides off-screen via a CSS transform rather than
    // unmounting/hiding on close — translate-x-full is its actual closed
    // signal, not toBeHidden() (the element stays in the DOM for the
    // exit transition, so it's still computed-visible to Playwright).
    await expect(dialog).toHaveClass(/translate-x-full/);
    await expect.poll(() => healthChecked).toBe(true); // MetaHealthPanel.autoRefreshOnMount fired without a manual click
  });

  test('cancel path: FB.login resolves with no authResponse — no exchange call is made', async ({ page }) => {
    await mockAuthAndBaseConfig(page);
    await seedFakeFacebookSdk(page);
    let exchangeCalled = false;
    await page.route('**/api/whatsapp/embedded-signup/exchange', async (route) => {
      exchangeCalled = true;
      await jsonRoute({ success: true })(route);
    });

    await page.goto('/settings?tab=whatsapp');
    await page.getByRole('button', { name: 'Connect WhatsApp (Guided Setup)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect WhatsApp' });
    await dialog.getByRole('button', { name: 'Continue with Facebook' }).click();
    await resolveFbLogin(page, { status: 'unknown' }); // no authResponse — Meta's cancel shape

    await expect(dialog.getByText('WhatsApp connection was not completed in Facebook.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Try Again' })).toBeVisible();
    expect(exchangeCalled).toBe(false);
  });

  test('Meta CANCEL message: shows Facebook\'s own cancellation, offers Try Again', async ({ page }) => {
    await mockAuthAndBaseConfig(page);
    await seedFakeFacebookSdk(page);

    await page.goto('/settings?tab=whatsapp');
    await page.getByRole('button', { name: 'Connect WhatsApp (Guided Setup)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect WhatsApp' });
    await dialog.getByRole('button', { name: 'Continue with Facebook' }).click();
    await expect(dialog.getByText('Waiting for Facebook…')).toBeVisible();

    await postSignupMessageFromFacebookOrigin(page, { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' });

    await expect(dialog.getByText('You cancelled the WhatsApp connection in Facebook.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Try Again' }).click();
    await expect(dialog.getByText('APForce will open a secure Facebook window')).toBeVisible(); // back to Welcome
  });

  test('partial pipeline failure: Success screen shows the failure, Retry Failed Steps calls /resume', async ({ page }) => {
    await mockAuthAndBaseConfig(page);
    await seedFakeFacebookSdk(page);
    await page.route('**/api/whatsapp/embedded-signup/exchange', jsonRoute({ success: true, onboardingStatus: partialFailureStatus() }));
    await page.route('**/api/whatsapp/embedded-signup/resume', jsonRoute({ success: true, onboardingStatus: allDoneStatus() }));

    await page.goto('/settings?tab=whatsapp');
    await page.getByRole('button', { name: 'Connect WhatsApp (Guided Setup)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect WhatsApp' });
    await dialog.getByRole('button', { name: 'Continue with Facebook' }).click();
    await postSignupMessageFromFacebookOrigin(page, {
      type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH',
      data: { waba_id: 'waba_123', phone_number_id: 'phone_456', business_id: 'biz_789' },
    });
    await resolveFbLogin(page, { authResponse: { code: 'mock_code_123' } });
    await dialog.getByRole('button', { name: 'Confirm & Connect' }).click();

    await expect(dialog.getByText(/one or more setup steps need attention/)).toBeVisible();
    await expect(dialog.getByText('Meta rate-limited the template list — try again shortly.')).toBeVisible();

    const [resumeReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/whatsapp/embedded-signup/resume') && r.method() === 'POST'),
      dialog.getByRole('button', { name: 'Retry Failed Steps' }).click(),
    ]);
    expect(resumeReq.method()).toBe('POST');
    await expect(dialog.getByText('WhatsApp is connected and fully configured.')).toBeVisible();
  });

  test('resume banner: shown for an incomplete embedded_signup connection, Finish Setup calls /resume', async ({ page }) => {
    await page.route('**/api/auth/me', jsonRoute(REAL_USER));
    await page.route('**/api/whatsapp/config/full', jsonRoute({
      ...NOT_CONNECTED_CONFIG,
      connected: true, setupMethod: 'embedded_signup', wabaId: 'waba_123', phoneNumberId: 'phone_456',
      configValid: true, onboardingStatus: partialFailureStatus(),
    }));
    await page.route('**/api/whatsapp/embedded-signup/config', jsonRoute(SIGNUP_CONFIG_AVAILABLE));
    await page.route('**/api/whatsapp/embedded-signup/resume', jsonRoute({ success: true, onboardingStatus: allDoneStatus() }));
    await page.route('**/api/whatsapp/connection/health', jsonRoute({ success: true, connected: true, issues: [], rootCause: null, recommendedFix: [], config: {}, token: {}, waba: {}, phone: {}, webhooks: {}, pin: {}, profile: {}, capabilities: {}, lastChecked: new Date().toISOString() }));
    await page.route('**/api/whatsapp/templates', jsonRoute({ success: true, templates: [] }));
    await page.route('**/api/whatsapp/flows', jsonRoute({ success: true, flows: [] }));
    await page.route('**/api/whatsapp/branches', jsonRoute({ success: true, branches: [] }));

    await page.goto('/settings?tab=whatsapp');
    await expect(page.getByText('WhatsApp setup is incomplete')).toBeVisible();
    await expect(page.getByText('5/6 steps finished')).toBeVisible();

    const [resumeReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/whatsapp/embedded-signup/resume') && r.method() === 'POST'),
      page.getByRole('button', { name: 'Finish Setup' }).click(),
    ]);
    expect(resumeReq.method()).toBe('POST');
  });

  test('mobile viewport (375px): wizard drawer has no horizontal overflow', async ({ page }) => {
    await mockAuthAndBaseConfig(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/settings?tab=whatsapp');

    await page.getByRole('button', { name: 'Connect WhatsApp (Guided Setup)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect WhatsApp' });
    await expect(dialog).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
    await expect(dialog.getByRole('button', { name: 'Continue with Facebook' })).toBeVisible();
  });
});
