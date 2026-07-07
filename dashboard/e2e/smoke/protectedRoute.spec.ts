import { test, expect } from '@playwright/test';

/**
 * DOCUMENTED, NOT CURRENTLY RUNNING — see "How to reactivate" below.
 *
 * Proves ProtectedRoute's real role-gating logic in a real browser, against
 * the real bundled component — not inferred from reading the source. Written
 * for the Era 25 fix (2026-07-06, docs/bible/19_DECISION_LOG.md) to get real
 * proof, in a real browser, that `allowedRoles` gates correctly per role
 * (specifically: superadmin bypasses even an empty allowedRoles array; a
 * non-superadmin with a non-matching role is redirected away) — before
 * shipping real route protection on 7 pages.
 *
 * These tests navigate to /proute-verify-temp?case=..., a temporary harness
 * page that rendered the real AuthContext.Provider + the real ProtectedRoute
 * with a hand-fed fake user per case, needing no real login credentials. It
 * was used to generate the Era 25 proof (5/5 passed) and then fully removed
 * per an explicit decision not to leave any route — gated or not — sitting
 * in production once its one-time verification purpose was served.
 *
 * How to reactivate, if ProtectedRoute.tsx or AuthContext.tsx changes again
 * and this needs re-running: recreate a page under dashboard/src/app/ (any
 * folder name NOT starting with `_` — Next.js treats underscore-prefixed
 * folders as private/non-routable) that:
 *   1. Temporarily exports `AuthContext` itself from context/AuthContext.tsx
 *      (not just `useAuth`/`AuthProvider`) — reverted after, per the same
 *      "no export without an active caller" standard applied elsewhere.
 *   2. Reads a `?case=` query param selecting a { role, allowedRoles } pair.
 *   3. Wraps `<ProtectedRoute allowedRoles={...}>` in a real
 *      `<AuthContext.Provider value={{ user: {role, ...}, loading: false, ...noop fns }}>`.
 *   4. Renders `<div data-testid="protected-content">` as the guarded child.
 * The exact page used for Era 25's proof is retrievable from git history —
 * `git show <commit-before-removal>:dashboard/src/app/proute-verify-temp/page.tsx`.
 *
 * Run once reactivated (no auth dependency needed): npx playwright test protectedRoute --no-deps
 */

test.describe.skip('ProtectedRoute — real component, real browser', () => {
  test('superadmin with allowedRoles=[] still gets in — the exact claim behind /platform\'s guard', async ({ page }) => {
    await page.goto('/proute-verify-temp?case=superadmin_empty_array');
    await expect(page.getByTestId('protected-content')).toBeVisible();
    await expect(page).toHaveURL(/proute-verify-temp/); // no redirect happened
  });

  test('admin with allowedRoles=[] is redirected away — empty array is NOT "everyone allowed"', async ({ page }) => {
    await page.goto('/proute-verify-temp?case=admin_blocked_by_empty');
    // ProtectedRoute itself calls router.replace('/dashboard'); this app has no
    // /dashboard route, which itself forwards to /home — asserting "left the
    // verify page" rather than the exact bounce-through chain.
    await expect(page).not.toHaveURL(/proute-verify-temp/, { timeout: 5000 });
    await expect(page.getByTestId('protected-content')).not.toBeVisible();
  });

  test('admin with allowedRoles=["admin"] gets in', async ({ page }) => {
    await page.goto('/proute-verify-temp?case=admin_allowed');
    await expect(page.getByTestId('protected-content')).toBeVisible();
    await expect(page).toHaveURL(/proute-verify-temp/);
  });

  test('manager with allowedRoles=["admin"] is redirected away — the exact mechanism guarding /employees, /audit-log, /automation from a manager', async ({ page }) => {
    await page.goto('/proute-verify-temp?case=manager_blocked_by_admin_only');
    await expect(page).not.toHaveURL(/proute-verify-temp/, { timeout: 5000 });
    await expect(page.getByTestId('protected-content')).not.toBeVisible();
  });

  test('manager with allowedRoles=["admin","manager"] gets in — the exact mechanism letting a manager into /metric-target, /analytics, /campaigns', async ({ page }) => {
    await page.goto('/proute-verify-temp?case=manager_allowed_admin_manager');
    await expect(page.getByTestId('protected-content')).toBeVisible();
    await expect(page).toHaveURL(/proute-verify-temp/);
  });
});
