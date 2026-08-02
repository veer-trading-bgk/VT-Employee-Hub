import { test, expect } from '@playwright/test';

/**
 * Phase 3 Task 1–3 — public journey shells, multi-screen form, webhook submit.
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

async function fillThroughReview(page: import('@playwright/test').Page) {
  await page.getByLabel('Full name').fill('Ada Lovelace');
  await page.getByLabel('Visit type').selectOption('Follow-up');
  await page.getByTestId('journey-continue').click();
  await expect(page.getByLabel('Mobile')).toBeVisible();
  await page.getByLabel('Mobile').fill('9876543210');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByTestId('journey-continue').click();
  await expect(page.getByTestId('journey-review')).toBeVisible();
}

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
  test('multi-screen nav, required blocking, and human-readable review summary', async ({ page }) => {
    await page.route('**/api/journeys/**', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } });
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

    await page.getByTestId('journey-continue').click();
    await expect(page.getByText('This field is required').first()).toBeVisible();
    await expect(page.getByLabel('Full name')).toBeVisible();

    await fillThroughReview(page);

    const summary = page.getByTestId('journey-review-summary');
    await expect(summary).toBeVisible();
    await expect(summary.getByRole('heading', { name: 'Patient' })).toBeVisible();
    await expect(summary.getByRole('heading', { name: 'Contact' })).toBeVisible();
    await expect(summary.getByText('Full name')).toBeVisible();
    await expect(summary.getByText('Ada Lovelace')).toBeVisible();
    await expect(summary.getByText('Visit type')).toBeVisible();
    await expect(summary.getByText('Follow-up')).toBeVisible();
    await expect(summary.getByText('Mobile')).toBeVisible();
    await expect(summary.getByText('9876543210')).toBeVisible();
    await expect(summary.getByText('Email')).toBeVisible();
    await expect(summary.getByText('ada@example.com')).toBeVisible();
    // Internal payload keys must not leak into the review UI.
    await expect(summary.getByText('journeyRecord')).toHaveCount(0);
    await expect(summary.getByText('submittedData')).toHaveCount(0);
    await expect(summary.getByText('full_name')).toHaveCount(0);
  });
});

test.describe('Public journey webhook submit (Phase 3 Task 3)', () => {
  test('200 webhook → thank-you screen; body is collectedPayload', async ({ page }) => {
    let webhookBody: unknown = null;

    await page.route('**/api/journeys/**', async (route) => {
      const req = route.request();
      const url = req.url();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } });
        return;
      }
      if (req.method() === 'POST' && url.includes('/webhook/')) {
        webhookBody = req.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ success: true, executionId: 'exec-1' }),
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
    await fillThroughReview(page);
    await expect(page.getByTestId('journey-review-summary')).toBeVisible();

    await page.getByTestId('journey-submit').click();
    await expect(page.getByTestId('journey-submitted')).toBeVisible();
    await expect(page.getByText('Thank you')).toBeVisible();
    // POST body still uses the internal { journeyRecord, submittedData } shape.
    expect(webhookBody).toEqual({
      journeyRecord: {
        full_name: 'Ada Lovelace',
        visit_type: 'Follow-up',
        mobile: '9876543210',
        email: 'ada@example.com',
      },
      submittedData: {
        full_name: 'Ada Lovelace',
        visit_type: 'Follow-up',
        mobile: '9876543210',
        email: 'ada@example.com',
      },
    });
  });

  test('404 webhook → Task 1 invalid view', async ({ page }) => {
    await page.route('**/api/journeys/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } });
        return;
      }
      if (req.method() === 'POST' && req.url().includes('/webhook/')) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ error: 'Not found' }),
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
    await fillThroughReview(page);
    await page.getByTestId('journey-submit').click();
    await expect(page.getByTestId('journey-invalid')).toBeVisible();
    await expect(page.getByText('Link not found or expired')).toBeVisible();
  });

  test('5xx webhook → retryable error, not invalid view', async ({ page }) => {
    let posts = 0;
    await page.route('**/api/journeys/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } });
        return;
      }
      if (req.method() === 'POST' && req.url().includes('/webhook/')) {
        posts += 1;
        if (posts === 1) {
          await route.fulfill({
            status: 502,
            contentType: 'application/json',
            headers: CORS,
            body: JSON.stringify({ error: 'Bad gateway' }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ success: true, executionId: 'exec-retry' }),
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
    await fillThroughReview(page);
    await page.getByTestId('journey-submit').click();

    await expect(page.getByTestId('journey-submit-error')).toBeVisible();
    await expect(page.getByText('Something went wrong')).toBeVisible();
    await expect(page.getByTestId('journey-invalid')).toHaveCount(0);
    await expect(page.getByTestId('journey-review')).toBeVisible();

    await page.getByTestId('journey-submit-error').getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('journey-submitted')).toBeVisible();
    expect(posts).toBe(2);
  });
});

test.describe('Public journey light contrast (system/app dark)', () => {
  test('Input/Select stay light when html.dark would otherwise apply; admin theme restored on leave', async ({ page }) => {
    // Root layout + ThemeProvider default to .dark when vt-theme !== 'light'.
    // Emulate an admin (or phone) that already prefers dark before landing.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('vt-theme', 'dark');
      } catch { /* ignore */ }
      document.documentElement.classList.add('dark');
    });

    await page.route('**/api/journeys/**', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } });
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
    await expect(page.getByTestId('journey-light-shell')).toBeVisible();
    await expect(page.getByTestId('journey-form')).toBeVisible();

    // Shell must clear html.dark for this visit (wins over ThemeProvider).
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.classList.contains('dark')),
    ).toBe(false);

    const nameInput = page.getByLabel('Full name');
    const visitSelect = page.getByLabel('Visit type');
    await expect(nameInput).toBeVisible();

    const [inputBg, selectBg, colorScheme] = await Promise.all([
      nameInput.evaluate((el) => getComputedStyle(el).backgroundColor),
      visitSelect.evaluate((el) => getComputedStyle(el).backgroundColor),
      page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    ]);

    // v3 Input/Select use bg-white → rgb(255, 255, 255). dark:bg-neutral-900
    // would be a near-navy (~rgb(23, 23, 23) / similar) — reject dark surfaces.
    expect(inputBg).toMatch(/^rgb\(\s*255,\s*255,\s*255\s*\)$/);
    expect(selectBg).toMatch(/^rgb\(\s*255,\s*255,\s*255\s*\)$/);
    expect(colorScheme).toBe('light');

    // Leave the (journey) layout via same-document navigation so cleanup runs
    // without a full reload (full reload would re-run the root bootstrap and
    // mask a broken restore). Next App Router intercepts same-origin <a> clicks.
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '/login';
      a.setAttribute('data-testid', 'e2e-leave-journey');
      a.textContent = 'leave';
      a.style.cssText = 'position:fixed;left:0;top:0;z-index:9999';
      document.body.appendChild(a);
    });
    await page.getByTestId('e2e-leave-journey').click();
    await page.waitForURL(/\/login/);
    await expect(page.getByTestId('journey-light-shell')).toHaveCount(0);

    // Cleanup must restore the admin's vt-theme=dark preference on <html>.
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.style.colorScheme),
    ).toBe('');
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.classList.contains('dark')),
    ).toBe(true);
    await expect.poll(async () =>
      page.evaluate(() => localStorage.getItem('vt-theme')),
    ).toBe('dark');
  });
});
