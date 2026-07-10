import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-09 Track A4 Batch 2 (docs/phase3/TECHNICAL_DEBT.md).
 * Proves, in a real browser against the real unmodified WorkflowRow and
 * WorkflowNameField components: (1) an active workflow's delete button is
 * disabled with a "pause first" tooltip instead of vanishing entirely, a
 * draft workflow's delete button is enabled and fires onDelete with the
 * right id, (2) editing the canvas name field and blurring calls onSave
 * with the trimmed value, and an unchanged or empty edit does not call
 * onSave at all.
 *
 * Uses the harness technique documented in protectedRoute.spec.ts's header
 * comment (Era 25) — a temporary, unauthenticated page under
 * dashboard/src/app/ rendering the real components directly with fake
 * props, no real login credentials needed. Both components under test are
 * pure/presentational (no auth or query context), so this harness needed no
 * API mocking or service-worker blocking, unlike kanbanVerify.spec.ts.
 *
 * Harness page (dashboard/src/app/batch2-verify-temp/page.tsx) and both
 * temporary `export`s (WorkflowList.tsx, automation/canvas/[id]/page.tsx)
 * were REMOVED after this spec captured its proof — this file is kept,
 * skipped, as the record of that proof, same as msgbubbleVerify.spec.ts.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('WorkflowRow delete + WorkflowNameField rename — real components, real browser (2026-07-09 Track A4 Batch 2)', () => {
  test('active workflow: delete button is disabled with the "pause first" tooltip, not hidden', async ({ page }) => {
    await page.goto('/batch2-verify-temp');
    const row = page.getByTestId('row-active');
    const deleteBtn = row.getByRole('button', { name: 'Pause this workflow before deleting it' });
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeDisabled();

    await deleteBtn.click({ force: true }); // disabled — even a forced click must not fire the handler
    await expect(page.getByTestId('delete-calls')).toHaveText('[]');
  });

  test('draft workflow: delete button is enabled, labeled "Delete", and fires onDelete with the workflow id', async ({ page }) => {
    await page.goto('/batch2-verify-temp');
    const row = page.getByTestId('row-draft');
    const deleteBtn = row.getByRole('button', { name: 'Delete', exact: true });
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeEnabled();

    await deleteBtn.click();
    await expect(page.getByTestId('delete-calls')).toHaveText('["wf-draft"]');
  });

  test('rename field: editing and blurring calls onSave with the trimmed new name', async ({ page }) => {
    await page.goto('/batch2-verify-temp');
    const input = page.getByLabel('Workflow name');
    await expect(input).toHaveValue('Draft Flow');

    await input.fill('  Renamed Flow  ');
    await input.blur();

    await expect(page.getByTestId('rename-calls')).toHaveText('["Renamed Flow"]');
    await expect(input).toHaveValue('Renamed Flow'); // local state reflects the trimmed value
  });

  test('rename field: unchanged value on blur does not call onSave', async ({ page }) => {
    await page.goto('/batch2-verify-temp');
    const input = page.getByLabel('Workflow name');
    await input.click();
    await input.blur();
    await expect(page.getByTestId('rename-calls')).toHaveText('[]');
  });

  test('rename field: clearing to empty and blurring reverts silently, does not call onSave', async ({ page }) => {
    await page.goto('/batch2-verify-temp');
    const input = page.getByLabel('Workflow name');
    await input.fill('   ');
    await input.blur();

    await expect(page.getByTestId('rename-calls')).toHaveText('[]');
    await expect(input).toHaveValue('Draft Flow'); // reverted to the original
  });

  test('rename field: Escape reverts to the original without saving', async ({ page }) => {
    await page.goto('/batch2-verify-temp');
    const input = page.getByLabel('Workflow name');
    await input.fill('Half-typed change');
    await input.press('Escape');

    await expect(input).toHaveValue('Draft Flow');
    await expect(page.getByTestId('rename-calls')).toHaveText('[]');
  });
});
