import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-10 Track A5 Fix 2 (docs/phase3/TECHNICAL_DEBT.md).
 * Proves, in a real browser against the real unmodified useAddNote() hook:
 * (1) the posted note appears in the list IMMEDIATELY, before the (mocked,
 * artificially delayed) network response resolves — a genuine optimistic
 * render, not just a fast round-trip; (2) once the response resolves, the
 * temporary placeholder SK is replaced by the real server SK (true
 * reconciliation, not just "left the temp one in place"); (3) on a mocked
 * failure, the optimistic note is rolled back and an error toast shows.
 *
 * Uses the harness technique documented in protectedRoute.spec.ts's header
 * comment (Era 25) — temporary AuthContext export, no real login needed.
 * serviceWorkers: 'block' — this app's ServiceWorkerRegister.tsx intercepts
 * requests before page.route() sees them otherwise (same gotcha hit and
 * documented in kanbanVerify.spec.ts).
 *
 * Harness page (dashboard/src/app/notes-optimistic-verify-temp/page.tsx)
 * and AuthContext's temporary `export` were REMOVED after this spec
 * captured its proof — kept here, skipped, as the record of that proof.
 *
 * To reactivate: re-add `export` to AuthContext in
 * dashboard/src/context/AuthContext.tsx, recreate the harness page above
 * (content is in this file's git history / the session that added it),
 * then remove the .skip below.
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const REAL_SK = 'NOTE#2026-07-10T12:00:00.000Z';

function mockNotePost(page: import('@playwright/test').Page, opts: { delayMs: number; fail?: boolean }) {
  return page.route('**/api/whatsapp/inbox/**/note', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 'http://localhost:3001',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
      return;
    }
    await new Promise((r) => setTimeout(r, opts.delayMs));
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'http://localhost:3001',
      'Access-Control-Allow-Credentials': 'true',
    };
    if (opts.fail) {
      await route.fulfill({ status: 500, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify({ error: 'write failed' }) });
      return;
    }
    const body = route.request().postDataJSON() as { content: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        timestamp: '2026-07-10T12:00:00.000Z',
        note: { SK: REAL_SK, content: body.content, authorId: 'u1', authorName: 'Admin', timestamp: '2026-07-10T12:00:00.000Z' },
      }),
    });
  });
}

test.describe.skip('useAddNote — real hook, real browser (2026-07-10 Track A5 Fix 2)', () => {
  test('optimistic render: the note appears immediately, before the mocked response resolves', async ({ page }) => {
    await mockNotePost(page, { delayMs: 800 });
    await page.goto('/notes-optimistic-verify-temp');

    await page.getByTestId('note-input').fill('Called back, will decide by Friday');
    await page.getByTestId('post-btn').click();

    // Still in flight (well before the 800ms mock delay elapses) — the note
    // must already be visible, or this isn't a real optimistic update.
    await expect(page.getByTestId('pending')).toHaveText('pending');
    await expect(page.getByTestId('notes-count')).toHaveText('1');
    await expect(page.getByTestId('note-item')).toHaveText('Called back, will decide by Friday');
    const tempSK = await page.getByTestId('note-item').getAttribute('data-sk');
    expect(tempSK).toMatch(/^NOTE#optimistic-/);
  });

  test('reconciliation: once the response resolves, the temp SK is replaced by the real one', async ({ page }) => {
    await mockNotePost(page, { delayMs: 300 });
    await page.goto('/notes-optimistic-verify-temp');

    await page.getByTestId('note-input').fill('hi');
    await page.getByTestId('post-btn').click();

    await expect(page.getByTestId('pending')).toHaveText('idle', { timeout: 5000 });
    await expect(page.getByTestId('notes-count')).toHaveText('1'); // still exactly one note, not duplicated
    await expect(page.getByTestId('note-item')).toHaveAttribute('data-sk', REAL_SK);
    await expect(page.getByTestId('note-item')).toHaveAttribute('data-author', 'Admin');
  });

  test('rollback on failure: the optimistic note is removed and an error toast shows', async ({ page }) => {
    await mockNotePost(page, { delayMs: 200, fail: true });
    await page.goto('/notes-optimistic-verify-temp');

    await page.getByTestId('note-input').fill('this will fail');
    await page.getByTestId('post-btn').click();

    // Visible immediately, same as the success case, before the mock resolves.
    await expect(page.getByTestId('notes-count')).toHaveText('1');

    await expect(page.getByTestId('pending')).toHaveText('idle', { timeout: 5000 });
    await expect(page.getByTestId('notes-count')).toHaveText('0'); // rolled back, not left dangling
    await expect(page.getByText('Failed to save note')).toBeVisible();
  });
});
