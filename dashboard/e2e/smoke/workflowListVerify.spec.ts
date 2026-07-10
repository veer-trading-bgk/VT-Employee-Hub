import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-10 single-editor-migration Fix 4 (docs/phase3/TECHNICAL_DEBT.md).
 * Proves, in a real browser against the real unmodified WorkflowList: (1) no
 * "Simple" option exists anywhere in the create flow (the dropdown choice
 * was removed entirely), (2) "Create Workflow" navigates straight to
 * /automation/canvas/new — no drawer opens, (3) clicking an existing
 * workflow row navigates to /automation/canvas/:id, not a drawer.
 *
 * Uses the harness technique documented in protectedRoute.spec.ts's header
 * comment (Era 25) — a temporary, unauthenticated page under
 * dashboard/src/app/ rendering the real component with a fake AuthContext,
 * no real login credentials needed. Run with --no-deps.
 *
 * Harness page (dashboard/src/app/workflowlist-verify-temp/page.tsx) and
 * AuthContext's temporary `export` (dashboard/src/context/AuthContext.tsx)
 * were REMOVED after this spec captured its proof — this file is kept,
 * skipped, as the record of that proof, same as msgbubbleVerify.spec.ts.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('WorkflowList — single-editor migration, real component, real browser (2026-07-10)', () => {
  test('no "Simple" option exists anywhere on the page', async ({ page }) => {
    await page.goto('/workflowlist-verify-temp');
    await expect(page.getByTestId('harness-root')).toBeVisible();
    await expect(page.getByText('Simple', { exact: true })).toHaveCount(0);
    await expect(page.getByText('linear list of steps')).toHaveCount(0);
  });

  test('"Create Workflow" navigates straight to /automation/canvas/new — no dropdown, no drawer', async ({ page }) => {
    await page.goto('/workflowlist-verify-temp');
    await page.getByRole('button', { name: 'Create Workflow' }).click();
    // No intermediate dropdown to dismiss, no drawer/dialog rendered — direct navigation.
    await expect(page).toHaveURL(/\/automation\/canvas\/new/);
  });

  test('clicking an existing workflow row navigates to /automation/canvas/:id', async ({ page }) => {
    await page.goto('/workflowlist-verify-temp');
    await page.getByText('Existing Graph Workflow').click();
    await expect(page).toHaveURL(/\/automation\/canvas\/wf-1/);
  });
});
