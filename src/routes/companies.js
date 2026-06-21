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

    await logAudit(req.user.id, 'update_company_profile', companyId, 'success', req.ip, { updates: Object.keys(updates) });
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
      ProjectionExpression: 'plan, trialEndsAt, planStatus, companyName',
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

module.exports = router;
