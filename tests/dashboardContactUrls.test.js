'use strict';

/**
 * Regression test for dashboard/src/lib/contactUrls.js's
 * buildContactDeleteRequest() — extracted from contacts/page.tsx's
 * bulk-delete mutation.
 *
 * Note on why this test exists: it was originally requested to fix a
 * reported backslash typo (`\api\crm\leads\...`) in that mutation's URL
 * construction. Re-verified directly against the file (a fresh Read, plus
 * `git log -p --all` across the file's entire history) before touching
 * anything — the backslash bug never actually existed in the code; the
 * earlier report of it was a misread on my part. The URL construction was
 * already correct. It's extracted and tested here anyway as a genuine,
 * cheap regression guard against a similar typo ever landing unnoticed,
 * not because a bug was found.
 *
 * Plain .js (not .ts) so it's requirable with zero new frontend test
 * tooling — no jest/vitest/testing-library is configured for dashboard/
 * today, only Playwright e2e.
 */

const { buildContactDeleteRequest } = require('../dashboard/src/lib/contactUrls');

describe('buildContactDeleteRequest', () => {
  test('a real CRM lead (type: "lead") routes to /api/crm/leads/:id with forward slashes', () => {
    const req = buildContactDeleteRequest({ id: 'lead_123', phone: '9876543210', type: 'lead', leadId: 'lead_123' });
    expect(req).toEqual({ url: '/api/crm/leads/lead_123', method: 'DELETE' });
    expect(req.url).not.toMatch(/\\/); // never backslashes
  });

  test('a contact with a leadId but no explicit type still routes as a lead (leadId is the authority)', () => {
    const req = buildContactDeleteRequest({ id: 'lead_456', phone: '9876543211', leadId: 'lead_456' });
    expect(req.url).toBe('/api/crm/leads/lead_456');
  });

  test('an unknown (phone-only, INBOX#) contact routes to /api/contacts/unknown/:phone', () => {
    const req = buildContactDeleteRequest({ id: '9876543212', phone: '9876543212', type: 'unknown', leadId: null });
    expect(req).toEqual({ url: '/api/contacts/unknown/9876543212', method: 'DELETE' });
    expect(req.url).not.toMatch(/\\/);
  });

  test('an unknown contact with leadId omitted entirely (not just null) is still treated as unknown', () => {
    const req = buildContactDeleteRequest({ id: '9876543213', phone: '9876543213', type: 'unknown' });
    expect(req.url).toBe('/api/contacts/unknown/9876543213');
  });
});
