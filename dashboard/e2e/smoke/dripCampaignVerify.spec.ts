import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — "Create Drip Campaign" on-ramp (Campaigns page → Automation
 * canvas). Proves, in a real browser against the real unmodified components:
 *
 *   1. Campaigns page renders a "Create Drip Campaign" button, visually
 *      distinct from the broadcast-campaign flow (indigo outline + Droplets
 *      icon vs. the primary-filled buttons elsewhere on the page), and
 *      clicking it navigates to /automation/canvas/new?template=drip.
 *   2. That route's create-then-redirect flow, given ?template=drip, POSTs
 *      the EXACT drip skeleton (trigger tag_added; nodes wait → send_template
 *      → wait → send_template → end, all placeholder config; source
 *      'drip_campaign_template') to POST /api/automations — not just "a"
 *      payload, the real one this feature is supposed to produce — then
 *      redirects straight into that workflow's canvas editor
 *      (/automation/canvas/{id}?new=1), same as the blank "New workflow"
 *      flow already does.
 *
 * ProtectedRoute would redirect an unauthenticated visitor to /login before
 * either component under test ever rendered, so both harnesses bypass it
 * and render the real inner components directly — same technique as every
 * other *Verify.spec.ts this session. Run with --no-deps to skip the auth
 * setup project entirely.
 *
 * Harness pages (dashboard/src/app/campaigns-drip-verify-temp/page.tsx,
 * dashboard/src/app/new-drip-verify-temp/page.tsx) and both components'
 * temporary `export`s (campaigns/page.tsx, automation/canvas/new/page.tsx)
 * were REMOVED after this spec captured its proof (6/6 passed across 2
 * repeats each; the skeleton-order assertion was also confirmed to fail
 * against a deliberately-reordered node array before being restored, proving
 * real regression coverage) — kept, skipped, as the record of that proof,
 * same convention as every other *Verify.spec.ts in this directory.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.skip('Create Drip Campaign — button, skeleton, redirect', () => {
  test('Campaigns page shows a visually distinct Create Drip Campaign button that navigates to the drip on-ramp', async ({ page }) => {
    await page.route('**/api/campaigns/stats', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, stats: {} }) }));
    await page.route('**/api/campaigns', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, campaigns: [] }) }));

    await page.goto('/campaigns-drip-verify-temp');
    const dripBtn = page.getByRole('button', { name: 'Create Drip Campaign' });
    await expect(dripBtn).toBeVisible();

    // Visually distinct from the broadcast flow's primary-filled styling —
    // an indigo outline button, not bg-primary-600.
    const classes = await dripBtn.getAttribute('class');
    expect(classes).toContain('indigo');
    expect(classes).not.toContain('bg-primary-600');

    await dripBtn.click();
    await expect(page).toHaveURL(/\/automation\/canvas\/new\?template=drip/);
  });

  test('the drip on-ramp POSTs the exact skeleton and redirects into that workflow\'s canvas editor', async ({ page }) => {
    let postedBody: unknown = null;
    await page.route('**/api/automations', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      postedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, automation: { id: 'wf-drip-fake-123', ...(postedBody as object) } }),
      });
    });

    await page.goto('/new-drip-verify-temp?template=drip');
    await expect(page.getByText('Creating drip campaign…')).toBeVisible();
    await expect(page).toHaveURL(/\/automation\/canvas\/wf-drip-fake-123\?new=1/);

    expect(postedBody).toMatchObject({
      name: 'New drip campaign',
      trigger: { type: 'tag_added', conditions: [] },
      status: 'draft',
      entryNodeId: 'n1',
      source: 'drip_campaign_template',
    });
    const nodes = (postedBody as { nodes: Array<{ id: string; type: string; config: unknown }> }).nodes;
    expect(nodes.map((n) => n.type)).toEqual(['wait', 'send_template', 'wait', 'send_template', 'end']);
    // Placeholder/empty config the admin fills in — not pre-guessed content.
    expect(nodes[1].config).toMatchObject({ templateName: '' });
    expect(nodes[3].config).toMatchObject({ templateName: '' });
    // No hand-computed positions — the canvas auto-arranges via dagre when
    // positions are absent (automationGraph.ts's needsAutoLayout()).
    expect(nodes.every((n) => !('position' in n))).toBe(true);

    const edges = (postedBody as { edges: Array<{ source: string; target: string }> }).edges;
    expect(edges.map((e) => `${e.source}->${e.target}`)).toEqual(['n1->n2', 'n2->n3', 'n3->n4', 'n4->n5']);
  });

  test('the blank "New workflow" flow (no template param) is completely unaffected', async ({ page }) => {
    let postedBody: unknown = null;
    await page.route('**/api/automations', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      postedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, automation: { id: 'wf-blank-fake-456', ...(postedBody as object) } }),
      });
    });

    await page.goto('/new-drip-verify-temp');
    await expect(page.getByText('Creating new workflow…')).toBeVisible();
    await expect(page).toHaveURL(/\/automation\/canvas\/wf-blank-fake-456\?new=1/);

    expect(postedBody).toMatchObject({
      name: 'New workflow',
      trigger: { type: 'lead_created', conditions: [] },
    });
    expect(postedBody).not.toHaveProperty('source');
    const nodes = (postedBody as { nodes: Array<{ type: string }> }).nodes;
    expect(nodes.map((n) => n.type)).toEqual(['end']);
  });
});
