/**
 * Live sandbox E2E — Event Booking Pay & Register against production.
 * Completes Razorpay Test Mode via Netbanking → demo bank Success.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });
test.setTimeout(240_000);

const ARTIFACT = path.join(__dirname, 'sandbox-evidence.json');

test('Sandbox Event Booking — Pay & Register through Razorpay test Checkout', async ({ page, context }) => {
  const url = process.env.SANDBOX_JOURNEY_URL;
  if (!url) throw new Error('SANDBOX_JOURNEY_URL required');

  const evidence: Record<string, unknown> = { url, steps: [] as string[] };
  const note = (s: string) => {
    (evidence.steps as string[]).push(`${new Date().toISOString()} ${s}`);
    console.log(s);
  };

  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('journey-form')).toBeVisible({ timeout: 30_000 });
  note('opened journey form');

  await page.getByLabel(/Full Name/i).fill('Sandbox E2E');
  await page.getByLabel(/email/i).fill('sandbox-e2e@example.com');
  await page.getByLabel(/Phone/i).fill('9901251785');
  await page.getByTestId('journey-continue').click();

  await expect(page.getByLabel(/Event/i)).toBeVisible();
  await page.getByLabel(/Event/i).selectOption({ label: 'Dandiya Raas Utsav' });
  await page.getByLabel(/Number of Tickets/i).fill('1');
  await page.getByTestId('journey-continue').click();

  await expect(page.getByTestId('journey-review')).toBeVisible();
  const payBtn = page.getByTestId('journey-submit');
  await expect(payBtn).toHaveAttribute('data-pay-action', 'pay-register');
  note('Review: Pay & Register visible');
  await page.screenshot({ path: path.join(__dirname, 'evidence-review.png'), fullPage: true });

  const checkoutPromise = page.waitForResponse(
    (r) => r.url().includes('/checkout') && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await payBtn.click();
  const checkoutRes = await checkoutPromise;
  const checkoutJson = await checkoutRes.json();
  evidence.checkout = checkoutJson;
  note(`checkout ${checkoutRes.status()} order=${checkoutJson.order_id} amount=${checkoutJson.amount}`);
  expect(checkoutRes.status()).toBe(201);
  expect(checkoutJson.amount).toBe(59000);

  const checkoutFrame = page.frameLocator('iframe').first();
  await expect(
    checkoutFrame.getByTestId('title').or(checkoutFrame.getByRole('heading', { name: /Contact details/i })),
  ).toBeVisible({ timeout: 45_000 });
  note('Razorpay Checkout UI visible');
  await page.screenshot({ path: path.join(__dirname, 'evidence-checkout-open.png'), fullPage: true });

  const contactHeading = checkoutFrame.getByRole('heading', { name: /Contact details/i });
  if (await contactHeading.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await checkoutFrame.locator('input[type="tel"]').first().fill('9901251785');
    await checkoutFrame.getByRole('button', { name: /^Continue$/i }).click();
    note('contact continue');
    await page.waitForTimeout(1500);
  }

  // Netbanking → Yes Bank → demo bank Success (popup or same page)
  await checkoutFrame.getByTestId('netbanking').or(checkoutFrame.getByTestId('Netbanking')).first().click({ force: true });
  note('selected Netbanking');
  await page.waitForTimeout(1000);

  const bankBtn = checkoutFrame.getByText(/Yes Bank/i).first();
  await expect(bankBtn).toBeVisible({ timeout: 15_000 });

  // Arm popup waiter before the click that opens the demo bank
  const popupPromise = context.waitForEvent('page', { timeout: 60_000 }).catch(() => null);
  await bankBtn.click();
  note('clicked Yes Bank');

  // Some builds require an explicit Pay after bank select
  const payNow = checkoutFrame.getByRole('button', { name: /Pay ₹|Pay |Continue|Proceed/i }).last();
  if (await payNow.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await payNow.click();
    note('clicked Pay after bank select');
  }

  let demoPage = await popupPromise;
  if (!demoPage) {
    // Demo bank may navigate the iframe or a new frame instead of popup
    await page.waitForTimeout(2000);
    for (const f of page.frames()) {
      const success = f.getByRole('button', { name: /^Success$/i });
      if (await success.isVisible({ timeout: 500 }).catch(() => false)) {
        await success.click();
        note(`clicked Success in frame ${f.url().slice(0, 80)}`);
        demoPage = null;
        break;
      }
    }
    // Or main page navigated
    if (await page.getByRole('button', { name: /^Success$/i }).isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.getByRole('button', { name: /^Success$/i }).click();
      note('clicked Success on main page');
    }
  } else {
    await demoPage.waitForLoadState('domcontentloaded');
    // First event can be about:blank — wait for the demo bank Success control
    await expect(demoPage.getByRole('button', { name: /^Success$/i })).toBeVisible({ timeout: 30_000 });
    note(`demo bank popup url=${demoPage.url()}`);
    await demoPage.screenshot({ path: path.join(__dirname, 'evidence-demo-bank.png'), fullPage: true });
    await demoPage.getByRole('button', { name: /^Success$/i }).click();
    note('clicked Success on demo bank');
    await demoPage.waitForEvent('close', { timeout: 60_000 }).catch(() => undefined);
  }

  await page.screenshot({ path: path.join(__dirname, 'evidence-after-success.png'), fullPage: true });

  await expect(page.getByTestId('journey-submitted')).toBeVisible({ timeout: 180_000 });
  note('Thank you shown after poll paid');
  await page.screenshot({ path: path.join(__dirname, 'evidence-thankyou.png'), fullPage: true });

  evidence.paymentId = checkoutJson.paymentId;
  fs.writeFileSync(ARTIFACT, JSON.stringify(evidence, null, 2));
});
