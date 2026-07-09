import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-09 Track A3 Batch 1 (docs/phase3/TECHNICAL_DEBT.md).
 * Proves, in a real browser against the real unmodified KanbanBoard/
 * KanbanColumn/KanbanCard components: (1) all 114 fed-in contacts render as
 * cards — no client-side cap, matching the live viir_trading count — across
 * a 1-card stage and a 55-card stage without either rendering badly, (2) the
 * 55-card column scrolls internally (overflow-y-auto) instead of inflating
 * the whole page's height, and (3) drag-and-drop between columns still works
 * after that scroll CSS change — the Kanban's core interaction and the main
 * regression risk of touching the droppable container's CSS.
 *
 * Uses the harness technique documented in protectedRoute.spec.ts's header
 * comment (Era 25) — a temporary, unauthenticated page under
 * dashboard/src/app/ rendering the real component with hand-fed props, no
 * real login credentials needed. Run with --no-deps to skip the auth setup
 * project entirely.
 *
 * Harness page (dashboard/src/app/kanban-verify-temp/page.tsx) and
 * KanbanBoard's temporary `export` (dashboard/src/app/(v3)/sales/page.tsx)
 * were REMOVED after this spec captured its proof — this file is kept,
 * skipped, as the record of that proof and reactivation instructions, same
 * as msgbubbleVerify.spec.ts. The harness page must seed the 'sales-contacts'
 * React Query cache via useQuery({queryKey:['sales-contacts'], initialData:...})
 * — NOT pass a plain prop array — because the drag mutation's onMutate/
 * onSettled read and write that exact cache key; a plain prop has nowhere
 * for the optimistic update to land.
 *
 * Two non-obvious gotchas hit while building this (both real, both cost
 * real debugging time — worth knowing before re-deriving them):
 *   1. ServiceWorkerRegister.tsx registers a real SW; a SW's fetch handler
 *      intercepts requests before page.route() ever sees them, so any mocked
 *      route silently never fires unless the test also sets
 *      `serviceWorkers: 'block'` (see test.use below).
 *   2. apiFetch always sends credentials:'include'; a mocked cross-origin
 *      response (harness on :3001, API_URL default :3000) needs an exact-
 *      origin Access-Control-Allow-Origin + Access-Control-Allow-Credentials:
 *      true on BOTH the OPTIONS preflight and the real response — a wildcard
 *      '*' origin is silently rejected by the browser when credentials are
 *      included, with no console error to point at it.
 */
// serviceWorkers: 'block' — ServiceWorkerRegister.tsx registers a real SW in
// this app; a SW's fetch handler intercepts requests before page.route() ever
// sees them (a known Playwright limitation for page-level routing), which is
// exactly why the drag-and-drop test's route mock silently never fired until
// this was added — the request escaped page.route() into the SW instead.
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const STAGE_LABELS = ['New Lead', 'Contacted', 'Interested', 'KYC Done', 'Demat Done', 'Lost'];
const EXPECTED_COUNTS: Record<string, number> = {
  'New Lead': 1, Contacted: 55, Interested: 30, 'KYC Done': 15, 'Demat Done': 10, Lost: 3,
};

function columnFor(page: import('@playwright/test').Page, label: string) {
  return page.locator(`xpath=//span[text()="${label}"]/ancestor::div[contains(@class,"shrink-0")][1]`);
}

