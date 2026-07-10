import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-10 template header media handle fix, Phase B
 * validation (docs/phase3/TECHNICAL_DEBT.md). Proves, in a real browser
 * against the REAL unmodified components:
 * (1) MediaSourceField's new `allowUrlMode` prop, at its DEFAULT value,
 *     leaves the two existing call sites (SendButtonsEditor,
 *     SendDocumentEditor — both omit the prop) genuinely unaffected: the
 *     Upload/URL tab switcher still renders, URL mode still reachable;
 * (2) allowUrlMode={false} (the new TemplateCreateDrawer use case) hides
 *     the tab switcher entirely and forces upload-only;
 * (3) TemplateCreateDrawer loads the exact real pre-fix shape of the one
 *     broken draft that started this whole investigation
 *     (cdsl_invite_marketing — example.header_handle is a raw URL, no
 *     headerMediaRef field at all) without crashing — no console errors,
 *     no error boundary, renders the Header section in a normal empty
 *     "Choose a file…" state instead.
 *
 * Uses the harness technique from protectedRoute.spec.ts (Era 25) — real
 * components re-exported/rendered at a route outside (v3), bypassing
 * ProtectedRoute (neither component calls useAuth()). QueryProvider is
 * wired at the root layout (above (v3)), so it's available here for free.
 *
 * Harness page (dashboard/src/app/template-drawer-verify-temp/page.tsx) was
 * REMOVED after this spec captured its proof — kept here, skipped.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('Template header media handle fix — Phase B validation (2026-07-10)', () => {
  test('MediaSourceField default (allowUrlMode omitted): tab switcher renders, URL mode reachable — the two existing call sites are unaffected', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/template-drawer-verify-temp');

    const container = page.getByTestId('msf-default');
    await expect(container.getByRole('button', { name: 'Upload' })).toBeVisible();
    await expect(container.getByRole('button', { name: 'URL' })).toBeVisible();

    await container.getByRole('button', { name: 'URL' }).click();
    await expect(container.getByPlaceholder('https://…')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('MediaSourceField allowUrlMode={false}: no tab switcher, upload-only, no URL input reachable', async ({ page }) => {
    await page.goto('/template-drawer-verify-temp');

    const container = page.getByTestId('msf-no-url');
    await expect(container.getByRole('button', { name: 'Upload' })).toHaveCount(0);
    await expect(container.getByRole('button', { name: 'URL' })).toHaveCount(0);
    await expect(container.getByPlaceholder('https://…')).toHaveCount(0);
    await expect(container.getByRole('button', { name: 'Choose a file…' })).toBeVisible();
  });

  test('TemplateCreateDrawer loads the old broken draft (raw-URL header_handle, no headerMediaRef) without crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto('/template-drawer-verify-temp');
    await page.getByTestId('open-drawer').click();

    // The drawer opened pre-populated with the old broken template.
    await expect(page.getByLabel('Display Name')).toHaveValue('cdsl invite marketing');
    await expect(page.getByLabel('Template Name (Meta)')).toHaveValue('cdsl_invite_marketing');

    // Header section: media type is IMAGE, MediaSourceField shows the empty
    // "Choose a file…" state (headerMediaRef is undefined on this record) —
    // NOT the old raw ImageKit URL (which is no longer read into form state
    // at all), and no crash/error boundary in its place. Scoped to the
    // drawer itself (getByLabel('Edit Template')) since the page also has
    // the two standalone MediaSourceField instances above.
    const drawer = page.getByLabel('Edit Template');
    await expect(drawer.getByRole('button', { name: 'Choose a file…' })).toBeVisible();

    expect(errors).toEqual([]);
    expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });
});
