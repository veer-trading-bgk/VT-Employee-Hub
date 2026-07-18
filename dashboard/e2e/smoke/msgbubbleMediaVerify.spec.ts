import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-17 360° audit fix plan, Stage 6, findings #11 and #13.
 *
 * Finding #11: sendTemplate() built and sent a real IMAGE/VIDEO/DOCUMENT
 * header component to Meta but persisted nothing about it onto the MSG#
 * item — TemplateBubble rendered text-only, so the agent's own Inbox never
 * showed the header image/video/document the customer actually received.
 * Fixed by persisting the template's own s3Key/mimeType/filename (same
 * fields every other media message already stores) and having TemplateBubble
 * render them via the existing MediaRenderer — reused as-is, not a second
 * renderer.
 *
 * Finding #13: stickers rendered correctly only because image/webp mime type
 * happened to satisfy the generic `mime.startsWith('image/')` check —
 * type === 'sticker' itself was never matched, so any record missing
 * mimeType fell back to a generic "Download file" button. Fixed with an
 * explicit `type === 'sticker'` branch.
 *
 * Same harness technique as msgbubbleVerify.spec.ts (2026-07-09) — a
 * temporary, unauthenticated page rendering the real MessageBubble with
 * hand-fed cases, no login needed. Run with --no-deps to skip the auth setup
 * project entirely.
 *
 * Harness page (dashboard/src/app/msgbubble-verify-temp/page.tsx) and
 * MessageBubble's temporary `export` (app/(v3)/inbox/page.tsx) were REMOVED
 * after this spec captured its proof (4/4 passed against the real fixed
 * component; also confirmed finding #13's test fails against the pre-fix
 * code by temporarily reverting the one-line change and re-running) — kept,
 * skipped, as the record of that proof, same convention as every other
 * *Verify.spec.ts in this directory.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('MessageBubble — template header media + sticker rendering (Stage 6, findings #11/#13)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/whatsapp/s3-url*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' }),
      }));
  });

  test('finding #11: a template with a persisted image header renders it via MediaRenderer', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-template_image_header');
    await expect(c.locator('img')).toBeVisible();
    // Body text still renders alongside the header image — not replaced by it.
    await expect(c.getByText('Hi Priya, your order is confirmed.')).toBeVisible();
  });

  test('finding #11 regression: a template with no header media renders text-only, no broken media block', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-template_no_header');
    await expect(c.locator('img')).toHaveCount(0);
    await expect(c.getByText('Welcome aboard!')).toBeVisible();
  });

  test('finding #13: a sticker record with NO mimeType still renders as an image, not a download button', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-sticker_no_mimetype');
    await expect(c.locator('img')).toBeVisible();
    await expect(c.getByText('Download file')).toHaveCount(0);
  });

  test('finding #13 regression: a sticker WITH mimeType still renders as an image (existing behavior unchanged)', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-sticker_with_mimetype');
    await expect(c.locator('img')).toBeVisible();
  });
});
