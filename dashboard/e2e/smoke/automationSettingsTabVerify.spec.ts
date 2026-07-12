import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-12 Track B2 Batch 1, Item 6.
 * Proves, in a real browser against the real unmodified WelcomeMessagePanel /
 * WorkingHoursPanel / DelayedResponsePanel, that relocating them from the
 * Workflows tab into a new Settings tab (automation/page.tsx) didn't disturb
 * their load/toggle/auto-save behavior — an explicit regression check given
 * how much toggle-save work these exact 3 panels went through earlier the
 * same night (docs/phase3/TECHNICAL_DEBT.md, Track A). The panels themselves
 * were not touched, only their JSX location in automation/page.tsx moved.
 *
 * Uses the harness technique documented in protectedRoute.spec.ts (Era 25) —
 * a temporary, unauthenticated page rendering AutomationPageInner (itself
 * temporarily exported from automation/page.tsx, reverted after) outside
 * (v3), no login needed. serviceWorkers: 'block' + explicit CORS headers on
 * mocked responses — same two gotchas documented in kanbanVerify.spec.ts's
 * header comment.
 *
 * Harness page (dashboard/src/app/automation-settings-verify-temp/page.tsx)
 * and AutomationPageInner's temporary export were REMOVED/reverted after this
 * spec captured its proof — kept here, skipped, as the record.
 *
 * To reactivate: re-export `AutomationPageInner` from automation/page.tsx,
 * recreate the harness page (content is in this file's git history / the
 * session that added it), then remove the .skip below.
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:3001', 'Access-Control-Allow-Credentials': 'true' };

function mockConfigRoute(page: import('@playwright/test').Page, path: string, initialConfig: object, onPut?: (body: unknown) => void) {
  let config = initialConfig;
  return page.route(`**${path}`, async (route) => {
    const method = route.request().method();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' } });
      return;
    }
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ config }) });
      return;
    }
    if (method === 'PUT') {
      config = route.request().postDataJSON();
      onPut?.(config);
      await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ config }) });
      return;
    }
    await route.continue();
  });
}

test.describe.skip('Automation — Settings tab relocation regression check (2026-07-12, Track B2 Batch 1)', () => {
  test('Welcome Message, Working Hours, and Delayed Response panels all load, toggle, and auto-save correctly under the new Settings tab', async ({ page }) => {
    const welcomePuts: unknown[] = [];
    const hoursPuts: unknown[] = [];
    const oooPuts: unknown[] = [];
    const delayedPuts: unknown[] = [];

    // Dashboard tab mounts first (AutomationPageInner's default activeTab) —
    // mock its two endpoints so the initial render has nothing unmocked to fetch.
    await page.route('**/api/automations/stats', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, stats: { total: 0, active: 0, draft: 0, paused: 0, totalExecutions: 0, successRate: 0 } }) }));
    await page.route('**/api/automations/executions*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, executions: [] }) }));
    await page.route('**/api/whatsapp/templates', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ templates: [] }) }));

    await mockConfigRoute(page, '/api/whatsapp/welcome-config', { enabled: false, messageType: 'template', templateName: '', language: 'en', bodyText: '', buttons: [], ctaButtons: [] }, (b) => welcomePuts.push(b));
    await mockConfigRoute(page, '/api/whatsapp/hours-config', {
      enabled: false, timezone: 'Asia/Kolkata',
      schedule: { monday: { closed: false, open: '09:00', close: '18:00' }, tuesday: { closed: false, open: '09:00', close: '18:00' }, wednesday: { closed: false, open: '09:00', close: '18:00' }, thursday: { closed: false, open: '09:00', close: '18:00' }, friday: { closed: false, open: '09:00', close: '18:00' }, saturday: { closed: true, open: '09:00', close: '18:00' }, sunday: { closed: true, open: '09:00', close: '18:00' } },
    }, (b) => hoursPuts.push(b));
    await mockConfigRoute(page, '/api/whatsapp/ooo-config', { enabled: false, messageText: '' }, (b) => oooPuts.push(b));
    await mockConfigRoute(page, '/api/whatsapp/delayed-response-config', { enabled: false, delayAmount: 5, delayUnit: 'minutes', messageText: '' }, (b) => delayedPuts.push(b));

    await page.goto('/automation-settings-verify-temp');

    // Workflows tab should now contain ONLY the workflow list — no settings panels.
    await page.route('**/api/automations', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, automations: [] }) }));
    await page.getByRole('button', { name: 'Workflows' }).click();
    await expect(page.getByText('Welcome Message', { exact: true })).not.toBeVisible();
    await expect(page.getByText('Working Hours & Out of Office')).not.toBeVisible();
    await expect(page.getByText('Delayed Response Message')).not.toBeVisible();

    // Settings tab should contain all 3 panels.
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Welcome Message', { exact: true })).toBeVisible();
    await expect(page.getByText('Working Hours & Out of Office')).toBeVisible();
    await expect(page.getByText('Delayed Response Message')).toBeVisible();

    // Toggle each panel's master switch on and confirm the real auto-save
    // fires (a PUT lands) and the real success toast appears — proves the
    // exact toggle-save mechanism (Track A's earlier fix) still works after
    // the move, not just that the component renders.
    await page.getByRole('switch', { name: 'Enable welcome message' }).click({ force: true });
    await expect(page.getByText('Welcome message saved')).toBeVisible();
    expect(welcomePuts).toHaveLength(1);
    expect((welcomePuts[0] as { enabled: boolean }).enabled).toBe(true);

    await page.getByRole('switch', { name: 'Enable working hours' }).click({ force: true });
    await expect(page.getByText('Working hours saved')).toBeVisible();
    expect(hoursPuts).toHaveLength(1);
    expect((hoursPuts[0] as { enabled: boolean }).enabled).toBe(true);

    await page.getByRole('switch', { name: 'Enable delayed response message' }).click({ force: true });
    await expect(page.getByText('Delayed response saved')).toBeVisible();
    expect(delayedPuts).toHaveLength(1);
    expect((delayedPuts[0] as { enabled: boolean }).enabled).toBe(true);

    await page.screenshot({ path: 'e2e/automation-settings-tab.png' });
  });
});
