const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();

router.use(authMiddleware);

function companyKey(companyId) {
  return { id: `COMPANY#${companyId}` };
}

// ── GET /api/companies/profile ─────────────────────────────────────────────────

router.get('/profile', async (req, res, next) => {
  try {
    const { companyId } = req.user;
    if (!companyId) return res.status(404).json({ error: 'No company linked to this account' });

    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: companyKey(companyId),
    }).promise();

    if (!result.Item) return res.status(404).json({ error: 'Company profile not found' });

    const { trialEndsAt, plan, planStatus } = result.Item;
    const daysLeftInTrial = trialEndsAt
      ? Math.max(0, Math.ceil((new Date(trialEndsAt) - Date.now()) / 86_400_000))
      : null;

    res.json({
      success: true,
      company: {
        ...result.Item,
        daysLeftInTrial,
        isTrialExpired: daysLeftInTrial !== null && daysLeftInTrial <= 0 && plan === 'trial',
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/companies/profile ─────────────────────────────────────────────────

router.put('/profile', adminMiddleware, async (req, res, next) => {
  try {
    const { companyId } = req.user;
    if (!companyId) return res.status(404).json({ error: 'No company linked to this account' });

    const allowed = ['companyName', 'broker', 'city'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided' });
    }

    const setClauses = [];
    const attrNames = {};
    const attrValues = { ':updatedAt': new Date().toISOString() };

    for (const [key, val] of Object.entries(updates)) {
      attrNames[`#${key}`] = key;
      attrValues[`:${key}`] = val;
      setClauses.push(`#${key} = :${key}`);
    }
    setClauses.push('updatedAt = :updatedAt');

    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: companyKey(companyId),
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
    }).promise();

    await logAudit(req.user.id, 'update_company_profile', companyId, 'success', req.ip, { updates: Object.keys(updates) }, companyId);
    logger.info(`Company profile updated: ${companyId} by ${req.user.email}`);

    res.json({ success: true, message: 'Company profile updated' });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/companies/trial ───────────────────────────────────────────────────
// Lightweight trial status check — used by the trial banner

router.get('/trial', async (req, res, next) => {
  try {
    const { companyId } = req.user;
    if (!companyId) return res.json({ hasTrial: false });

    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: companyKey(companyId),
      ProjectionExpression: '#plan, trialEndsAt, planStatus, companyName',
      ExpressionAttributeNames: { '#plan': 'plan' },
    }).promise();

    if (!result.Item) return res.json({ hasTrial: false });

    const { plan, trialEndsAt, planStatus, companyName } = result.Item;
    const daysLeft = trialEndsAt
      ? Math.max(0, Math.ceil((new Date(trialEndsAt) - Date.now()) / 86_400_000))
      : null;

    res.json({
      hasTrial: plan === 'trial',
      plan: plan || 'trial',
      planStatus: planStatus || 'active',
      trialEndsAt,
      daysLeft,
      isExpired: daysLeft !== null && daysLeft <= 0 && plan === 'trial',
      companyName,
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/companies/onboarding ─────────────────────────────────────────────
// FIX 8: Onboarding progress tracker — shows what setup steps are complete.
// Steps: company profile, WABA connected, first employee added, first lead received.

router.get('/onboarding', adminMiddleware, async (req, res, next) => {
  try {
    const { companyId } = req.user;
    if (!companyId) return res.status(400).json({ error: 'No company linked' });

    const TABLE = process.env.DYNAMODB_TABLE_METRICS;
    const EMP_TABLE = process.env.DYNAMODB_TABLE_EMPLOYEES;

    // Check company profile
    const profileResult = await dynamodb.get({
      TableName: EMP_TABLE,
      Key: { id: `COMPANY#${companyId}` },
    }).promise();
    const profile = profileResult.Item;

    // Check WABA connected
    const wabaResult = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
    }).promise();
    const wabaConnected = !!wabaResult.Item?.phoneNumberId;

    // Check employees (at least one non-admin employee)
    const empResult = await dynamodb.scan({
      TableName: EMP_TABLE,
      FilterExpression: 'companyId = :cid AND #role <> :admin AND attribute_not_exists(#type)',
      ExpressionAttributeNames: { '#role': 'role', '#type': 'type' },
      ExpressionAttributeValues: { ':cid': companyId, ':admin': 'admin' },
      Select: 'COUNT',
    }).promise();
    const hasEmployees = (empResult.Count ?? 0) > 0;

    // Check first lead received
    const leadResult = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta',
      ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA' },
      Select: 'COUNT',
      Limit: 1,
    }).promise();
    const hasLeads = (leadResult.Count ?? 0) > 0;

    const steps = [
      { id: 'company_profile', label: 'Company profile created', complete: !!profile },
      { id: 'waba_connected', label: 'WhatsApp Business connected', complete: wabaConnected },
      { id: 'first_employee', label: 'First team member added', complete: hasEmployees },
      { id: 'first_lead', label: 'First lead received', complete: hasLeads },
    ];

    const completedCount = steps.filter((s) => s.complete).length;
    const allDone = completedCount === steps.length;

    res.json({
      success: true,
      progress: { completed: completedCount, total: steps.length, percent: Math.round((completedCount / steps.length) * 100) },
      steps,
      allDone,
      ...(profile && {
        company: {
          companyName: profile.companyName,
          plan: profile.plan,
          planStatus: profile.planStatus,
          trialEndsAt: profile.trialEndsAt,
        },
      }),
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/companies/export ──────────────────────────────────────────────────
// FIX 9: Full company data export for portability and backup.
// Returns: company profile, employees (without passwords), leads, audit trail.

router.get('/export', adminMiddleware, async (req, res, next) => {
  try {
    const { companyId } = req.user;
    if (!companyId) return res.status(400).json({ error: 'No company linked' });

    const TABLE = process.env.DYNAMODB_TABLE_METRICS;
    const EMP_TABLE = process.env.DYNAMODB_TABLE_EMPLOYEES;
    const AUDIT_TABLE = process.env.DYNAMODB_TABLE_AUDIT;

    // Company profile
    const profileResult = await dynamodb.get({
      TableName: EMP_TABLE,
      Key: { id: `COMPANY#${companyId}` },
    }).promise();
    const profile = profileResult.Item ?? null;

    // Employees (strip secrets)
    const empResult = await dynamodb.scan({
      TableName: EMP_TABLE,
      FilterExpression: 'companyId = :cid AND attribute_not_exists(#type)',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: { ':cid': companyId },
    }).promise();
    const employees = (empResult.Items ?? []).map(({ password, totpSecret, backupCodes, ...safe }) => safe);

    // Leads (METADATA records only — no chat history to keep export manageable)
    const leadResult = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta',
      ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA' },
    }).promise();
    const leads = leadResult.Items ?? [];

    // Audit logs (last 90 days)
    const startTime = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const auditResult = await dynamodb.scan({
      TableName: AUDIT_TABLE,
      FilterExpression: 'PK > :pk AND companyId = :cid',
      ExpressionAttributeValues: { ':pk': `audit#${startTime}`, ':cid': companyId },
    }).promise();

    await logAudit(req.user.id, 'export_company_data', companyId, 'success', req.ip, {
      employees: employees.length, leads: leads.length,
    }, companyId);

    const exportData = {
      exportedAt: new Date().toISOString(),
      exportedBy: req.user.email,
      companyId,
      profile,
      employees,
      leads,
      auditLogs: auditResult.Items ?? [],
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="apforce_export_${companyId}_${new Date().toISOString().split('T')[0]}.json"`);
    res.send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
