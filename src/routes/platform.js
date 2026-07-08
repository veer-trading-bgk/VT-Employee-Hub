const express = require('express');
const { authMiddleware, platformAdminMiddleware, invalidatePlanCache } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const dynamodb = require('../config/dynamodb');
const bot = require('../config/telegram');
const logger = require('../config/logger');
const AiCostReportService = require('../services/AiCostReportService');

const router = express.Router();

// All platform routes require: valid JWT AND superadmin role
router.use(authMiddleware, platformAdminMiddleware);

const EMP_TABLE = process.env.DYNAMODB_TABLE_EMPLOYEES;
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// ── GET /api/platform/companies ────────────────────────────────────────────────
// List all companies (tenants) with their plan status

router.get('/companies', async (req, res, next) => {
  try {
    const result = await dynamodb.scan({
      TableName: EMP_TABLE,
      FilterExpression: '#type = :t',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: { ':t': 'COMPANY_PROFILE' },
      ProjectionExpression: 'id, companyId, companyName, broker, city, adminEmail, #plan, planStatus, trialEndsAt, createdAt',
      ExpressionAttributeNames: { '#type': 'type', '#plan': 'plan' },
    }).promise();

    const companies = (result.Items ?? []).map((c) => {
      const daysLeft = c.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(c.trialEndsAt) - Date.now()) / 86_400_000))
        : null;
      return { ...c, daysLeftInTrial: daysLeft };
    });

    res.json({ success: true, total: companies.length, companies });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/platform/companies/:companyId ─────────────────────────────────────
// Detail view for a specific company

