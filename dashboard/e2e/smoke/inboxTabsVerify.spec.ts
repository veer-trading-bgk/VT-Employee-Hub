import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-11 Inbox status tabs redesign + overflow-fix regression.
 * Proves, in a real browser against the real unmodified tab-bar JSX
 * (byte-identical copy from (v3)/inbox/page.tsx's ConversationList, wrapped
 * in its real parent's `w-[280px] shrink-0` sidebar container per
 * inbox/page.tsx:2273-2276), that: (1) all 4 tabs render inside one bounded
 * container, (2) every tab shows its count badge in the same style,
 * including the deliberately-zero "Unassigned" tab (chosen: always show,
 * "0" included, never conditionally hidden), (3) the active tab gets a
 * distinct bg-primary-100 pill fill per 04_DESIGN_SYSTEM.md's documented
 * token meaning, not just text color, (4) clicking a tab switches the
 * active state with no functional regression, (5) — the regression this
 * revision fixes — all 4 tabs fit inside the REAL 280px sidebar with no
 * clipping and no horizontal scroll. 272369f shipped this same tab bar
 * verified only at an assumed 320px width; the real sidebar is 280px, and
 * `flex-1` buttons with un-shrinkable text content overflowed it, clipping
 * "Unread". Fix: dropped flex-1 (natural/shrink-0 button widths instead of
 * forced equal-width), tightened padding/gaps, text-[10px] (a real
 * micro-typography token per 10_DESIGN_SYSTEM.md's type scale, not an
 * arbitrary size), and kept overflow-x-auto + scrollbar-none as a safety
 * net only — verified NOT to engage at 280px (~23px of real slack measured
 * via getBoundingClientRect, not just "no visible scrollbar").
 *
 * Harness page (dashboard/src/app/inboxtabs-verify-temp/page.tsx) was
 * REMOVED after this spec captured its proof — kept here, skipped.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('Inbox status tabs — real component, real browser (2026-07-11 redesign + overflow fix)', () => {
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

  test('REGRESSION GUARD — all 4 tabs fit inside the real 280px sidebar, no clipping', async ({ page }) => {
    await page.goto('/inboxtabs-verify-temp');
    const tablist = page.getByTestId('tablist');
    const tablistBox = await tablist.boundingBox();
    const unreadBox = await page.getByTestId('tab-unread').boundingBox();
    expect(tablistBox).not.toBeNull();
    expect(unreadBox).not.toBeNull();
    // The last tab's right edge must land inside the tablist's own box —
    // this is the exact measurement that caught 272369f's clipped "Unread".
    expect(unreadBox!.x + unreadBox!.width).toBeLessThanOrEqual(tablistBox!.x + tablistBox!.width + 0.5);
    // No horizontal scroll needed at the real width — overflow-x-auto is a
    // safety net for cross-browser font-metric variance, not the fit strategy.
    const hasScroll = await tablist.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(hasScroll).toBe(false);
  });
});
