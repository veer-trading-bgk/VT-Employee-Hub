const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();

const TABLE = process.env.DYNAMODB_TABLE_BADGES || 'vt-badges';
const TABLE_METRICS = process.env.DYNAMODB_TABLE_METRICS;

// Badge definitions — evaluated server-side each check
const BADGE_DEFS = [
  { id: 'kyc_bronze', name: '🥉 KYC Bronze', icon: '🥉', description: '30 KYC in a month', metric: 'kyc', threshold: 30 },
  { id: 'kyc_silver', name: '🥈 KYC Silver', icon: '🥈', description: '40 KYC in a month', metric: 'kyc', threshold: 40 },
  { id: 'kyc_gold',   name: '🥇 KYC Gold',   icon: '🥇', description: '50 KYC in a month', metric: 'kyc', threshold: 50 },
  { id: 'demat_star', name: '⭐ Demat Star',  icon: '⭐', description: '30 Demat in a month', metric: 'demat', threshold: 30 },
  { id: 'mf_rocket',  name: '🚀 MF Rocket',  icon: '🚀', description: '20 MF orders in a month', metric: 'mf', threshold: 20 },
  { id: 'ins_ace',    name: '💎 Insurance Ace', icon: '💎', description: '₹5L insurance in a month', metric: 'insurance', threshold: 500000 },
];

// GET /api/badges/user/:userId — earned badges + progress on locked
router.get('/user/:userId', authMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const month = new Date().toISOString().slice(0, 7);

    // Earned badges
    const earnedResult = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `BADGE#${userId}` },
    }).promise().catch(() => ({ Items: [] }));

    const earnedIds = new Set((earnedResult.Items ?? []).map((i) => i.badgeId));

    // Monthly metric totals for progress
    const metricsResult = await dynamodb.scan({
      TableName: TABLE_METRICS,
      FilterExpression: 'userId = :uid AND begins_with(#date, :month)',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: { ':uid': userId, ':month': month },
    }).promise().catch(() => ({ Items: [] }));

    const totals = {};
    (metricsResult.Items ?? []).forEach((item) => {
      totals[item.metric_type] = (totals[item.metric_type] ?? 0) + (item.value ?? 0);
    });

    // Points total
    const pointsResult = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `POINTS#${userId}`, SK: 'TOTAL' },
    }).promise().catch(() => ({ Item: null }));
    const totalPoints = pointsResult.Item?.total ?? 0;

    const earned = [];
    const progress = [];

    for (const def of BADGE_DEFS) {
      const metricVal = totals[def.metric] ?? 0;
      if (earnedIds.has(def.id)) {
        const item = (earnedResult.Items ?? []).find((i) => i.badgeId === def.id);
        earned.push({ id: def.id, name: def.name, icon: def.icon, description: def.description, earnedAt: item?.earnedAt });
      } else {
        progress.push({ id: def.id, name: def.name, icon: def.icon, description: def.description, progress: Math.round(metricVal), requirement: def.threshold });
      }
    }

    res.json({ earned, progress, totalPoints });
  } catch (error) {
    logger.error('badges/user error', error);
    next(error);
  }
});

// POST /api/badges/check — called after metric submission to award new badges
router.post('/check', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const month = new Date().toISOString().slice(0, 7);

    // Get monthly totals
    const metricsResult = await dynamodb.scan({
      TableName: TABLE_METRICS,
      FilterExpression: 'userId = :uid AND begins_with(#date, :month)',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: { ':uid': userId, ':month': month },
    }).promise();

    const totals = {};
    (metricsResult.Items ?? []).forEach((item) => {
      totals[item.metric_type] = (totals[item.metric_type] ?? 0) + (item.value ?? 0);
    });

    // Existing badges
    const existingResult = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `BADGE#${userId}` },
    }).promise().catch(() => ({ Items: [] }));
    const existingIds = new Set((existingResult.Items ?? []).map((i) => i.badgeId));

    const newlyEarned = [];
    for (const def of BADGE_DEFS) {
      if (existingIds.has(def.id)) continue;
      if ((totals[def.metric] ?? 0) >= def.threshold) {
        await dynamodb.put({
          TableName: TABLE,
          Item: {
            PK: `BADGE#${userId}`,
            SK: def.id,
            badgeId: def.id,
            userId,
            name: def.name,
            icon: def.icon,
            earnedAt: new Date().toISOString(),
          },
        }).promise();
        newlyEarned.push(def);
      }
    }

    res.json({ newlyEarned });
  } catch (error) {
    logger.error('badges/check error', error);
    next(error);
  }
});

module.exports = router;
