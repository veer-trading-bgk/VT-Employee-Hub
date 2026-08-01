import { test, expect } from '@playwright/test';

/**
 * Phase 3 Task 1 — public journey page three states (mocked API, real page).
 * Live API three-state check is scripts/_tmp_verify_journey_p3t1.js.
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const CID = 'c1';
const IID = 'journey_test1';
const TOKEN = 'tok_valid';

const CORS = {
  'Access-Control-Allow-Origin': 'http://localhost:3001',
  'Access-Control-Allow-Credentials': 'true',
};

test.describe('Public journey route scaffold (Phase 3 Task 1)', () => {
  test('active / finished / invalid states render distinct shells', async ({ page }) => {
    await page.route('**/api/journeys/**', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
        return;
      }
      if (url.includes('/wrong')) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ error: 'Not found' }),
        });
        return;
      }
      if (url.includes('/done/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({
            success: true,
            instance: { journeyInstanceId: 'journey_done', status: 'completed' },
            definition: {
              name: 'Done journey',
              screens: [],
              brandingConfig: { primaryColor: '#112233' },
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS,
        body: JSON.stringify({
          success: true,
          instance: { journeyInstanceId: IID, status: 'opened' },
          definition: {
            name: 'Active journey',
            screens: [{ id: 'screen', title: 'One', fields: [] }],
            brandingConfig: { primaryColor: '#0ea5e9' },
          },
        }),
      });
    });

    await page.route('**/api/auth/**', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: CORS,
        body: JSON.stringify({ error: 'unauthenticated' }),
      });
    });

    // Active
    await page.goto(`/journey/${CID}/${IID}/${TOKEN}`);
    await expect(page.getByTestId('journey-active')).toBeVisible();
    await expect(page.getByText('Active journey')).toBeVisible();
    await expect(page.getByText('"id": "screen"')).toBeVisible();
    // No dashboard chrome
    await expect(page.getByText('Inbox')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);

    // Finished
    await page.goto(`/journey/${CID}/done/${TOKEN}`);
    await expect(page.getByTestId('journey-finished')).toBeVisible();
    await expect(page.getByText('Journey complete')).toBeVisible();

    // Invalid
    await page.goto(`/journey/${CID}/${IID}/wrong`);
    await expect(page.getByTestId('journey-invalid')).toBeVisible();
    await expect(page.getByText('Link not found or expired')).toBeVisible();
  });
});
