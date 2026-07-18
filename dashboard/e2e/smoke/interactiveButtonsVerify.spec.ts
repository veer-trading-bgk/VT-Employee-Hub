import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — Inbox message-bubble preview fix: outbound interactive
 * reply-button messages were rendered with `flex flex-wrap` (rounded pill
 * buttons that wrap side-by-side), never matching WhatsApp's real client,
 * which always stacks reply buttons vertically, one per row, full width
 * (max 3, per Meta's own developer docs). Preview-only bug — the actual
 * outbound payload (WhatsAppSendService.js's sendInteractive()) was never
 * wrong; InteractiveActionPreview only renders what already got sent.
 * Fixed by changing the container to `flex flex-col` and each button to
 * `w-full` instead of an inline pill.
 *
 * Same harness technique as msgbubbleVerify.spec.ts / msgbubbleMediaVerify.spec.ts
 * — a temporary, unauthenticated page rendering the real MessageBubble with a
 * hand-fed 3-button case, no login needed. Run with --no-deps to skip the
 * auth setup project entirely.
 *
 * Harness page (dashboard/src/app/interactive-buttons-verify-temp/page.tsx)
 * and MessageBubble's temporary `export` (app/(v3)/inbox/page.tsx) were
 * REMOVED after this spec captured its proof (3/3 passed against the real
 * fixed component) — kept, skipped, as the record of that proof, same
 * convention as every other *Verify.spec.ts in this directory.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('MessageBubble — interactive reply buttons stack vertically, full width', () => {
  test('all 3 buttons render, one per row, in document order', async ({ page }) => {
    await page.goto('/interactive-buttons-verify-temp');
    const c = page.getByTestId('case-buttons');
    const buttons = c.locator('span', { hasText: /Yes please|Not now|Tell me more/ });
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toHaveText('Yes please');
    await expect(buttons.nth(1)).toHaveText('Not now');
    await expect(buttons.nth(2)).toHaveText('Tell me more');
  });

  test('buttons are stacked vertically (each on its own row, not side-by-side)', async ({ page }) => {
    await page.goto('/interactive-buttons-verify-temp');
    const c = page.getByTestId('case-buttons');
    const buttons = c.locator('span', { hasText: /Yes please|Not now|Tell me more/ });
    const boxes = await buttons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    // Vertically stacked: each button's top is below the previous button's
    // bottom (allowing for the gap). Side-by-side (the bug) would have all
    // three sharing roughly the same top Y coordinate instead.
    expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom - 1);
    expect(boxes[2].top).toBeGreaterThanOrEqual(boxes[1].bottom - 1);
  });

  test('each button spans the full width of the bubble (not a narrow pill)', async ({ page }) => {
    await page.goto('/interactive-buttons-verify-temp');
    const c = page.getByTestId('case-buttons');
    const bubble = c.locator('.max-w-\\[75\\%\\]').first();
    const bubbleBox = await bubble.boundingBox();
    const buttons = c.locator('span', { hasText: /Yes please|Not now|Tell me more/ });
    const firstBtnBox = await buttons.first().boundingBox();
    // Full-width means the button's box spans nearly the bubble's own inner
    // width (allowing for the bubble's own horizontal padding), not just
    // hugging its own short text like the old inline-pill rendering did.
    expect(firstBtnBox!.width).toBeGreaterThan(bubbleBox!.width * 0.8);
  });
});
