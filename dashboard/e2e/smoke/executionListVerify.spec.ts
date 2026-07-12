import { test, expect } from '@playwright/test';

/**
 * TEMPORARY — 2026-07-12 Track B2 Batch 2a, Item 6.
 * Proves, in a real browser against the real unmodified ExecutionList, that
 * adopting SearchBar/FilterBar/Table (replacing the hand-rolled search input,
 * status <select>, and raw <table>) preserves every existing capability:
 * search, status filter, the new sort-by-Started column, real pagination,
 * and the step/path trace-expand feature (now Table.tsx's new opt-in
 * expandedRowId/renderExpandedRow, exercised for BOTH a linear (steps[]) and
 * a graph (path[]) execution, since ExecutionList branches on
 * isGraphExecution()).
 *
 * The mocked route below implements real filter/sort/paginate logic against
 * a fixed in-memory fixture set (mirroring automations.js's actual GET
 * /executions behavior) rather than returning one static page — this is
 * what lets the test drive real search/filter/sort/page-change interactions
 * and observe real, different results each time, not just a fixed snapshot.
 *
 * Uses the harness technique documented in protectedRoute.spec.ts (Era 25) —
 * a temporary, unauthenticated page rendering ExecutionList directly outside
 * (v3), no login needed. serviceWorkers: 'block' + explicit CORS headers —
 * same two gotchas documented in kanbanVerify.spec.ts's header comment.
 *
 * Harness page (dashboard/src/app/executionlist-verify-temp/page.tsx) was
 * REMOVED after this spec captured its proof — kept here, skipped, as the
 * record.
 *
 * To reactivate: recreate the harness page (content is in this file's git
 * history / the session that added it — a one-line render of the real
 * ExecutionList component), then remove the .skip below.
 */
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });

const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:3001', 'Access-Control-Allow-Credentials': 'true' };

function makeExec(i: number, overrides: Record<string, unknown> = {}) {
  const base = {
    executionId: `exec-${i}`,
    workflowId: 'wf-1',
    workflowName: i % 3 === 0 ? 'Follow-up Flow' : 'Welcome Flow',
    companyId: 'c1',
    status: 'completed',
    contactName: `Contact ${i}`,
    triggeredBy: { type: 'lead_created', entityId: 'lead-1' },
    startedAt: new Date(2026, 0, 1, 0, i).toISOString(),
    durationMs: 1000 + i,
    ...overrides,
  };
  // Even ids get a linear (steps[]) shape, odd ids a graph (path[]) shape —
  // exercises both StepTrace and PathTrace branches.
  return i % 2 === 0
    ? { ...base, steps: [{ stepId: 's1', type: 'send_template', status: 'completed' }] }
    : { ...base, path: [{ nodeId: 'n1', type: 'send_template', status: 'completed' }] };
}

const FIXTURES = [
  ...Array.from({ length: 27 }, (_, i) => makeExec(i, { status: 'completed' })),
  makeExec(27, { status: 'failed', contactName: 'Zoya' }),
  makeExec(28, { status: 'failed', contactName: 'Kiran' }),
  makeExec(29, { status: 'running', contactName: 'Dev' }),
];

function mockExecutionsRoute(page: import('@playwright/test').Page) {
  return page.route('**/api/automations/executions*', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
      return;
    }
    let items = [...FIXTURES];
    const status = url.searchParams.get('status');
    const q = url.searchParams.get('q');
    const sortDir = url.searchParams.get('sortDir');
    if (status) items = items.filter((e) => e.status === status);
    if (q) {
      const ql = q.toLowerCase();
      items = items.filter((e) => e.workflowName.toLowerCase().includes(ql) || e.contactName.toLowerCase().includes(ql));
    }
    if (sortDir === 'asc') items = [...items].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    else items = [...items].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    const total = items.length;
    const pg = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const ps = Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10));
    const pages = Math.ceil(total / ps) || 1;
    const sliced = items.slice((pg - 1) * ps, pg * ps);

    await route.fulfill({
      status: 200, contentType: 'application/json', headers: CORS,
      body: JSON.stringify({ success: true, executions: sliced, total, page: pg, pageSize: ps, pages }),
    });
  });
}

test.describe.skip('ExecutionList — SearchBar/FilterBar/Table adoption (2026-07-12, Track B2 Batch 2a)', () => {
  test('search, status filter, sort, pagination, and both trace-expand shapes all work', async ({ page }) => {
    await mockExecutionsRoute(page);
    await page.goto('/executionlist-verify-temp');

    // ── Initial load: 30 total, default pageSize 50 -> 1 page, all visible ──
    await expect(page.getByText('30 of 30', { exact: false })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(30);

    // ── Status filter: chip appears, only failed rows remain ──────────────
    await page.getByRole('toolbar', { name: 'Filters' }).getByRole('combobox').selectOption('failed');
    await expect(page.getByText('Status:', { exact: false })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByText('Zoya')).toBeVisible();
    await expect(page.getByText('Kiran')).toBeVisible();

    // Clear the filter via the chip's remove button.
    await page.getByRole('button', { name: /Remove Status filter/i }).click();
    await expect(page.locator('tbody tr')).toHaveCount(30);

    // ── Search: narrows to workflowName/contactName matches ────────────────
    await page.getByRole('searchbox').fill('zoya');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByText('Zoya')).toBeVisible();
    await page.getByRole('searchbox').fill('');
    await expect(page.locator('tbody tr')).toHaveCount(30);

    // ── Sort by Started: Table's 3-state cycle is desc -> null -> asc, so
    // the default 'desc' this component starts in needs two clicks to reach
    // a genuinely different (ascending) order — one click alone only clears
    // the explicit sort, which looks identical here since null falls back to
    // the same naturally-descending default.
    const firstContactBefore = await page.locator('tbody tr').first().locator('td').nth(2).textContent();
    await page.getByRole('columnheader', { name: 'Started' }).click(); // desc -> null (no visible change)
    await page.getByRole('columnheader', { name: 'Started' }).click(); // null -> asc
    const firstContactAfter = await page.locator('tbody tr').first().locator('td').nth(2).textContent();
    expect(firstContactAfter).not.toBe(firstContactBefore);

    // ── Pagination: shrink page size to force multiple pages, then page forward ──
    // 30 total / 25 per page = 2 pages (25 + 5) — 25 is Pagination.tsx's
    // smallest built-in pageSizeOptions value, not an arbitrary test choice.
    await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('25');
    await expect(page.locator('tbody tr')).toHaveCount(25);
    await expect(page.getByText('1 / 2', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('2 / 2', { exact: false })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(5);

    // ── Trace-expand: both a linear (steps[]) and a graph (path[]) row ─────
    // Reset to a clean, unfiltered, unpaged view for deterministic row targeting.
    await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('50');
    const linearRow = page.locator('tbody tr', { hasText: 'Contact 0' }); // even id -> steps[]
    await linearRow.click();
    await expect(page.getByText('Send Template')).toBeVisible(); // StepTrace label

    await linearRow.click(); // collapse
    await expect(page.getByText('Send Template')).not.toBeVisible();

    const graphRow = page.locator('tbody tr', { hasText: 'Contact 3' }); // odd id -> path[]; unambiguous (no "Contact 3X" in this fixture set)
    await graphRow.click();
    await expect(page.getByText('Send Template')).toBeVisible(); // PathTrace label

    await page.screenshot({ path: 'e2e/execution-list-adoption.png' });
  });
});
