const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

function to10Digit(phone) {
  if (!phone) return '';
  const d = String(phone).replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

// Normalise a raw DDB lead record into the shared Contact shape
function normaliseLead(l) {
  return {
    id: l.leadId,
    type: 'lead',
    PK: l.PK,
    leadId: l.leadId ?? null,
    displayName: l.name ?? l.waName ?? l.phone ?? '',
    name: l.name ?? null,
    waName: l.waName ?? null,
    phone: l.phone ?? '',
    email: l.email ?? null,
    stage: l.stage ?? null,
    source: l.source ?? null,
    tags: l.tags ?? [],
    createdAt: l.createdAt ?? null,
    lastMessageAt: l.lastMessageAt ?? null,
    assignedTo: l.assignedTo ?? null,
    assignedToName: l.assignedToName ?? null,
    chatStatus: l.chatStatus ?? null,
    nameSource: l.nameSource ?? null,
  };
}

// Normalise a raw DDB INBOX# CONTACT record into the shared Contact shape
function normaliseInbox(u) {
  return {
    id: to10Digit(u.phone ?? ''),
    type: 'unknown',
    PK: u.PK,
    leadId: null,
    displayName: u.agentName ?? u.waName ?? u.phone ?? '',
    name: u.agentName ?? u.waName ?? null,
    waName: u.waName ?? null,
    phone: u.phone ?? '',
    email: null,
    stage: u.stage ?? null,
    source: u.source ?? 'whatsapp',
    tags: u.tags ?? [],
    createdAt: u.createdAt ?? null,
    lastMessageAt: u.lastMessageAt ?? null,
    assignedTo: null,
    assignedToName: null,
    chatStatus: 'unassigned',
    nameSource: u.nameSource ?? null,
  };
}

// ── GET /api/contacts ─────────────────────────────────────────────────────────
// Returns a unified, paginated list of all contacts (LEAD# + INBOX#).
// Query params: q, source, stage, page (1-based), pageSize (max 100)
router.get('/', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { q = '', source = '', stage = '', page = '1', pageSize = '50' } = req.query;

    // Full scan of LEAD# METADATA records for this company
    const leadItems = [];
    let lk1;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta',
        ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA' },
        ...(lk1 && { ExclusiveStartKey: lk1 }),
      }).promise();
      leadItems.push(...(r.Items ?? []));
      lk1 = r.LastEvaluatedKey;
    } while (lk1);

    // Full scan of INBOX# CONTACT records for this company
    const inboxItems = [];
    let lk2;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
        ExpressionAttributeValues: { ':prefix': `INBOX#${companyId}#`, ':sk': 'CONTACT' },
        ...(lk2 && { ExclusiveStartKey: lk2 }),
      }).promise();
      inboxItems.push(...(r.Items ?? []));
      lk2 = r.LastEvaluatedKey;
    } while (lk2);

    // Merge and normalise
    let contacts = [
      ...leadItems.map(normaliseLead),
      ...inboxItems.map(normaliseInbox),
    ];

    // Sort by most recent activity first
    contacts.sort((a, b) => {
      const tA = a.lastMessageAt ?? a.createdAt ?? '';
      const tB = b.lastMessageAt ?? b.createdAt ?? '';
      return tB < tA ? -1 : tB > tA ? 1 : 0;
    });

    // Text search: name, phone, email
    if (q) {
      const ql = q.toLowerCase();
      contacts = contacts.filter((c) =>
        (c.displayName).toLowerCase().includes(ql) ||
        (c.phone).includes(q) ||
        (c.email ?? '').toLowerCase().includes(ql)
      );
    }

    // Source filter
    if (source) contacts = contacts.filter((c) => c.source === source);

    // Stage filter
    if (stage) contacts = contacts.filter((c) => c.stage === stage);

    const total = contacts.length;
    const pg = Math.max(1, parseInt(page, 10));
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10)));
    const pages = Math.ceil(total / ps) || 1;
    const sliced = contacts.slice((pg - 1) * ps, pg * ps);

    res.json({ success: true, contacts: sliced, total, page: pg, pageSize: ps, pages });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/contacts/stage — set CRM stage for lead or unknown contact ────────
router.put('/stage', authMiddleware, async (req, res, next) => {
  try {
    const { leadId, phone, stage } = req.body;
    const companyId = req.user.companyId;
    if (!stage) return res.status(400).json({ error: 'stage required' });

    if (leadId) {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: `LEAD#${companyId}#${leadId}`, SK: 'METADATA' },
        UpdateExpression: 'SET stage = :s',
        ExpressionAttributeValues: { ':s': stage },
      }).promise();
    } else if (phone) {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: `INBOX#${companyId}#${to10Digit(phone)}`, SK: 'CONTACT' },
        UpdateExpression: 'SET stage = :s',
        ExpressionAttributeValues: { ':s': stage },
      }).promise();
    } else {
      return res.status(400).json({ error: 'leadId or phone required' });
    }

    res.json({ success: true, stage });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
