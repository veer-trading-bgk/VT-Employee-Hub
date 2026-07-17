import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-17 Stage 3 (360° audit), adversarial-review follow-up.
 * Proves, in a real browser against the real unmodified inferJourney()
 * (lib/contacts/journeyInference.ts), that the Customer 360 journey
 * timeline's Won step now agrees with the Sales KPI header's Won
 * calculation (sales/page.tsx:147,150 — `stageFlags.get(c.stage)?.isWon`)
 * for the same contact, using viir_trading's real 9-stage pipeline shape
 * with active_clients flagged isWon and churned flagged isLost.
 *
 * Before this fix, journeyInference.ts's reachedWon was order-based
 * ("current stage IS the highest-order non-lost stage") — since insurance
 * (order 7) outranks active_clients (order 4), a contact in active_clients
 * would have shown journeyWon=false while the KPI header correctly counted
 * them as Converted (kpiWon=true). The insurance_contact case is the
 * mirror image of that same bug: highest non-lost order but NOT flagged
 * isWon, which the old heuristic would have wrongly called Won.
 *
 * Harness page (dashboard/src/app/won-agreement-verify-temp/page.tsx) was
 * REMOVED after this spec captured its proof — this file is kept, skipped,
 * as the record of that proof, same as msgbubbleVerify.spec.ts /
 * kanbanVerify.spec.ts / bulkOutcomeVerify.spec.ts. Retrievable via
 * `git show <commit-before-removal>:dashboard/src/app/won-agreement-verify-temp/page.tsx`.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('journeyInference Won vs KPI header Won — real component, real browser (2026-07-17 Stage 3 follow-up)', () => {
  test('active_clients (isWon, NOT highest order): KPI and journey timeline both say Won — the exact case the old order-based heuristic got wrong', async ({ page }) => {
    await page.goto('/won-agreement-verify-temp');
    const c = page.getByTestId('case-active_clients_contact');
    await expect(c.getByTestId('case-active_clients_contact-kpi-won')).toHaveText('true');
    await expect(c.getByTestId('case-active_clients_contact-journey-won')).toHaveText('true');
  });

  test('insurance (highest non-lost order, NOT isWon): both say NOT Won — proves the fix is flag-based, not order-based', async ({ page }) => {
    await page.goto('/won-agreement-verify-temp');
    const c = page.getByTestId('case-insurance_contact');
    await expect(c.getByTestId('case-insurance_contact-kpi-won')).toHaveText('false');
    await expect(c.getByTestId('case-insurance_contact-journey-won')).toHaveText('false');
  });

  test('churned (isLost): both say NOT Won regardless of order', async ({ page }) => {
    await page.goto('/won-agreement-verify-temp');
    const c = page.getByTestId('case-churned_contact');
    await expect(c.getByTestId('case-churned_contact-kpi-won')).toHaveText('false');
    await expect(c.getByTestId('case-churned_contact-journey-won')).toHaveText('false');
  });

  test('qualified (ordinary early stage): both say NOT Won', async ({ page }) => {
    await page.goto('/won-agreement-verify-temp');
    const c = page.getByTestId('case-qualified_contact');
    await expect(c.getByTestId('case-qualified_contact-kpi-won')).toHaveText('false');
    await expect(c.getByTestId('case-qualified_contact-journey-won')).toHaveText('false');
  });
});
