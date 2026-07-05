'use strict';

const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const logger = require('../config/logger');
const ApprovalService = require('../services/ApprovalService');

const router = express.Router();

const VALID_LIST_STATUSES = new Set(['pending', 'approved', 'rejected']);
const VALID_RESOLVE_STATUSES = new Set(['approved', 'rejected']);

/**
 * Approval queue for AIService's human-in-the-loop gate (ADR-015 point 7,
 * ApprovalService.js). Until now this had zero route and zero frontend — a
 * routed approval sat in DynamoDB with no way for a human to ever see, approve,
 * or reject it. This router only fixes that visibility/actionability gap.
 *
 * Deliberate scope boundary, not a bug: resolving here only records the human
 * decision (status, resolvedBy, resolvedAt) — it does NOT release or send the
 * approved output anywhere. No customerFacing AI use case exists yet to define
 * what "send this" means for its own output shape (a template suggestion's
 * approved output needs a different WhatsAppSendService call than a freeform
 * chat draft's), so that wiring is left to whichever future feature actually
 * produces customerFacing output, in that feature's own commit.
 */

// ── GET /api/approvals — the current user's own queue (assignedTo === self) ──
// Any authenticated role: ApprovalService's routing can target any employee
// (e.g. the telecaller a customer-facing draft concerns), not just admins/
// managers, so this can't be role-gated the way /admin below is.
// ?status= is optional and unfiltered when omitted (same convention as
// GET /api/attendance/leave/admin) — the frontend's own tab state, not this
// route, is what defaults to "pending".
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { status } = req.query;
    if (status && !VALID_LIST_STATUSES.has(status)) {
      return res.status(400).json({ error: 'status must be pending, approved, or rejected' });
    }
    const approvals = await ApprovalService.listApprovals(req.user.companyId, {
      assignedTo: req.user.id,
      status,
    });
    res.json({ success: true, approvals });
  } catch (error) {
    logger.error('approvals GET error', error.message);
    next(error);
  }
});

// ── GET /api/approvals/admin — full company visibility (admin/manager only) ─
// Includes assignedTo: null ("unassigned" — nobody was available when
// ApprovalService routed this; only ever visible here, never in a personal
// queue). Registered before any /:id route — same param-collision concern
// attendance.js's own /leave/admin comment documents ("admin" would otherwise
// be captured by a /:id param).
router.get('/admin', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { status } = req.query;
    if (status && !VALID_LIST_STATUSES.has(status)) {
      return res.status(400).json({ error: 'status must be pending, approved, or rejected' });
    }
    const approvals = await ApprovalService.listApprovals(req.user.companyId, { status });
    res.json({ success: true, approvals });
  } catch (error) {
    logger.error('approvals/admin GET error', error.message);
    next(error);
  }
});

// ── POST /api/approvals/:id/resolve — approve or reject ──────────────────────
// Authorization: the specific person this was routed to, OR any admin/manager/
// superadmin as an escalation valve (needed for the assignedTo: null /
// unassigned case, and for reassigned/offboarded scenarios) — deliberately NOT
// admin/manager-only, which would defeat ApprovalService's whole routing design
// of putting this in front of whoever is closest to the case, not a manager by
// default. 'superadmin' listed explicitly here (unlike checkRole(['admin',
// 'manager']) above, which already treats it as an implicit bypass) because
// this check is inline, not routed through checkRole().
router.post('/:id/resolve', authMiddleware, async (req, res, next) => {
  try {
    const { status, resolutionNote } = req.body;
    if (!VALID_RESOLVE_STATUSES.has(status)) {
      return res.status(400).json({ error: 'status must be approved or rejected' });
    }

    const approval = await ApprovalService.getApproval(req.user.companyId, req.params.id);
    if (!approval) return res.status(404).json({ error: 'Approval not found' });

    const isAssignee = approval.assignedTo === req.user.id;
    const isEscalation = ['admin', 'manager', 'superadmin'].includes(req.user.role);
    if (!isAssignee && !isEscalation) {
      return res.status(403).json({ error: 'You are not authorized to resolve this approval' });
    }
    if (approval.status !== 'pending') {
      return res.status(409).json({ error: 'Approval already resolved' });
    }

    const resolved = await ApprovalService.resolveApproval(req.user.companyId, req.params.id, {
      status,
      resolvedBy: req.user.id,
      resolutionNote: resolutionNote?.trim() || null,
    });
    res.json({ success: true, approval: resolved });
  } catch (error) {
    logger.error('approvals/resolve error', error.message);
    next(error);
  }
});

module.exports = router;
