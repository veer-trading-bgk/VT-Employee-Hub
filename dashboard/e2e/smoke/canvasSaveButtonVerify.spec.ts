import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-12 Track B2 Batch 1, Item 1.
 * Proves, in a real browser against the real unmodified WorkflowCanvas /
 * NodeConfigPanel, that selecting a node no longer hides the canvas's
 * top-right Save/Auto-arrange Panel behind the docked config panel (the audit
 * finding: NodeConfigPanel sat at `top-3` z-10, fully containing the
 * Save button's `top-right` Panel at z-5, and Playwright's own click
 * actionability check is what confirms this — it fails if another element
 * intercepts the pointer at the click point).
 *
 * Uses the harness technique documented in protectedRoute.spec.ts (Era 25) —
 * a temporary, unauthenticated page re-exporting the real canvas edit page
 * outside (v3), no login needed. serviceWorkers: 'block' + explicit CORS
 * headers on mocked responses — same two gotchas documented in
 * kanbanVerify.spec.ts's header comment.
 *
 * Harness page (dashboard/src/app/canvas-savefix-verify-temp/[id]/page.tsx)
 * was REMOVED after this spec captured its proof — kept here, skipped, as
 * the record, same as the other *Verify.spec.ts files in this folder.
 *
 * To reactivate: recreate the harness page (content is in this file's git
 * history / the session that added it — a one-line re-export of
 * `@/app/(v3)/automation/canvas/[id]/page`), then remove the .skip below.
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:3001', 'Access-Control-Allow-Credentials': 'true' };

const WORKFLOW = {
  id: 'wf-savefix-1', companyId: 'c1', name: 'Save Button Fix Verify', description: null, status: 'draft',
  trigger: { type: 'lead_created', conditions: [] },
  nodes: [
    { id: 'n1', type: 'send_message', config: { messageText: 'Hello' }, position: { x: 250, y: 120 } },
    { id: 'n2', type: 'end', config: {}, position: { x: 250, y: 320 } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  entryNodeId: 'n1',
  runCount: 0, lastRunAt: null, createdBy: 'u1', createdByName: 'Test',
  createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
};

test.describe.skip('Automation canvas — Save button occlusion fix (2026-07-12, Track B2 Batch 1)', () => {
  test('selecting a node keeps the Save button visible, unobscured, and clickable', async ({ page }) => {
    let putBody: unknown = null;

    await page.route('**/api/automations/wf-savefix-1', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' } });
        return;
      }
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, automation: WORKFLOW }) });
        return;
      }
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ success: true, automation: WORKFLOW }) });
        return;
      }
      await route.continue();
    });

    await page.goto('/canvas-savefix-verify-temp/wf-savefix-1');

    // Canvas loaded with the real workflow.
    await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue('Save Button Fix Verify');
    const node = page.locator('[data-id="n1"]');
    await expect(node).toBeVisible();

    // Select the node — this is what opens NodeConfigPanel and, pre-fix, hid Save.
    // "Delete node" only exists in NodeConfigPanel's header, so its visibility
    // also doubles as proof the panel actually opened (Item 3 of this batch).
    await node.click();
    await expect(page.getByRole('button', { name: 'Delete node' })).toBeVisible();

    // The real regression proof: Playwright's .click() performs an
    // actionability check (visible, stable, receives pointer events at its
    // own location) — this throws/times out if NodeConfigPanel still covers
    // the button, exactly the pre-fix failure mode.
    const saveButton = page.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    await expect.poll(() => putBody).not.toBeNull();

    await page.screenshot({ path: 'e2e/canvas-save-button-fix.png' });
  });
});
