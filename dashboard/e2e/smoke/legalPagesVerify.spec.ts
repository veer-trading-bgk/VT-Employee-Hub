import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-10, Meta App Review legal pages. Confirms, in a real
 * browser with NO auth state at all (test.use below explicitly clears
 * storageState — same technique used for every unauthenticated-route check
 * this session), that all 3 pages load directly, render their real content,
 * and do NOT get redirected to /login by ProtectedRoute or any other gate.
 *
 * Kept here, skipped, as the record — no harness page needed this time,
 * these ARE the real production routes (public by design, not behind any
 * temporary bypass).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('Legal pages — public, unauthenticated (2026-07-10)', () => {
  test('/privacy-policy loads directly, no redirect to /login', async ({ page }) => {
    await page.goto('/privacy-policy');
    expect(page.url()).toContain('/privacy-policy');
    await expect(page).toHaveTitle(/Privacy Policy/);
    await expect(page.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: '4. Meta / WhatsApp Business Platform' })).toBeVisible();
    await expect(page.getByText('support@apforce.in').first()).toBeVisible();
  });

  test('/terms loads directly, no redirect to /login', async ({ page }) => {
    await page.goto('/terms');
    expect(page.url()).toContain('/terms');
    await expect(page).toHaveTitle(/Terms of Service/);
    await expect(page.getByRole('heading', { name: 'Terms of Service', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: '4. Your WhatsApp Business Account' })).toBeVisible();
  });

  test('/data-deletion loads directly, no redirect to /login, and does NOT claim an in-app delete flow exists', async ({ page }) => {
    await page.goto('/data-deletion');
    expect(page.url()).toContain('/data-deletion');
    await expect(page).toHaveTitle(/Data Deletion/);
    await expect(page.getByRole('heading', { name: 'Data Deletion Instructions', level: 1 })).toBeVisible();
    await expect(page.getByText('Data Deletion Request')).toBeVisible();
    // The removed (non-existent) in-app method must not appear anywhere.
    await expect(page.getByText('Delete Account', { exact: false })).toHaveCount(0);
    await expect(page.getByText('In-app request', { exact: false })).toHaveCount(0);
  });

  test('cross-links between the 3 pages work', async ({ page }) => {
    await page.goto('/privacy-policy');
    const footerNav = page.getByRole('navigation');
    await footerNav.getByRole('link', { name: 'Data Deletion Instructions' }).click();
    await expect(page).toHaveURL(/\/data-deletion$/);
    await page.getByRole('navigation').getByRole('link', { name: 'Terms of Service' }).click();
    await expect(page).toHaveURL(/\/terms$/);
  });
});
