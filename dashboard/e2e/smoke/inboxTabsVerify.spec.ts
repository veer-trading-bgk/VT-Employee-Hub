import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-11 Inbox status tabs redesign.
 * Proves, in a real browser against the real unmodified tab-bar JSX
 * (byte-identical copy from (v3)/inbox/page.tsx's ConversationList), that:
 * (1) all 4 tabs render inside one bounded container, (2) every tab shows
 * its count badge in the same style, including the deliberately-zero
 * "Unassigned" tab (chosen: always show, "0" included, never conditionally
 * hidden), (3) the active tab gets a distinct bg-primary-100 pill fill per
 * 04_DESIGN_SYSTEM.md's documented token meaning, not just text color, (4)
 * clicking a tab switches the active state with no functional regression.
 * Uses the harness technique from protectedRoute.spec.ts (Era 25).
 *
 * Harness page (dashboard/src/app/inboxtabs-verify-temp/page.tsx) was
 * REMOVED after this spec captured its proof — kept here, skipped.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('Inbox status tabs — real component, real browser (2026-07-11 redesign)', () => {
  test('all 4 tabs render with consistent badges, including zero', async ({ page }) => {
    await page.goto('/inboxtabs-verify-temp');
    await expect(page.getByRole('tablist', { name: 'Conversation status' })).toBeVisible();

    for (const id of ['open', 'unassigned', 'resolved', 'unread']) {
      await expect(page.getByTestId(`tab-${id}`)).toBeVisible();
      await expect(page.getByTestId(`badge-${id}`)).toBeVisible();
    }
    // Zero-count tab still shows its badge, with "0" — not hidden.
    await expect(page.getByTestId('badge-unassigned')).toHaveText('0');
    await expect(page.getByTestId('badge-open')).toHaveText('12');
    await expect(page.getByTestId('badge-unread')).toHaveText('128');
  });

  test('active tab gets a distinct filled pill background, not just text color', async ({ page }) => {
    await page.goto('/inboxtabs-verify-temp');
    const openTab = page.getByTestId('tab-open');
    const unassignedTab = page.getByTestId('tab-unassigned');

    await expect(openTab).toHaveAttribute('aria-selected', 'true');
    await expect(openTab).toHaveClass(/bg-primary-100/);
    await expect(unassignedTab).toHaveAttribute('aria-selected', 'false');
    await expect(unassignedTab).not.toHaveClass(/bg-primary-100/);
  });

  test('clicking a tab switches active state — no functional regression', async ({ page }) => {
    await page.goto('/inboxtabs-verify-temp');
    await page.getByTestId('tab-resolved').click();
    await expect(page.getByTestId('active-tab-readout')).toHaveText('active: resolved');
    await expect(page.getByTestId('tab-resolved')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-open')).toHaveAttribute('aria-selected', 'false');
  });

  test('dark mode — active pill uses the dark-mode token variant', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/inboxtabs-verify-temp');
    await expect(page.getByTestId('tab-open')).toHaveClass(/dark:bg-primary-900\/40/);
  });
});
