const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

function todayISO() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function parseMonth(raw) {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return raw;
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function attendancePK(companyId, userId) {
  return companyId ? `ATTENDANCE#${companyId}#${userId}` : `ATTENDANCE#${userId}`;
}

// ── POST /api/attendance/mark ──────────────────────────────────────────────────
// Idempotent — one mark per user per day. Auto-called on login.

router.post('/mark', authMiddleware, async (req, res, next) => {
  try {
    const date = req.body.date ?? todayISO();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const PK = attendancePK(req.user.companyId, req.user.id);
    const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: date } }).promise();

    if (existing.Item) {
      return res.json({ success: true, date, alreadyMarked: true, checkInTime: existing.Item.checkInTime });
    }

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK,
        SK: date,
        userId: req.user.id,
        companyId: req.user.companyId,
        date,
        month: date.slice(0, 7),
        checkInTime: new Date().toISOString(),
        source: req.body.source ?? 'manual',
      },
      ConditionExpression: 'attribute_not_exists(SK)',
    }).promise().catch((e) => {
      if (e.code !== 'ConditionalCheckFailedException') throw e;
    });

    res.status(201).json({ success: true, date, alreadyMarked: false });
  } catch (error) {
    logger.error('attendance/mark error', error);
    next(error);
  }
});

// ── GET /api/attendance/:userId ────────────────────────────────────────────────

router.get('/:userId', authMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (['telecaller', 'agent', 'intern'].includes(req.user.role) && req.user.id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const month = parseMonth(req.query.month);
    const PK = attendancePK(req.user.companyId, userId);

    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :month)',
      ExpressionAttributeValues: { ':pk': PK, ':month': month },
    }).promise();

    const records = result.Items ?? [];
    const [year, mo] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mo, 0).getDate();

    res.json({
      success: true,
      userId,
      month,
      daysPresent: records.length,
      daysInMonth,
      attendancePct: Math.round((records.length / daysInMonth) * 100),
      records: records.map((r) => ({ date: r.date, checkInTime: r.checkInTime, source: r.source })),
    });
  } catch (error) {
    logger.error('attendance/get error', error);
    next(error);
  }
});

// ── GET /api/attendance (admin — all employees for a month) ────────────────────

router.get('/', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const month = parseMonth(req.query.month);
    const [year, mo] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mo, 0).getDate();

    const pkPrefix = req.user.companyId ? `ATTENDANCE#${req.user.companyId}#` : 'ATTENDANCE#';
    const result = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND #mo = :month',
      ExpressionAttributeNames: { '#mo': 'month' },
      ExpressionAttributeValues: { ':prefix': pkPrefix, ':month': month },
    }).promise();

    const byUser = {};
    (result.Items ?? []).forEach((item) => {
      byUser[item.userId] = (byUser[item.userId] ?? 0) + 1;
    });

    const summary = Object.entries(byUser).map(([userId, daysPresent]) => ({
      userId,
      daysPresent,
      daysInMonth,
      attendancePct: Math.round((daysPresent / daysInMonth) * 100),
    })).sort((a, b) => b.daysPresent - a.daysPresent);

    res.json({ success: true, month, daysInMonth, summary });
  } catch (error) {
    logger.error('attendance/list error', error);
    next(error);
  }
});

module.exports = router;
