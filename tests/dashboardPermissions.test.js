'use strict';

/**
 * Regression test for dashboard/src/lib/permissions.js's canAssignOwner() —
 * the Inbox's canEditOwner check previously used a v3Role-mapped
 * ['owner','admin'].includes(v3Role) test, silently excluding the raw
 * 'manager' role even though the backend's POST /api/crm/leads (which
 * UnknownContactAssignPicker calls to assign an unknown contact) accepts
 * admin, manager, or superadmin via checkRole(['admin','manager']) plus
 * checkRole's universal superadmin bypass.
 *
 * This is a plain .js file (not .ts) specifically so it's requirable here
 * with zero new frontend test tooling — no jest/vitest/testing-library is
 * configured for dashboard/ today, only Playwright e2e.
 */

const { canAssignOwner } = require('../dashboard/src/lib/permissions');

describe('canAssignOwner — mirrors checkRole([\'admin\',\'manager\']) + superadmin bypass', () => {
  test('admin is allowed', () => {
    expect(canAssignOwner('admin')).toBe(true);
  });

  test('manager is allowed — the exact bug being fixed (was silently excluded)', () => {
    expect(canAssignOwner('manager')).toBe(true);
  });

  test('superadmin is allowed — checkRole\'s universal bypass', () => {
    expect(canAssignOwner('superadmin')).toBe(true);
  });

  test('team_lead is NOT allowed — checkRole([\'admin\',\'manager\']) does not include it, even though v3Role would have collapsed it into \'manager\'', () => {
    expect(canAssignOwner('team_lead')).toBe(false);
  });

  test('telecaller, agent, and intern are not allowed', () => {
    expect(canAssignOwner('telecaller')).toBe(false);
    expect(canAssignOwner('agent')).toBe(false);
    expect(canAssignOwner('intern')).toBe(false);
  });

  test('null/undefined/empty role is not allowed, does not throw', () => {
    expect(canAssignOwner(null)).toBe(false);
    expect(canAssignOwner(undefined)).toBe(false);
    expect(canAssignOwner('')).toBe(false);
  });
});
