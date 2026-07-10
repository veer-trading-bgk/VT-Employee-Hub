import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-10 "bulk actions partial failure" fix
 * (docs/phase3/TECHNICAL_DEBT.md). Proves, in a real browser against the
 * real unmodified decideBulkOutcome() (lib/bulkUpdateFeedback.ts): full
 * success clears the selection and shows a plain success toast; partial
 * failure shows both counts + the first failure reason and leaves ONLY the
 * failed ids selected (the retry affordance); total failure shows an error
 * toast with no success count; and "nothing attempted" (every selected
 * contact skipped upstream, e.g. all non-leads for assign) shows no toast
 * and doesn't touch the selection at all.
 *
 * Harness page (dashboard/src/app/bulk-outcome-verify-temp/page.tsx) was
 * REMOVED after this spec captured its proof — this file is kept, skipped,
 * as the record of that proof, same as msgbubbleVerify.spec.ts.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('decideBulkOutcome — real function, real browser (2026-07-10 bulk actions fix)', () => {
  test('full success: success toast, selection cleared', async ({ page }) => {
    await page.goto('/bulk-outcome-verify-temp');
    const c = page.getByTestId('case-full_success');
    await expect(c.getByTestId('toast-type')).toHaveText('success');
    await expect(c.getByTestId('message')).toHaveText('Assigned 3 contacts');
    await expect(c.getByTestId('retry-ids')).toHaveText('[]');
  });

  test('partial failure: error toast with both counts + first reason, only failed ids stay selected', async ({ page }) => {
    await page.goto('/bulk-outcome-verify-temp');
    const c = page.getByTestId('case-partial_failure');
    await expect(c.getByTestId('toast-type')).toHaveText('error');
    await expect(c.getByTestId('message')).toHaveText(
      'Assigned 2 contacts — 2 failed: Lead not found. Failed contacts stay selected — try again.',
    );
    await expect(c.getByTestId('retry-ids')).toHaveText('["b","d"]');
  });

  test('total failure: error toast, no success count, all failed ids stay selected', async ({ page }) => {
    await page.goto('/bulk-outcome-verify-temp');
    const c = page.getByTestId('case-total_failure');
    await expect(c.getByTestId('toast-type')).toHaveText('error');
    await expect(c.getByTestId('message')).toHaveText('Failed to assigned 1 contact: assign only applies to CRM leads');
    await expect(c.getByTestId('retry-ids')).toHaveText('["a"]');
  });

  test('nothing attempted: no toast, selection untouched (null, not cleared)', async ({ page }) => {
    await page.goto('/bulk-outcome-verify-temp');
    const c = page.getByTestId('case-nothing_attempted');
    await expect(c.getByTestId('toast-type')).toHaveText('none');
    await expect(c.getByTestId('retry-ids')).toHaveText('null');
  });
});
