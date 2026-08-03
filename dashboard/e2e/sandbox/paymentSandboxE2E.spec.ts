/**
 * Live sandbox E2E — Event Booking Pay & Register against production.
 * Run with SANDBOX_JOURNEY_URL set (from scripts/sandbox_e2e_bootstrap.js).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const ARTIFACT = path.join(__dirname, 'sandbox-evidence.json');

test('Sandbox Event Booking — Pay & Register through Razorpay test Checkout', async ({ page }) => {
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
  note('screen 1 complete');

  await expect(page.getByLabel(/Event/i)).toBeVisible();
  await page.getByLabel(/Event/i).selectOption({ label: 'Dandiya Raas Utsav' });
  await page.getByLabel(/Number of Tickets/i).fill('1');
  await page.getByTestId('journey-continue').click();
  note('screen 2 complete → review');

  await expect(page.getByTestId('journey-review')).toBeVisible();
  await expect(page.getByTestId('journey-grand-total')).toBeVisible();
  const payBtn = page.getByTestId('journey-submit');
  await expect(payBtn).toHaveAttribute('data-pay-action', 'pay-register');
  await expect(payBtn).toHaveText(/Pay & Register/i);
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

  const rzpFrame = page.frameLocator('iframe[src*="razorpay"], iframe').first();
  await expect(rzpFrame.locator('body')).toBeVisible({ timeout: 45_000 });
  note('Razorpay Checkout iframe visible (Test Mode)');
  await page.screenshot({ path: path.join(__dirname, 'evidence-checkout-open.png'), fullPage: true });

  // Contact details gate (shown when prefill missing on older deploy)
  const mobile = rzpFrame.getByPlaceholder(/mobile|phone/i).or(
    rzpFrame.locator('input[type="tel"], input[name*="contact"], input[name*="phone"]'),
  ).first();
  if (await mobile.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await mobile.fill('9901251785');
    await rzpFrame.getByRole('button', { name: /Continue/i }).click();
    note('filled Razorpay contact mobile');
  }

  // Prefer Card method
  const cards = rzpFrame.getByText(/^Cards?$/i).first();
  if (await cards.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await cards.click();
    note('selected Cards');
  }

  const cardNumber = rzpFrame.locator(
    'input[name="card.number"], input[name="card[number]"], input[autocomplete="cc-number"], input[placeholder*="card number" i]',
  ).first();
  await cardNumber.waitFor({ timeout: 30_000 });
  await cardNumber.fill('4111111111111111');
  const expiry = rzpFrame.locator(
    'input[name="card.expiry"], input[name="card[expiry]"], input[autocomplete="cc-exp"], input[placeholder*="MM" i]',
  ).first();
  if (await expiry.isVisible().catch(() => false)) await expiry.fill('1230');
  const cvv = rzpFrame.locator(
    'input[name="card.cvv"], input[name="card[cvv]"], input[autocomplete="cc-csc"], input[placeholder*="CVV" i]',
  ).first();
  if (await cvv.isVisible().catch(() => false)) await cvv.fill('123');
  const holder = rzpFrame.locator(
    'input[name="card.name"], input[name="card[name]"], input[autocomplete="cc-name"]',
  ).first();
  if (await holder.isVisible().catch(() => false)) await holder.fill('Sandbox E2E');

  await rzpFrame.getByRole('button', { name: /Pay|Proceed/i }).first().click();
  note('submitted Razorpay test card 4111…');
  await page.screenshot({ path: path.join(__dirname, 'evidence-card-submit.png'), fullPage: true });

  await expect(page.getByTestId('journey-submitted')).toBeVisible({ timeout: 180_000 });
  note('Thank you shown after poll paid');
  await page.screenshot({ path: path.join(__dirname, 'evidence-thankyou.png'), fullPage: true });

  evidence.paymentId = checkoutJson.paymentId;
  fs.writeFileSync(ARTIFACT, JSON.stringify(evidence, null, 2));
});
