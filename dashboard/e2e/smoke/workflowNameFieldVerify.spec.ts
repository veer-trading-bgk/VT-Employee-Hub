import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-10. First describe block below is the original
 * regression investigation (read-only diagnosis): proves, against the REAL
 * unmodified WorkflowCanvasNewPage/WorkflowCanvasEditPage as they existed
 * BEFORE the fix, that (1) the create route never showed a name input, and
 * (2) the edit route's rename field already worked functionally (a
 * discoverability gap, not a broken mutation). Second describe block below
 * verifies the fix built on top of that diagnosis: the pencil-icon
 * affordance, and the ?new=1-driven auto-focus-only-once-at-creation logic.
 *
 * Uses the harness technique from protectedRoute.spec.ts (Era 25) — real
 * components re-exported at routes outside (v3), bypassing ProtectedRoute
 * (no fake AuthContext needed; neither component calls useAuth()).
 * serviceWorkers: 'block' + explicit CORS headers — same two gotchas
 * documented in kanbanVerify.spec.ts's header comment.
 *
 * Harness pages (dashboard/src/app/canvas-verify-temp/[id]/page.tsx,
 * dashboard/src/app/canvas-verify-temp-new/page.tsx) were REMOVED after
 * this spec captured its proof — kept here, skipped, as the record.
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:3001', 'Access-Control-Allow-Credentials': 'true' };

const AUTOMATION = {
  id: 'wf-verify-1', companyId: 'c1', name: 'New workflow', description: null, status: 'draft',
  trigger: { type: 'lead_created', conditions: [] }, nodes: [{ id: 'n-end', type: 'end', config: {} }], edges: [],
  entryNodeId: 'n-end', runCount: 0, lastRunAt: null, createdBy: 'u1', createdAt: '2026-07-10T00:00:00.000Z',
};

test.describe.skip('Automation canvas — workflow name field (2026-07-10 regression investigation)', () => {
  test('CREATE route (/automation/canvas/new): no name input is ever shown — POSTs a hardcoded name and redirects immediately', async ({ page }) => {
    let postBody: unknown = null;
    await page.route('**/api/automations', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
        return;
      }
      if (route.request().method() === 'POST') {
        postBody = route.request().postDataJSON();
        // Delay so the pre-redirect state is observable.
        await new Promise((r) => setTimeout(r, 800));
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, automation: AUTOMATION }) });
        return;
      }
      await route.continue();
    });

    await page.goto('/canvas-verify-temp-new');

    // While the POST is in flight, this is the ENTIRE page — no name input exists anywhere.
    await expect(page.getByText('Creating new workflow…')).toBeVisible();
    const inputs = await page.locator('input').count();
    expect(inputs).toBe(0);

    // Confirm what was actually posted — the name was decided by the app, not the user.
    await page.waitForTimeout(900);
    expect((postBody as { name: string }).name).toBe('New workflow');
  });

  test('EDIT route (/automation/canvas/[id]): WorkflowNameField renders as a real editable input, and blurring after a change fires the rename PUT', async ({ page }) => {
    let putBody: unknown = null;
    await page.route('**/api/automations/wf-verify-1', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS' } });
        return;
      }
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, automation: AUTOMATION }) });
        return;
      }
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, automation: { ...AUTOMATION, name: (putBody as { name: string }).name } }) });
        return;
      }
      await route.continue();
    });

    await page.goto('/canvas-verify-temp/wf-verify-1');

    const nameInput = page.getByRole('textbox', { name: 'Workflow name' });
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('New workflow');
    await expect(nameInput).toBeEditable();

    await nameInput.fill('Renamed via test');
    await nameInput.blur();

    await expect.poll(() => putBody).toEqual({ name: 'Renamed via test' });
  });
});

test.describe.skip('Automation canvas — workflow name FIX verification (2026-07-10, both fixes approved)', () => {
  function mockAutomation(page: import('@playwright/test').Page, id: string, name: string) {
    let putBody: unknown = null;
    return {
      putBody: () => putBody,
      route: page.route(`**/api/automations/${id}`, async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS' } });
          return;
        }
        if (route.request().method() === 'GET') {
          await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, automation: { ...AUTOMATION, id, name } }) });
          return;
        }
        if (route.request().method() === 'PUT') {
          putBody = route.request().postDataJSON();
          await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, automation: { ...AUTOMATION, id, ...(putBody as object) } }) });
          return;
        }
        await route.continue();
      }),
    };
  }

  test('creation redirect includes ?new=1 (canvas/new -> real edit route)', async ({ page }) => {
    await page.route('**/api/automations', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
        return;
      }
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, automation: AUTOMATION }) });
        return;
      }
      await route.continue();
    });

    const seenUrls: string[] = [];
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) seenUrls.push(frame.url()); });

    await page.goto('/canvas-verify-temp-new');
    // ProtectedRoute on the real /automation/canvas/[id] route bounces this
    // to /login almost immediately (ADHOC harness has no auth) — the
    // intermediate navigation is still observable via framenavigated before
    // that happens, which is all this test needs: the redirect TARGET, not
    // that the protected page then renders successfully (covered below via
    // the harness route instead).
    await page.waitForTimeout(1000);
    expect(seenUrls.some((u) => /\/automation\/canvas\/wf-verify-1\?new=1/.test(u))).toBe(true);
  });

  test('just created (?new=1, name still default): name field is focused AND text is selected on mount', async ({ page }) => {
    const m = mockAutomation(page, 'wf-just-created', 'New workflow');
    await m.route;
    await page.goto('/canvas-verify-temp/wf-just-created?new=1');

    const nameInput = page.getByRole('textbox', { name: 'Workflow name' });
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toBeFocused();

    const selection = await nameInput.evaluate((el: HTMLInputElement) => ({
      start: el.selectionStart, end: el.selectionEnd, value: el.value,
    }));
    expect(selection).toEqual({ start: 0, end: selection.value.length, value: 'New workflow' });

    // Typing replaces the selected text outright (proves select(), not just focus()).
    await page.keyboard.type('My First Workflow');
    await nameInput.blur();
    await expect.poll(() => m.putBody()).toEqual({ name: 'My First Workflow' });

    // ?new=1 was stripped from the URL after being consumed — a refresh
    // later on this same tab won't re-trigger auto-focus mid-edit.
    await expect.poll(() => page.url()).not.toContain('new=1');
  });

  test('opened later (no ?new=1), even though still untitled: name field does NOT auto-focus', async ({ page }) => {
    const m = mockAutomation(page, 'wf-opened-later', 'New workflow');
    await m.route;
    await page.goto('/canvas-verify-temp/wf-opened-later'); // no ?new=1 — this is how WorkflowList.openEdit() always navigates

    const nameInput = page.getByRole('textbox', { name: 'Workflow name' });
    await expect(nameInput).toBeVisible();
    await expect(nameInput).not.toBeFocused();
  });

  test('pencil-icon affordance is visible at rest — no hover needed', async ({ page }) => {
    const m = mockAutomation(page, 'wf-affordance', 'Some Named Workflow');
    await m.route;
    await page.goto('/canvas-verify-temp/wf-affordance');

    // Never hover — this is the whole point: the OLD field only revealed
    // anything on hover (a faint border). The icon must be visible without it.
    const pencil = page.locator('svg.lucide-pencil');
    await expect(pencil).toBeVisible();
  });
});
