const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();

const TABLE = process.env.DYNAMODB_TABLE_BADGES || 'vt-badges';
const TABLE_USERS = process.env.DYNAMODB_TABLE_USERS;

const POINT_VALUES = { kyc: 10, demat: 15, mf: 20, insurance: 5, algo: 8, coaching: 3 };
const WEEKEND_MULTIPLIER = 1.5;

// POST /api/points/award — award points for a metric entry
router.post('/award', authMiddleware, async (req, res, next) => {
  try {
    const { employeeId, metricType, quantity } = req.body;
    if (!employeeId || !metricType || !quantity) {
      return res.status(400).json({ error: 'employeeId, metricType, quantity required' });
    }

    const base = POINT_VALUES[metricType] ?? 0;
    const isWeekend = [0, 6].includes(new Date().getDay());
    const points = Math.round(base * quantity * (isWeekend ? WEEKEND_MULTIPLIER : 1));
    if (points === 0) return res.json({ success: true, pointsAwarded: 0 });

    // Store per-day points record
    const today = new Date().toISOString().split('T')[0];
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `POINTS#${employeeId}`,
        SK: `${today}#${metricType}#${Date.now()}`,
        points,
        metricType,
        date: today,
        earnedAt: new Date().toISOString(),
      },
    }).promise();

    // Update running total (upsert)
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `POINTS#${employeeId}`, SK: 'TOTAL' },
      UpdateExpression: 'ADD #t :p SET userId = :uid',
      ExpressionAttributeNames: { '#t': 'total' },
      ExpressionAttributeValues: { ':p': points, ':uid': employeeId },
    }).promise();

    res.json({ success: true, pointsAwarded: points });
  } catch (error) {
    logger.error('points/award error', error);
    next(error);
  }
});

// GET /api/points/leaderboard — top 50 by total points
router.get('/leaderboard', authMiddleware, async (req, res, next) => {
  try {
    const result = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'TOTAL' },
    }).promise();

    const rows = (result.Items ?? [])
      .filter((item) => item.PK?.startsWith('POINTS#'))
      .map((item) => ({ userId: item.userId ?? item.PK.replace('POINTS#', ''), total: item.total ?? 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 50);

    // Enrich with name/email from employees table (best-effort)
    const enriched = await Promise.all(
      rows.map(async (row, i) => {
        let email = row.userId;
        let name = row.userId;
        try {
          const u = await dynamodb.get({
            TableName: TABLE_USERS,
            Key: { id: row.userId },
          }).promise();
          if (u.Item?.email) email = u.Item.email;
          if (u.Item?.name) name = u.Item.name;
        } catch {}
        return { rank: i + 1, name, email, totalPoints: row.total, badgeCount: 0 };
      })
    );

    res.json({ data: enriched });
  } catch (error) {
    logger.error('points/leaderboard error', error);
    next(error);
  }
});

// GET /api/points/my — my points total
router.get('/my', authMiddleware, async (req, res, next) => {
  try {
    const result = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `POINTS#${req.user.id}`, SK: 'TOTAL' },
    }).promise();
    res.json({ totalPoints: result.Item?.total ?? 0 });
  } catch (error) {
    logger.error('points/my error', error);
    next(error);
  }
});

module.exports = router;