router.get('/companies/:companyId', async (req, res, next) => {
  try {
    const { companyId } = req.params;

    const profileResult = await dynamodb.get({
      TableName: EMP_TABLE,
      Key: { id: `COMPANY#${companyId}` },
    }).promise();

    if (!profileResult.Item) return res.status(404).json({ error: 'Company not found' });

    // Employee count
    const empResult = await dynamodb.scan({
      TableName: EMP_TABLE,
      FilterExpression: 'companyId = :cid AND attribute_not_exists(#type)',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: { ':cid': companyId },
      Select: 'COUNT',
    }).promise();

    // Lead count
    const leadResult = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta',
      ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA' },
      Select: 'COUNT',
    }).promise();

    res.json({
      success: true,
      company: profileResult.Item,
      stats: {
        employeeCount: empResult.Count ?? 0,
        leadCount: leadResult.Count ?? 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/platform/companies/:companyId/plan ────────────────────────────────
// Change a company's plan (trial → paid, or suspend, or reactivate)

router.put('/companies/:companyId/plan', async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { plan, planStatus, trialEndsAt } = req.body;

    const allowed = { plan: ['trial', 'paid', 'enterprise', 'internal'], planStatus: ['active', 'suspended', 'expired'] };
    if (plan && !allowed.plan.includes(plan)) {
      return res.status(400).json({ error: `plan must be one of: ${allowed.plan.join(', ')}` });
    }
    if (planStatus && !allowed.planStatus.includes(planStatus)) {
      return res.status(400).json({ error: `planStatus must be one of: ${allowed.planStatus.join(', ')}` });
    }

    const profile = await dynamodb.get({
      TableName: EMP_TABLE,
      Key: { id: `COMPANY#${companyId}` },
    }).promise();
    if (!profile.Item) return res.status(404).json({ error: 'Company not found' });

    // Internal plan companies cannot be suspended — they are owner-owned
    if (profile.Item.plan === 'internal' && planStatus === 'suspended') {
      return res.status(403).json({ error: 'Internal (owner-owned) companies cannot be suspended.' });
    }

    const setClauses = ['updatedAt = :updatedAt', 'updatedBy = :updatedBy'];
    const attrValues = {
      ':updatedAt': new Date().toISOString(),
      ':updatedBy': req.user.id,
    };
    const attrNames = {};

    if (plan) { setClauses.push('#plan = :plan'); attrNames['#plan'] = 'plan'; attrValues[':plan'] = plan; }
    if (planStatus) { setClauses.push('planStatus = :planStatus'); attrValues[':planStatus'] = planStatus; }
    // Switching to internal automatically clears trialEndsAt — internal companies never expire
    if (plan === 'internal') {
      setClauses.push('trialEndsAt = :trialEndsAt'); attrValues[':trialEndsAt'] = null;
    } else if (trialEndsAt) {
      setClauses.push('trialEndsAt = :trialEndsAt'); attrValues[':trialEndsAt'] = trialEndsAt;
    }

    await dynamodb.update({
      TableName: EMP_TABLE,
      Key: { id: `COMPANY#${companyId}` },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ...(Object.keys(attrNames).length ? { ExpressionAttributeNames: attrNames } : {}),
      ExpressionAttributeValues: attrValues,
    }).promise();

    // Invalidate plan cache so subscriptionMiddleware picks up new status on next token refresh
    invalidatePlanCache(companyId);

    const action = planStatus === 'suspended' ? 'suspend_company' : 'update_company_plan';
    await logAudit(req.user.id, action, companyId, 'success', req.ip, { plan, planStatus, trialEndsAt });
    logger.info(`Platform: ${req.user.email} changed plan for ${companyId} → plan=${plan} status=${planStatus}`);

    if (planStatus === 'suspended') {
      bot.sendMessage(
        process.env.TELEGRAM_ADMIN_CHAT_ID,
        `🔴 Company Suspended\n\nCompany: ${profile.Item.companyName} (${companyId})\nBy: ${req.user.email}`
      ).catch(() => {});
    }

    res.json({ success: true, companyId, plan, planStatus, trialEndsAt });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/platform/companies/:companyId/unsuspend ─────────────────────────

router.post('/companies/:companyId/unsuspend', async (req, res, next) => {
  try {
    const { companyId } = req.params;

    const profile = await dynamodb.get({
      TableName: EMP_TABLE,
      Key: { id: `COMPANY#${companyId}` },
    }).promise();
    if (!profile.Item) return res.status(404).json({ error: 'Company not found' });

    await dynamodb.update({
      TableName: EMP_TABLE,
      Key: { id: `COMPANY#${companyId}` },
      UpdateExpression: 'SET planStatus = :s, updatedAt = :at, updatedBy = :by',
      ExpressionAttributeValues: {
        ':s': 'active',
        ':at': new Date().toISOString(),
        ':by': req.user.id,
      },
    }).promise();

    invalidatePlanCache(companyId);

    await logAudit(req.user.id, 'unsuspend_company', companyId, 'success', req.ip, {});
    logger.info(`Platform: ${req.user.email} unsuspended company ${companyId}`);

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `🟢 Company Unsuspended\n\nCompany: ${profile.Item.companyName} (${companyId})\nBy: ${req.user.email}`
    ).catch(() => {});

    res.json({ success: true, companyId, planStatus: 'active' });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/platform/stats ────────────────────────────────────────────────────
// Platform-wide stats dashboard for APForce staff

router.get('/stats', async (req, res, next) => {
  try {
    // Count all company profiles
    const companyResult = await dynamodb.scan({
      TableName: EMP_TABLE,
      FilterExpression: '#type = :t',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: { ':t': 'COMPANY_PROFILE' },
      ProjectionExpression: 'companyId, planStatus, #plan, trialEndsAt',
      ExpressionAttributeNames: { '#type': 'type', '#plan': 'plan' },
    }).promise();

    const companies = companyResult.Items ?? [];
    const now = Date.now();

    const stats = {
      totalCompanies: companies.length,
      internal: companies.filter((c) => c.plan === 'internal').length,
      active: companies.filter((c) => c.planStatus === 'active' && c.plan !== 'trial' && c.plan !== 'internal').length,
      onTrial: companies.filter((c) => c.plan === 'trial' && c.planStatus === 'active').length,
      trialExpired: companies.filter((c) => {
        if (c.plan !== 'trial') return false;
        return c.trialEndsAt && new Date(c.trialEndsAt).getTime() < now;
      }).length,
      suspended: companies.filter((c) => c.planStatus === 'suspended').length,
    };

    res.json({ success: true, stats, generatedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/platform/ai-costs ──────────────────────────────────────────────
// Cross-tenant AI cost report (docs/bible/19_DECISION_LOG.md Era 38).
// Query params: from, to (ISO timestamps, both optional — default last 30 days).
// production/admin_test/untagged are always three separate buckets — never
// blended into one total (Era 36's finding: most data to date is admin_test).

router.get('/ai-costs', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const report = await AiCostReportService.getAiCostReport({ from, to });
    res.json({ success: true, ...report });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/platform/ai-costs/entity/:entityId ────────────────────────────
// Drill-down: every AIUSAGE#/EMBEDUSAGE# record tied to one entityId
// (typically a conversationId) — no date range, no company scoping.

router.get('/ai-costs/entity/:entityId', async (req, res, next) => {
  try {
    const detail = await AiCostReportService.getEntityCostDetail(req.params.entityId);
    res.json({ success: true, ...detail });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
