import { test, expect, type Page } from '@playwright/test';

/**
 * Regression coverage for the option-id auto-derive fix: RadioButtonsGroup /
 * CheckboxGroup / Dropdown options previously only ever got an opaque
 * opt-{timestamp}-{random} id — the exact value a completed Flow response
 * stores instead of a readable answer. Fixed with the same auto-derive-
 * with-manual-override pattern already used for Screen IDs
 * (deriveScreenId/sanitizeScreenId in flowBuilder.ts).
 *
 * Drives the dev-only /dev/flow-builder harness — unauthenticated, local
 * mock state, no API calls — so no backend/login is needed to exercise the
 * real component. Uses pressSequentially() (real keystroke-by-keystroke
 * events), never fill(), specifically because fill() sets a value atomically
 * and would never expose the focus-loss bug this fix also had to close: the
 * option row used to be keyed by option.id, which now mutates as the admin
 * types — keying by a mutating value remounts the row's own <input> every
 * keystroke, dropping focus after the first character. OptionsListEditor now
 * keys rows by array index instead (componentEditors.tsx).
 */

// /dev/flow-builder is unauthenticated (local mock state, no API calls) — no
// need for the shared logged-in storageState the other smoke specs rely on.
test.use({ storageState: { cookies: [], origins: [] } });

const BASE = '/dev/flow-builder';

async function openProductInterestOptions(page: Page) {
  await page.click('[data-testid="flow-component-row-seed-w4"] button:nth-of-type(2)');
  await page.waitForSelector('[data-testid="option-row-0"]');
}

async function generatedJson(page: Page): Promise<{ screens: Array<{ layout: { children: Array<{ children: Array<{ 'data-source'?: Array<{ id: string; title: string }> }> } > } }> }> {
  if (!(await page.locator('[data-testid="round-trip-verdict"] pre').isVisible())) {
    await page.click('[data-testid="round-trip-verdict"] summary');
  }
  const text = await page.textContent('[data-testid="round-trip-verdict"] pre');
  return JSON.parse(text ?? '{}');
}

test('a legacy option with a random id is left untouched on load, not silently rewritten', async ({ page }) => {
  await page.goto(BASE);
  const json = await generatedJson(page);
  const dataSource = json.screens[0].layout.children[0].children[3]['data-source'] ?? [];
  const legacy = dataSource.find((o) => o.title === 'Mutual funds');
  expect(legacy?.id).toBe('opt-1751234567-a1b2');
});

test('typing a fresh option title auto-derives a readable id, without losing focus mid-type', async ({ page }) => {
  await page.goto(BASE);
  await openProductInterestOptions(page);

  await page.click('text=Add option');
  const rows = page.locator('[data-testid^="option-row-"]');
  const index = (await rows.count()) - 1;
  const titleInput = page.locator(`[data-testid="option-title-input-${index}"]`);

  await titleInput.click();
  await titleInput.pressSequentially('Equity', { delay: 30 });
  await expect(titleInput).toHaveValue('Equity');
  await expect(titleInput).toBeFocused();

  await page.click(`[data-testid="option-row-${index}"] button[aria-label="Edit option ID"]`);
  await expect(page.locator(`[data-testid="option-id-input-${index}"]`)).toHaveValue('equity');
});

test('two options with the same title get suffixed ids (_2), not a collision', async ({ page }) => {
  await page.goto(BASE);
  await openProductInterestOptions(page);

  for (let i = 0; i < 2; i++) {
    await page.click('text=Add option');
    const rows = page.locator('[data-testid^="option-row-"]');
    const index = (await rows.count()) - 1;
    const titleInput = page.locator(`[data-testid="option-title-input-${index}"]`);
    await titleInput.click();
    await titleInput.pressSequentially('Equity', { delay: 30 });
    await page.click(`[data-testid="option-row-${index}"] button[aria-label="Edit option ID"]`);
  }

  const idInputs = page.locator('[data-testid^="option-id-input-"]');
  const values = await idInputs.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(values).toContain('equity');
  expect(values).toContain('equity_2');
});

test('hand-editing an option ID via "Edit ID" breaks auto-sync — later title edits leave it alone', async ({ page }) => {
  await page.goto(BASE);
  await openProductInterestOptions(page);

  await page.click('text=Add option');
  const rows = page.locator('[data-testid^="option-row-"]');
  const index = (await rows.count()) - 1;
  const titleInput = page.locator(`[data-testid="option-title-input-${index}"]`);
  const idInput = page.locator(`[data-testid="option-id-input-${index}"]`);

  await titleInput.click();
  await titleInput.pressSequentially('Equity', { delay: 30 });
  await page.click(`[data-testid="option-row-${index}"] button[aria-label="Edit option ID"]`);
  await idInput.fill('');
  await idInput.pressSequentially('custom_equity_code', { delay: 20 });

  // Explicit click + select-all before retyping — avoids ambiguity about
  // where the cursor lands on refocus after the intervening edit above.
  await titleInput.click();
  await titleInput.press('Control+A');
  await titleInput.pressSequentially('Equity Shares', { delay: 30 });

  await expect(titleInput).toHaveValue('Equity Shares');
  await expect(idInput).toHaveValue('custom_equity_code');
});
