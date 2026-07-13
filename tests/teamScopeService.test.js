'use strict';

/**
 * TeamScopeService.getTeamMemberIds() — the shared team-membership resolver
 * behind team_lead's Contacts team-scoping (OQ-006, docs/v3/12_DECISION_LOG.md,
 * resolved 2026-07-13). Verifies: (1) it queries the EMPLOYEES table's
 * companyIdIndex GSI (indexed on companyId, not a table-wide scan — the
 * gap metrics.js's own /my-team route has, logged separately in
 * TECHNICAL_DEBT.md, not fixed here), (2) it filters to the requested
 * teamLeadId only, (3) inactive employees are excluded, (4) the team_lead's
 * own id is never included unless they also happen to be their own
 * teamLeadId (not a real scenario, not special-cased).
 */

jest.mock('../src/config/dynamodb', () => ({
  query: jest.fn(),
}));

process.env.DYNAMODB_TABLE_EMPLOYEES = 'vt-employees-test';

const dynamodb = require('../src/config/dynamodb');
const { getTeamMemberIds } = require('../src/services/TeamScopeService');

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const CID = 'comp_test';
const TL_ID = 'emp_tl';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TeamScopeService.getTeamMemberIds()', () => {
  test('queries companyIdIndex scoped to companyId, not an unindexed scan', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));

    await getTeamMemberIds(CID, TL_ID);

    expect(dynamodb.query).toHaveBeenCalledTimes(1);
    const params = dynamodb.query.mock.calls[0][0];
    expect(params.TableName).toBe('vt-employees-test');
    expect(params.IndexName).toBe('companyIdIndex');
    expect(params.KeyConditionExpression).toBe('companyId = :cid');
    expect(params.ExpressionAttributeValues).toEqual({ ':cid': CID });
  });

  test('returns only employees whose teamLeadId matches, excludes other team_leads\' reports', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [
        { id: 'emp_a', teamLeadId: TL_ID, status: 'active' },
        { id: 'emp_b', teamLeadId: TL_ID, status: 'active' },
        { id: 'emp_c', teamLeadId: 'emp_other_tl', status: 'active' },
        { id: 'emp_d', teamLeadId: null, status: 'active' },
      ],
    }));

    const result = await getTeamMemberIds(CID, TL_ID);

    expect(result).toEqual(new Set(['emp_a', 'emp_b']));
  });

  test('excludes inactive team members', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [
        { id: 'emp_a', teamLeadId: TL_ID, status: 'active' },
        { id: 'emp_b', teamLeadId: TL_ID, status: 'inactive' },
      ],
    }));

    const result = await getTeamMemberIds(CID, TL_ID);

    expect(result).toEqual(new Set(['emp_a']));
  });

  test('does not include the team_lead\'s own id unless they also report to themselves', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [
        { id: 'emp_a', teamLeadId: TL_ID, status: 'active' },
      ],
    }));

    const result = await getTeamMemberIds(CID, TL_ID);

    expect(result.has(TL_ID)).toBe(false);
  });

  test('empty team returns an empty Set, not an error', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));

    const result = await getTeamMemberIds(CID, TL_ID);

    expect(result).toEqual(new Set());
  });

  test('paginates across multiple pages via queryAll (LastEvaluatedKey honored)', async () => {
    dynamodb.query
      .mockReturnValueOnce(resolved({
        Items: [{ id: 'emp_a', teamLeadId: TL_ID, status: 'active' }],
        LastEvaluatedKey: { id: 'emp_a' },
      }))
      .mockReturnValueOnce(resolved({
        Items: [{ id: 'emp_b', teamLeadId: TL_ID, status: 'active' }],
      }));

    const result = await getTeamMemberIds(CID, TL_ID);

    expect(dynamodb.query).toHaveBeenCalledTimes(2);
    expect(result).toEqual(new Set(['emp_a', 'emp_b']));
  });
});
