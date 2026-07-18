import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-17 360° audit fix plan, Stage 6 (new bug report: "type
 * a template variable value, it accepts one character then loses focus").
 *
 * Root cause, confirmed by reading (not assumed): ComposerToolbar.tsx's
 * `unresolvedIdx` — the list of variable indices auto-fill couldn't resolve,
 * which is what the variable inputs are rendered FROM — used to be recomputed
 * on every render straight from live `tplVars` state:
 *   `pendingTpl.variables.map((_, i) => i).filter((i) => !tplVars[i])`
 * The instant a field went from empty to non-empty (i.e. after the user's
 * first keystroke), that index stopped satisfying `!tplVars[i]` and was
 * filtered OUT of the render list — unmounting that exact <input> mid-type.
 * Same failure SHAPE as the Flow Builder OptionsListEditor bug fixed earlier
 * this session (a render list gated by something that mutates every
 * keystroke), just via a live filter predicate instead of a React key. Fixed
 * by capturing unresolvedIdx once, at template-select time, as its own state.
 *
 * Uses the exact harness technique documented in protectedRoute.spec.ts's
 * header comment (Era 25) and used again for msgbubble-verify-temp — a
 * temporary, unauthenticated page under dashboard/src/app/ rendering the
 * real ComposerToolbar with hand-fed props + a mocked template list, no real
 * login credentials needed. Run with --no-deps to skip the auth setup
 * project entirely.
 *
 * Uses pressSequentially() (real keystroke-by-keystroke events), never
 * fill(), for the same reason flowBuilderOptionIds.spec.ts does: fill() sets
 * a value atomically and would never expose a per-keystroke remount bug.
 *
 * Harness page (dashboard/src/app/composer-verify-temp/page.tsx) was REMOVED
 * after this spec captured its proof (5/5 passed against the real fixed
 * component) — this file is kept, skipped, as the record of that proof, same
 * convention as msgbubbleVerify.spec.ts/kanbanVerify.spec.ts. Reactivate by
 * restoring the harness page from git history at the commit this comment
 * references.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const TEMPLATE_LIST = {
  templates: [{
    id: 'tpl_order',
    name: 'Order Confirmation',
    language: 'en',
    category: 'UTILITY',
    status: 'APPROVED',
    bodyPreview: 'Use code {{1}} for a discount',
    // "Discount Code" — chosen carefully to NOT match any of autoFill()'s
    // substring patterns (name/customer/client, phone/mobile/number,
    // stage/status, agent/employee/assign). An earlier draft used "Order
    // Number", which silently auto-resolved via the 'number' substring
    // match against conv.phone — needsInput came back false and the fill
    // panel never even opened, which is why the first live run of this spec
    // timed out waiting for an input that was never going to render. Caught
    // by actually running this live, not by re-reading the spec.
    variables: ['Discount Code'],
  }],
};

async function openOrderTemplate(page: import('@playwright/test').Page) {
  await page.route('**/api/whatsapp/templates', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TEMPLATE_LIST) }));
  await page.goto('/composer-verify-temp');
  await page.getByRole('button', { name: 'Templates' }).click();
  await page.getByText('Order Confirmation').click();
  return page.getByPlaceholder('Enter Discount Code…');
}

test.describe.skip('ComposerToolbar — template variable input (2026-07-17 focus-loss fix)', () => {
  test('typing a multi-character value retains the full string and keeps focus', async ({ page }) => {
    const input = await openOrderTemplate(page);
    await input.click();
    await input.pressSequentially('SAVE12345', { delay: 30 });

    await expect(input).toHaveValue('SAVE12345');
    await expect(input).toBeFocused();
  });

  test('the input element itself is never remounted mid-type (same DOM node throughout)', async ({ page }) => {
    const input = await openOrderTemplate(page);
    await input.evaluate((el) => el.setAttribute('data-proof-node', 'original'));
    await input.click();
    await input.pressSequentially('ABC', { delay: 30 });
    // If the row had unmounted/remounted (the pre-fix bug), a fresh <input>
    // would not carry this hand-set attribute forward.
    await expect(input).toHaveAttribute('data-proof-node', 'original');
  });

  test('the Send button stays disabled until the field has a value, then enables', async ({ page }) => {
    const input = await openOrderTemplate(page);
    const sendBtn = page.getByRole('button', { name: 'Send Template' });
    await expect(sendBtn).toBeDisabled();
    await input.click();
    await input.pressSequentially('SAVE1', { delay: 30 });
    await expect(sendBtn).toBeEnabled();
  });

  test('clearing the field back to empty keeps the input mounted (does not vanish) and re-disables Send', async ({ page }) => {
    const input = await openOrderTemplate(page);
    await input.click();
    await input.pressSequentially('X', { delay: 30 });
    await input.fill('');
    await expect(input).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send Template' })).toBeDisabled();
  });

  test('the variable label still renders above the input throughout typing', async ({ page }) => {
    const input = await openOrderTemplate(page);
    await expect(page.getByText('Discount Code')).toBeVisible();
    await input.click();
    await input.pressSequentially('SAVE999', { delay: 30 });
    await expect(page.getByText('Discount Code')).toBeVisible();
  });
});
