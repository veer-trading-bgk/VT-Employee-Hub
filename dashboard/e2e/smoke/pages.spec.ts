import { test, expect } from '@playwright/test';

// All tests in this file use the saved auth state from auth.setup.ts.
// The sidebar <aside> being visible on each page confirms auth passed.

async function expectPageLoaded(page: Parameters<typeof test>[1] extends (arg: { page: infer P }) => unknown ? P : never, url: string) {
  await page.goto(url);
  // Sidebar confirms ProtectedRoute passed and layout rendered
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
  // Must not have bounced to login
  await expect(page).not.toHaveURL(/\/login/);
}

test('dashboard (My Work) loads', async ({ page }) => {
  await expectPageLoaded(page, '/home');
  await expect(page.getByText('My Work', { exact: false })).toBeVisible();
});

test('inbox loads', async ({ page }) => {
  await expectPageLoaded(page, '/inbox');
  await expect(page.getByText('Inbox', { exact: false })).toBeVisible();
});

test('campaigns loads', async ({ page }) => {
  await expectPageLoaded(page, '/campaigns');
  await expect(page.getByText('Campaigns', { exact: false })).toBeVisible();
});

test('templates tab loads inside campaigns', async ({ page }) => {
  await expectPageLoaded(page, '/campaigns');
  // Click the Templates tab
  await page.getByRole('button', { name: /templates/i }).click();
  // Template content should appear
  await expect(page.getByText('Templates', { exact: false }).first()).toBeVisible();
});

test('automation loads', async ({ page }) => {
  await expectPageLoaded(page, '/automation');
  await expect(page.getByText('Automation', { exact: false })).toBeVisible();
});
