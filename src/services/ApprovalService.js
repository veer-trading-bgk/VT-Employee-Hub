'use strict';

const { v4: uuidv4 } = require('uuid');
const dynamodb = require('../config/dynamodb');
const { queryAll } = require('../utils/db');

const METRICS_TABLE = process.env.DYNAMODB_TABLE_METRICS;
const EMP_TABLE      = process.env.DYNAMODB_TABLE_EMPLOYEES;

const APPROVAL_PK = (companyId) => `APPROVAL#${companyId}`;
const VALID_STATUSES = new Set(['approved', 'rejected']);
const VALID_LIST_STATUSES = new Set(['pending', 'approved', 'rejected']);

/**
 * Genuinely new logic — confirmed via audit that no leave-aware routing pattern
 * exists anywhere else in this codebase to reuse (autoAssign.js's own fallback is
 * capacity/overflow load-balancing only). Backs AIService's human-in-the-loop
 * approval gate (ADR-015 point 7): when a customerFacing useCase's output needs a
 * human to sign off, this decides WHO that human is, accounting for the assigned
 * employee being on leave.
 */

async function _isOnApprovedLeaveToday(companyId, userId) {
  const today = new Date().toISOString().slice(0, 10);
  const items = await queryAll({
    TableName: METRICS_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `LEAVE#${companyId}#${userId}`, ':sk': 'LEAVE#' },
  });
  return items.some((l) => l.status === 'approved' && l.startDate <= today && today <= l.endDate);
}

async function _getEmployee(userId) {
  const r = await dynamodb.get({ TableName: EMP_TABLE, Key: { id: userId } }).promise();
  return r.Item ?? null;
}

async function _findActiveAdmin(companyId, excludeIds = []) {
  const admins = await queryAll({
    TableName: EMP_TABLE,
    IndexName: 'companyIdIndex',
    KeyConditionExpression: 'companyId = :cid',
    FilterExpression: '#r = :admin AND #s <> :inactive',
    ExpressionAttributeNames: { '#r': 'role', '#s': 'status' },
    ExpressionAttributeValues: { ':cid': companyId, ':admin': 'admin', ':inactive': 'inactive' },
  });
  const exclude = new Set(excludeIds);
  // Deterministic pick (by id) — this is a rare fallback path, not a hot load
  // balancer, so "any available admin" just needs to be stable, not weighted.
  const candidates = admins.filter((a) => !exclude.has(a.id)).sort((a, b) => (a.id > b.id ? 1 : -1));
  return candidates[0]?.id ?? null;
}

/**
 * Routing order: (1) the employee the action concerns → (2) their teamLeadId if
 * (1) is on approved leave today → (3) any active admin if (2) is also on leave or
 * unset → (4) unassigned if nobody is available (never silently dropped — the
 * caller still gets a pending approval record, just with assignedTo: null).
 */
async function resolveRoutingTarget(companyId, assigneeId) {
  const assigneeOnLeave = await _isOnApprovedLeaveToday(companyId, assigneeId);
  if (!assigneeOnLeave) return { targetUserId: assigneeId, routingReason: 'direct' };

  const assignee = await _getEmployee(assigneeId);
  const teamLeadId = assignee?.teamLeadId;
  if (teamLeadId) {
    const teamLeadOnLeave = await _isOnApprovedLeaveToday(companyId, teamLeadId);
    if (!teamLeadOnLeave) return { targetUserId: teamLeadId, routingReason: 'leave-fallback-teamlead' };
  }

  const adminId = await _findActiveAdmin(companyId, [assigneeId, teamLeadId].filter(Boolean));
  if (adminId) return { targetUserId: adminId, routingReason: 'leave-fallback-admin' };

  return { targetUserId: null, routingReason: 'unassigned' };
}

/** Creates a pending approval, already routed to the right human via resolveRoutingTarget(). */
async function routeApproval(companyId, { useCase, output, confidence, riskLevel, promptVersion, assigneeId }) {
  const { targetUserId, routingReason } = await resolveRoutingTarget(companyId, assigneeId);

  const approvalId = uuidv4();
  const createdAt  = new Date().toISOString();
  const item = {
    PK: APPROVAL_PK(companyId),
    SK: `pending#${createdAt}#${approvalId}`,
    approvalId, companyId, useCase, output, confidence, riskLevel, promptVersion,
    assignedTo: targetUserId,
    originalAssignee: assigneeId,
    routingReason,
    status: 'pending',
    createdAt,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
  };

  await dynamodb.put({ TableName: METRICS_TABLE, Item: item }).promise();
  return item;
}

/** Moves a pending approval to 'approved'/'rejected' — a delete+put, since both PK and SK encode status. */
async function resolveApproval(companyId, approvalId, { status, resolvedBy, resolutionNote } = {}) {
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid approval status: ${status}`);

  const pending = await queryAll({
    TableName: METRICS_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': APPROVAL_PK(companyId), ':sk': 'pending#' },
  });
  const found = pending.find((a) => a.approvalId === approvalId);
  if (!found) throw new Error(`Approval ${approvalId} not found among pending approvals`);

  const resolvedAt = new Date().toISOString();
  const updated = {
    ...found,
    SK: `${status}#${found.createdAt}#${approvalId}`,
    status,
    resolvedBy,
    resolvedAt,
    resolutionNote: resolutionNote ?? null,
  };

  await dynamodb.delete({ TableName: METRICS_TABLE, Key: { PK: APPROVAL_PK(companyId), SK: found.SK } }).promise();
  await dynamodb.put({ TableName: METRICS_TABLE, Item: updated }).promise();
  return updated;
}

/**
 * Lists a company's approvals, newest first. `status` restricts to one SK-prefix
 * range (a real Query, not a Scan — APPROVAL_PK is already company-wide, unlike
 * LEAVE#'s per-user PK) when it's one of the three real statuses; omitted, returns
 * every status the company has ever had — an approval queue is human-decision
 * volume, not a hot path, so no pagination concern yet. `assignedTo` further
 * filters in memory to one person's queue: there's no GSI on assignedTo and the
 * per-company item count doesn't warrant one.
 */
async function listApprovals(companyId, { assignedTo, status } = {}) {
  const hasStatusFilter = VALID_LIST_STATUSES.has(status);
  const items = await queryAll({
    TableName: METRICS_TABLE,
    KeyConditionExpression: hasStatusFilter ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
    ExpressionAttributeValues: hasStatusFilter
      ? { ':pk': APPROVAL_PK(companyId), ':sk': `${status}#` }
      : { ':pk': APPROVAL_PK(companyId) },
  });
  const filtered = assignedTo ? items.filter((a) => a.assignedTo === assignedTo) : items;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Finds one approval by id regardless of its current status (pending, already
 * approved, or already rejected) — the resolve route needs this to tell "not
 * found" (404) apart from "found, but already resolved" (409), and to check who
 * is authorized to act on it before calling resolveApproval().
 */
async function getApproval(companyId, approvalId) {
  const items = await listApprovals(companyId);
  return items.find((a) => a.approvalId === approvalId) ?? null;
}

module.exports = { resolveRoutingTarget, routeApproval, resolveApproval, listApprovals, getApproval };