test.describe.skip('KanbanBoard — real components, real browser (2026-07-09 Track A3 Batch 1)', () => {
  test('all 114 fed-in contacts render as cards, none dropped client-side', async ({ page }) => {
    await page.goto('/kanban-verify-temp');
    await expect(page.getByTestId('harness-total')).toHaveText('total contacts fed in: 114');

    const totalCards = page.locator('a[href^="/contacts/"]');
    await expect(totalCards).toHaveCount(114);
  });

  test('each column count badge matches its fed-in distribution, including the 1-card and 55-card stress cases', async ({ page }) => {
    await page.goto('/kanban-verify-temp');
    for (const label of STAGE_LABELS) {
      const col = columnFor(page, label);
      const badge = col.locator('span').nth(1);
      await expect(badge).toHaveText(String(EXPECTED_COUNTS[label]));
      await expect(col.locator('a[href^="/contacts/"]')).toHaveCount(EXPECTED_COUNTS[label]);
    }
  });

  test('the 55-card column scrolls internally (overflow-y-auto, real overflow) instead of inflating the page', async ({ page }) => {
    await page.goto('/kanban-verify-temp');
    const contactedList = columnFor(page, 'Contacted').locator('div').filter({ has: page.locator('a[href^="/contacts/"]') }).first();

    const overflowY = await contactedList.evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflowY).toBe('auto');

    const [scrollH, clientH] = await contactedList.evaluate((el) => [el.scrollHeight, el.clientHeight]);
    expect(scrollH).toBeGreaterThan(clientH); // 55 cards genuinely overflow this column's allotted height

    // The whole page must NOT have grown to accommodate the 55-card column —
    // that's the exact bug being fixed (whole-page scroll instead of a
    // per-column one). A small tolerance covers sub-pixel/scrollbar rounding.
    const [bodyScrollH, viewportH] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
    expect(bodyScrollH).toBeLessThanOrEqual(viewportH + 4);
  });

  test('drag-and-drop: dragging the New Lead column\'s only card into Contacted moves it and fires the stage PUT with the right body', async ({ page }) => {
    let requestBody: unknown = null;
    let requestUrl = '';
    // The harness runs on :3001, the app's API_URL default is :3000 — a
    // cross-origin PUT with a JSON body triggers a real CORS preflight
    // (OPTIONS) first. The mocked response must carry CORS headers on BOTH
    // the preflight and the real response, or the browser silently blocks
    // the actual request even though route.fulfill() "succeeded".
    await page.route('**/api/crm/leads/**/stage', async (route) => {
      // credentials: 'include' (apiFetch always sets this) forbids a wildcard
      // Access-Control-Allow-Origin — the browser silently drops the response
      // unless the origin is echoed back exactly, with credentials allowed too.
      const corsHeaders = {
        'Access-Control-Allow-Origin': 'http://localhost:3001',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      requestUrl = route.request().url();
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ success: true, stage: 'contacted' }),
      });
    });

    await page.goto('/kanban-verify-temp');

    const source = columnFor(page, 'New Lead');
    const target = columnFor(page, 'Contacted');

    const card = source.locator('.group').first();
    await card.hover();
    const handle = card.locator('button[aria-label="Drag"]');
    await expect(handle).toBeVisible();

    const handleBox = await handle.boundingBox();
    const targetBox = await target.boundingBox();
    if (!handleBox || !targetBox) throw new Error('bounding boxes not available');

    const startX = handleBox.x + handleBox.width / 2, startY = handleBox.y + handleBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2, endY = targetBox.y + targetBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(100);
    // Exceed dnd-kit's PointerSensor activationConstraint (distance: 8) with a
    // small initial move, then many small increments along the full path —
    // a single large jump can land past dnd-kit's move-batching before it
    // ever registers the drag as started.
    await page.mouse.move(startX + 12, startY + 12);
    await page.waitForTimeout(50);
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(startX + (endX - startX) * (i / steps), startY + (endY - startY) * (i / steps));
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(100);
    // dnd-kit's DragOverlay renders a second "Lead 0" preview once it
    // recognizes an active drag — confirms the gesture registered before
    // release, not just a click.
    await expect(page.locator('text=Lead 0')).toHaveCount(2);
    await page.mouse.up();
    await page.waitForTimeout(100);

    await expect.poll(() => requestBody, { timeout: 8000 }).not.toBeNull();
    expect(requestUrl).toContain('/api/crm/leads/lead0/stage');
    expect(requestBody).toEqual({ stage: 'contacted' });

    // Optimistic update (onMutate) plus the mocked-success settle — New Lead
    // drops to 0 cards, Contacted rises from 55 to 56.
    await expect(source.locator('span').nth(1)).toHaveText('0');
    await expect(target.locator('span').nth(1)).toHaveText('56');
    await expect(source.locator('a[href^="/contacts/"]')).toHaveCount(0);
    await expect(target.locator('a[href^="/contacts/"]')).toHaveCount(56);
  });
});
