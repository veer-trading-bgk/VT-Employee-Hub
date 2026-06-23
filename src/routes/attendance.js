const express = require('express');
const { v4: uuidv4 } = require('uuid');
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

function leavePK(companyId, userId) {
  return `LEAVE#${companyId}#${userId}`;
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

// ── Leave routes — registered BEFORE /:userId to avoid param capture ───────────

// POST /api/attendance/leave — employee submits leave request
router.post('/leave', authMiddleware, async (req, res, next) => {
  try {
    const { startDate, endDate, reason, type } = req.body;
    if (!startDate || !endDate || !reason?.trim()) {
      return res.status(400).json({ error: 'startDate, endDate, reason are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ error: 'startDate cannot be after endDate' });
    }

    const leaveId = uuidv4();
    const now = new Date().toISOString();
    const item = {
      PK: leavePK(req.user.companyId, req.user.id),
      SK: `LEAVE#${leaveId}`,
      leaveId,
      userId: req.user.id,
      userName: req.user.name ?? null,
      userEmail: req.user.email ?? null,
      companyId: req.user.companyId,
      startDate,
      endDate,
      reason: reason.trim(),
      type: type ?? 'casual',
      status: 'pending',
      createdAt: now,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    };

    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.status(201).json({ success: true, leave: item });
  } catch (error) {
    logger.error('leave/post error', error);
    next(error);
  }
});

// GET /api/attendance/leave/admin — admin/manager gets all leave requests for the company
// Must be before GET /leave to avoid /:userId matching "leave/admin"
router.get('/leave/admin', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const pkPrefix = `LEAVE#${req.user.companyId}#`;
    const params = {
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':prefix': pkPrefix, ':sk': 'LEAVE#' },
    };
    const allItems = [];
    let lastKey;
    do {
      const result = await dynamodb.scan({ ...params, ...(lastKey && { ExclusiveStartKey: lastKey }) }).promise();
      allItems.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const status = req.query.status;
    const filtered = status ? allItems.filter((l) => l.status === status) : allItems;
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ success: true, leaves: filtered });
  } catch (error) {
    logger.error('leave/admin GET error', error);
    next(error);
  }
});

// GET /api/attendance/leave — employee's own leave history
// Must be before GET /:userId or "leave" would be treated as userId
router.get('/leave', authMiddleware, async (req, res, next) => {
  try {
    const PK = leavePK(req.user.companyId, req.user.id);
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': PK, ':prefix': 'LEAVE#' },
    }).promise();

    const leaves = (result.Items ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ success: true, leaves });
  } catch (error) {
    logger.error('leave/get error', error);
    next(error);
  }
});

// PUT /api/attendance/leave/:userId/:leaveId — admin/manager approves or rejects
router.put('/leave/:userId/:leaveId', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { userId, leaveId } = req.params;
    const { status, reviewNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved or rejected' });
    }

    const PK = leavePK(req.user.companyId, userId);
    const SK = `LEAVE#${leaveId}`;

    const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK } }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Leave request not found' });
    if (existing.Item.status !== 'pending') {
      return res.status(409).json({ error: 'Leave request already reviewed' });
    }

    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK },
      UpdateExpression: 'SET #s = :s, reviewedBy = :rb, reviewedAt = :ra, reviewNote = :rn',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': status,
        ':rb': req.user.id,
        ':ra': new Date().toISOString(),
        ':rn': reviewNote?.trim() ?? null,
      },
    }).promise();

    res.json({ success: true, status });
  } catch (error) {
    logger.error('leave/review error', error);
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
    const scanParams = {
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND #mo = :month',
      ExpressionAttributeNames: { '#mo': 'month' },
      ExpressionAttributeValues: { ':prefix': pkPrefix, ':month': month },
    };
    const allItems = [];
    let lastKey;
    do {
      const result = await dynamodb.scan({ ...scanParams, ...(lastKey && { ExclusiveStartKey: lastKey }) }).promise();
      allItems.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const byUser = {};
    allItems.forEach((item) => {
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
