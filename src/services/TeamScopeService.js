'use strict';

// team_lead team-scoping (OQ-006, docs/v3/12_DECISION_LOG.md — resolved
// 2026-07-13: team_lead gets team-wide read/export on Contacts). Single
// source of truth for "which employees report to this team_lead" so
// contacts.js and tags.js don't each grow their own copy of this lookup.
//
// Deliberately queries the EMPLOYEES table's companyIdIndex GSI (indexed on
// companyId) rather than scanning — metrics.js's own /my-team route does an
// unindexed dynamodb.scan() with a bare teamLeadId FilterExpression and no
// companyId key condition at all (scans every company's employees, not just
// the caller's); this service does not repeat that shape. No teamLeadId GSI
// exists on this table, so the teamLeadId match itself is still an in-memory
// filter after the indexed companyId fetch, not a second indexed query.

const { queryAll } = require('../utils/db');

// Employee IDs whose teamLeadId points at the given team_lead, within one
// company. Does NOT include teamLeadId itself — callers combine this with
// their own "assignedTo === req.user.id" check for the team_lead's own
// directly-assigned contacts, which is a separate, already-working case.
async function getTeamMemberIds(companyId, teamLeadId) {
  const items = await queryAll({
    TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
    IndexName: 'companyIdIndex',
    KeyConditionExpression: 'companyId = :cid',
    ProjectionExpression: 'id, teamLeadId, #s',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':cid': companyId },
  });
  return new Set(
    items
      .filter((e) => e.teamLeadId === teamLeadId && e.status !== 'inactive')
      .map((e) => e.id)
  );
}

module.exports = { getTeamMemberIds };
