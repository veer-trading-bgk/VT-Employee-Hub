import { test, expect } from '@playwright/test';

/**
 * Phase 3 Task 1+2 — public journey page shells + multi-screen field form.
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const CID = 'c1';
const IID = 'journey_test1';
const TOKEN = 'tok_valid';

const CORS = {
  'Access-Control-Allow-Origin': 'http://localhost:3001',
  'Access-Control-Allow-Credentials': 'true',
};

const MULTI_SCREEN_DEF = {
  name: 'Clinic intake',
  brandingConfig: { primaryColor: '#0ea5e9' },
  screens: [
    {
      id: 'screen',
      title: 'Patient',
      fields: [
        { id: 'full_name', label: 'Full name', type: 'text', required: true },
        {
          id: 'visit_type',
          label: 'Visit type',
          type: 'select',
          required: true,
          options: ['New', 'Follow-up'],
        },
      ],
    },
    {
      id: 'screen_2',
      title: 'Contact',
      fields: [
        { id: 'mobile', label: 'Mobile', type: 'phone' },
        { id: 'email', label: 'Email', type: 'email' },
      ],
    },
  ],
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
            screens: [{ id: 'screen', title: 'One', fields: [{ id: 'n', label: 'Name', type: 'text' }] }],
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

    await page.goto(`/journey/${CID}/${IID}/${TOKEN}`);
    await expect(page.getByTestId('journey-active')).toBeVisible();
    await expect(page.getByText('Active journey')).toBeVisible();
    await expect(page.getByTestId('journey-form')).toBeVisible();
    await expect(page.getByText('Inbox')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);

    await page.goto(`/journey/${CID}/done/${TOKEN}`);
    await expect(page.getByTestId('journey-finished')).toBeVisible();
    await expect(page.getByText('Journey complete')).toBeVisible();

    await page.goto(`/journey/${CID}/${IID}/wrong`);
    await expect(page.getByTestId('journey-invalid')).toBeVisible();
    await expect(page.getByText('Link not found or expired')).toBeVisible();
  });
});

test.describe('Public journey field form (Phase 3 Task 2)', () => {
  test('multi-screen nav, required blocking, and collected payload shape', async ({ page }) => {
    await page.route('**/api/journeys/**', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS,
        body: JSON.stringify({
          success: true,
          instance: { journeyInstanceId: IID, status: 'opened' },
          definition: MULTI_SCREEN_DEF,
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

    await page.goto(`/journey/${CID}/${IID}/${TOKEN}`);
    await expect(page.getByTestId('journey-form')).toBeVisible();
    await expect(page.getByTestId('journey-step-bar')).toBeVisible();
    await expect(page.getByText('Patient', { exact: true }).first()).toBeVisible();

    // Required blocking — empty continue stays on screen 1
    await page.getByTestId('journey-continue').click();
    await expect(page.getByText('This field is required').first()).toBeVisible();
    await expect(page.getByLabel('Full name')).toBeVisible();

    await page.getByLabel('Full name').fill('Ada Lovelace');
    await page.getByLabel('Visit type').selectOption('Follow-up');
    await page.getByTestId('journey-continue').click();

    // Screen 2
    await expect(page.getByLabel('Mobile')).toBeVisible();
    await page.getByLabel('Mobile').fill('9876543210');
    await page.getByLabel('Email').fill('ada@example.com');
    await page.getByTestId('journey-continue').click();

    // Review — payload shape matches create_journey_record keys
    await expect(page.getByTestId('journey-review')).toBeVisible();
    const json = await page.getByTestId('journey-collected-json').innerText();
    const parsed = JSON.parse(json) as {
      journeyRecord: Record<string, string>;
      submittedData: Record<string, string>;
    };
    expect(parsed).toHaveProperty('journeyRecord');
    expect(parsed).toHaveProperty('submittedData');
    expect(parsed.journeyRecord).toEqual({
      full_name: 'Ada Lovelace',
      visit_type: 'Follow-up',
      mobile: '9876543210',
      email: 'ada@example.com',
    });
    expect(parsed.submittedData).toEqual(parsed.journeyRecord);

    const win = await page.evaluate(() =>
      (window as Window & { __journeyCollected?: unknown }).__journeyCollected,
    );
    expect(win).toEqual(parsed);
  });
});
