import { test, expect } from '@playwright/test';

// This test runs WITHOUT the saved auth state (no storageState dependency)
// to verify the login flow itself works end-to-end.
test.use({ storageState: { cookies: [], origins: [] } });

test('login page renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('APForce')).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('login redirects unauthenticated users', async ({ page }) => {
  await page.goto('/inbox');
  // ProtectedRoute should send unauthenticated users to /login
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});
