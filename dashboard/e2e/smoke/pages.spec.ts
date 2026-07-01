import { test, expect, type Page } from '@playwright/test';

// All tests in this file use the saved auth state from auth.setup.ts.
// The sidebar <aside> being visible on each page confirms auth passed.

async function expectPageLoaded(page: Page, url: string) {
  await page.goto(url);
  // Sidebar confirms ProtectedRoute passed and layout rendered
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
  // Must not have bounced to login
  await expect(page).not.toHaveURL(/\/login/);
}

test('dashboard (My Work) loads', async ({ page }) => {
  await expectPageLoaded(page, '/home');
  await expect(page.getByText('My Work', { exact: false }).first()).toBeVisible();
});

test('inbox loads', async ({ page }) => {
  await expectPageLoaded(page, '/inbox');
  await expect(page.getByText('Inbox', { exact: false }).first()).toBeVisible();
});

test('campaigns loads', async ({ page }) => {
  await expectPageLoaded(page, '/campaigns');
  await expect(page.getByText('Campaigns', { exact: false }).first()).toBeVisible();
});

test('templates tab loads inside campaigns', async ({ page }) => {
  await expectPageLoaded(page, '/campaigns');
  await page.getByRole('button', { name: /templates/i }).click();
  await expect(page.getByText('Templates', { exact: false }).first()).toBeVisible();
});

test('automation loads', async ({ page }) => {
  await expectPageLoaded(page, '/automation');
  await expect(page.getByRole('heading', { name: 'Automation' })).toBeVisible();
});
