import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-10 Track A5 Fix 4 (docs/phase3/TECHNICAL_DEBT.md).
 * Proves, in a real browser against the real unmodified ComposerToolbar:
 * (1) both Templates and Quick Replies panels render at the widened w-96
 * (384px) shared Panel default — not a Quick-Reply-only override, (2)
 * Templates' body preview keeps its line-clamp-2 (unchanged, per the
 * evidence-based decision not to mirror the clamp removal there), (3) the
 * canned-response body preview shows its full multi-line text with no
 * clamp. Uses the harness technique from protectedRoute.spec.ts (Era 25).
 * serviceWorkers: 'block' + explicit CORS headers on mocked responses —
 * same two gotchas documented in kanbanVerify.spec.ts's header comment.
 *
 * Harness page (dashboard/src/app/panel-width-verify-temp/page.tsx) was
 * REMOVED after this spec captured its proof — kept here, skipped.
 *
 * To reactivate: recreate the harness page above (content is in this
 * file's git history / the session that added it), then remove the
 * .skip below.
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:3001', 'Access-Control-Allow-Credentials': 'true' };

// 100 chars — matches the longest of the 8 real approved templates found in
// production data during Fix 4's diagnosis.
const LONG_TEMPLATE_BODY =
  'Hello! Your KYC verification is pending. Please upload your PAN and Aadhaar card to complete the process today.';

// 246 chars, multi-line — matches the one real canned response found in
// production data (the case that motivated removing the clamp).
const LONG_CANNED_BODY =
  'Hi {{name}}, thank you for reaching out.\n\n' +
  'Your account is currently under review by our compliance team. This typically takes 1-2 business days.\n\n' +
  'We will notify you as soon as the review is complete. Feel free to reach out if you have any questions in the meantime.';

async function mockPanelData(page: import('@playwright/test').Page) {
  await page.route('**/api/whatsapp/templates', async (route) => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } }); return; }
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: CORS,
      body: JSON.stringify({ templates: [
        { id: 't1', name: 'kyc_reminder', language: 'en', category: 'UTILITY', status: 'APPROVED', bodyPreview: LONG_TEMPLATE_BODY, variables: [] },
      ] }),
    });
  });
  await page.route('**/api/whatsapp/inbox/canned', async (route) => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } }); return; }
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: CORS,
      body: JSON.stringify({ responses: [
        { id: 'c1', title: 'Compliance Review', body: LONG_CANNED_BODY, shortcut: 'review' },
      ] }),
    });
  });
}

test.describe.skip('ComposerToolbar panels — real component, real browser (2026-07-10 Track A5 Fix 4)', () => {
  test('Templates panel: w-96 width, body preview keeps its 2-line clamp', async ({ page }) => {
    await mockPanelData(page);
    await page.goto('/panel-width-verify-temp');

    await page.getByRole('button', { name: 'Templates' }).click();
    await expect(page.getByText('kyc_reminder')).toBeVisible();

    const panel = page.locator('.w-96');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box?.width).toBeCloseTo(384, 0);

    const preview = page.locator('p', { hasText: LONG_TEMPLATE_BODY.slice(0, 30) });
    await expect(preview).toHaveClass(/line-clamp-2/);
  });

  test('Quick Replies panel: w-96 width, body preview has no clamp and shows full multi-line text', async ({ page }) => {
    await mockPanelData(page);
    await page.goto('/panel-width-verify-temp');

    await page.getByRole('button', { name: 'Quick Replies' }).click();
    await expect(page.getByText('Compliance Review')).toBeVisible();

    const panel = page.locator('.w-96');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box?.width).toBeCloseTo(384, 0);

    const preview = page.locator('p', { hasText: 'thank you for reaching out' });
    await expect(preview).not.toHaveClass(/line-clamp/);
    await expect(preview).toHaveClass(/whitespace-pre-wrap/);

    // Full 246-char multi-line text actually present in the DOM (not truncated) —
    // the real proof, not just "no clamp class present".
    const fullText = await preview.textContent();
    expect(fullText?.length).toBeGreaterThan(200);
    expect(fullText).toContain('reach out if you have any questions');

    // Multi-line: rendered height must exceed a single line (~14-15px text at
    // line-height ~1.4 => ~18-20px/line); three paragraphs of wrapped text at
    // 384px panel width comfortably clears 60px.
    expect(box).not.toBeNull();
    const previewBox = await preview.boundingBox();
    expect(previewBox!.height).toBeGreaterThan(60);
  });
});
