import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-09 Inbox rendering fix (docs/phase3/TECHNICAL_DEBT.md).
 * Proves, in a real browser against the real unmodified MessageBubble
 * component, that: (1) buttons/list rows now render for interactive messages
 * sent after the fix, (2) a message sent BEFORE the fix (no interactiveAction
 * field) still renders body text only, no crash, (3) list_reply renders as
 * plain text instead of the italic media-placeholder style, (4) location
 * messages render a real address/map block, and a location-typed record
 * missing .location falls back gracefully instead of crashing.
 *
 * Uses the exact harness technique documented in protectedRoute.spec.ts's
 * header comment (Era 25) — a temporary, unauthenticated page under
 * dashboard/src/app/ rendering the real component with hand-fed props, no
 * real login credentials needed. Run with --no-deps to skip the auth setup
 * project entirely (see that file for the full explanation).
 *
 * Harness page (dashboard/src/app/msgbubble-verify-temp/page.tsx) and
 * MessageBubble's temporary `export` (dashboard/src/app/(v3)/inbox/page.tsx)
 * were REMOVED after this spec captured its proof — this file is kept,
 * skipped, as the record of that proof and reactivation instructions, same
 * as protectedRoute.spec.ts. Reactivate by restoring both from git history
 * at the commit this comment references.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('MessageBubble — real component, real browser (2026-07-09 Inbox rendering fix)', () => {
  test('old-shape interactive record (no interactiveAction) renders body text only, no crash', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-old_interactive');
    await expect(c.getByText('Hi there! What best describes you?')).toBeVisible();
    // No button/list chrome — this record predates the fix, nothing to render beyond body text.
    await expect(c.locator('span', { hasText: 'Yes please' })).toHaveCount(0);
  });

  test('new-shape interactive record with buttons renders both button titles', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-new_interactive_buttons');
    await expect(c.getByText('Still interested?')).toBeVisible();
    await expect(c.getByText('Yes please')).toBeVisible();
    await expect(c.getByText('Not now')).toBeVisible();
  });

  test('new-shape interactive record with list rows renders the list label, row titles, and a description', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-new_interactive_list');
    await expect(c.getByText('Pick an option below')).toBeVisible();
    await expect(c.getByText('View Options')).toBeVisible();
    await expect(c.getByText('Open Demat')).toBeVisible();
    await expect(c.getByText('Start investing today')).toBeVisible();
    await expect(c.getByText('Mutual Funds')).toBeVisible();
  });

  test('list_reply renders as plain (non-italic) text, not the media-unavailable placeholder style', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-list_reply');
    const bubbleText = c.getByText('Open Demat');
    await expect(bubbleText).toBeVisible();
    const className = await bubbleText.evaluate((el) => el.className);
    expect(className).not.toContain('italic');
  });

  test('location record missing .location falls back to the placeholder, no crash', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-old_location_no_data');
    await expect(c.getByText('[Location: HQ]')).toBeVisible();
  });

  test('new-shape location record renders name, multi-line address (pre-wrapped), and a map link with correct coordinates', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-new_location');
    await expect(c.getByText('Angel One Ltd, sector no34, 1st main 2nd cross navanagar')).toBeVisible();
    const address = c.getByText('Line one of address', { exact: false });
    await expect(address).toBeVisible();
    const whiteSpace = await address.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(whiteSpace).toBe('pre-wrap');
    const mapLink = c.getByRole('link', { name: 'View on map' });
    await expect(mapLink).toHaveAttribute('href', /16\.157609273858615,75\.66587920581715/);
  });
});

/**
 * TEMPORARY — Fix 3 (template resolvedBody), same audit, same harness
 * technique, run as a separate pass (the harness page's CASES were swapped
 * to template-only fixtures for this proof — see its own header comment for
 * why these don't share a page with the Fix 1+2/4 cases above). Proves
 * TemplateBubble now prefers message.resolvedBody (the real, customer-
 * specific substituted text) over its existing tpl.bodyPreview cache-lookup
 * fallback, and that the existing fallback chain (cache lookup, then
 * content-regex displayName) is completely unaffected for records without
 * resolvedBody — both the pre-fix case and the name-only-send-path case.
 */
test.describe.skip('MessageBubble — TemplateBubble resolvedBody (2026-07-09 Fix 3)', () => {
  test('resolvedBody present: renders the real substituted text, not a placeholder or the generic cached preview', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-template_resolved');
    await expect(c.getByText('Hi Priya', { exact: false })).toBeVisible();
    await expect(c.getByText('You ac has been activated and code is V46045', { exact: false })).toBeVisible();
  });

  test('no resolvedBody, no cache match (pre-fix record): falls back to the existing content-regex displayName, unchanged', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-template_old_no_cache');
    // "hello" alone would also match the "Broadcast · hello" header label —
    // exact:true targets the body paragraph specifically (its full text is
    // just "hello", the header's is not).
    await expect(c.getByText('hello', { exact: true })).toBeVisible();
    await expect(c.getByText('Broadcast · hello')).toBeVisible();
  });

  test('no resolvedBody, but templateId matches a cached template: still shows tpl.bodyPreview exactly as before this fix', async ({ page }) => {
    await page.goto('/msgbubble-verify-temp');
    const c = page.getByTestId('case-template_no_resolved_with_cache');
    await expect(c.getByText('Generic unsubstituted hello, {{1}}!')).toBeVisible();
  });
});
