'use strict';

/**
 * Journey Platform — admin CRUD for Journey Definitions + read-only Instances.
 *
 * Mounted in app.js behind authMiddleware + subscriptionMiddleware (same shape
 * as automations/campaigns/api-keys). Role-gating matches forms.js:
 *   writes  → checkRole(['admin'])
 *   reads   → checkRole(['admin', 'manager'])
 *
 * Public / capability-URL routes are Task 7/8 — not registered here.
 */

const express = require('express');
const { z } = require('zod');
const { checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const { generateJourneyDefId } = require('../core/id');
const {
  journeyDefPK,
  journeyDefSK,
  journeyPK,
  journeyMetaSK,
  journeyRecordSK,
  journeysByCompanyGsiPK,
  GSI,
} = require('../core/entityKeys');
const { newMeta, updateMeta } = require('../core/systemMeta');

const router = express.Router();
const TABLE = () => process.env.DYNAMODB_TABLE_METRICS;

// ── Zod schemas (strict — unknown fields rejected) ───────────────────────────

const screenFieldSchema = z.object({
  id:       z.string().trim().min(1).max(80),
  label:    z.string().trim().min(1).max(200),
  type:     z.string().trim().min(1).max(40),
  required: z.boolean().optional(),
  options:  z.array(z.string().trim().min(1).max(200)).max(50).optional(),
}).strict();

const screenSchema = z.object({
  id:     z.string().trim().min(1).max(80),
  title:  z.string().trim().min(1).max(200),
  fields: z.array(screenFieldSchema).max(50).default([]),
}).strict();

const createDefSchema = z.object({
  name:             z.string().trim().min(1, 'name is required').max(200),
  industryPack:     z.string().trim().min(1).max(60).default('generic'),
  screens:          z.array(screenSchema).max(20).default([]),
  brandingConfig:   z.record(z.string(), z.unknown()).nullable().optional(),
  linkedWorkflowId: z.string().trim().min(1).max(80).nullable().optional(),
}).strict();

const updateDefSchema = z.object({
  name:             z.string().trim().min(1).max(200).optional(),
  industryPack:     z.string().trim().min(1).max(60).optional(),
  screens:          z.array(screenSchema).max(20).optional(),
  brandingConfig:   z.record(z.string(), z.unknown()).nullable().optional(),
  linkedWorkflowId: z.string().trim().min(1).max(80).nullable().optional(),
  active:           z.boolean().optional(),
}).strict().refine(
  (body) => Object.keys(body).length > 0,
  { message: 'At least one field is required' },
);

// ── POST /api/journeys/definitions ───────────────────────────────────────────
router.post('/definitions', checkRole(['admin']), async (req, res, next) => {
  try {
    const data = createDefSchema.parse(req.body);
    const companyId = req.user.companyId;
    const journeyDefId = generateJourneyDefId();
    const meta = newMeta(req.user.id);

    const item = {
      PK: journeyDefPK(companyId),
      SK: journeyDefSK(journeyDefId),
      id: journeyDefId,
      companyId,
      name: data.name,
      industryPack: data.industryPack,
      screens: data.screens,
      brandingConfig: data.brandingConfig ?? null,
      linkedWorkflowId: data.linkedWorkflowId ?? null,
      active: true,
      ...meta,
    };

    await dynamodb.put({ TableName: TABLE(), Item: item }).promise();
    res.status(201).json({ success: true, definition: item });
  } catch (err) { next(err); }
});

// ── GET /api/journeys/definitions ────────────────────────────────────────────
router.get('/definitions', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const result = await dynamodb.query({
      TableName: TABLE(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': journeyDefPK(companyId),
        ':sk': 'DEF#',
      },
    }).promise();

    const definitions = (result.Items ?? []).sort((a, b) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
    );
    res.json({ success: true, definitions });
  } catch (err) { next(err); }
});

// ── GET /api/journeys/definitions/:id ────────────────────────────────────────
router.get('/definitions/:id', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { Item } = await dynamodb.get({
      TableName: TABLE(),
      Key: { PK: journeyDefPK(companyId), SK: journeyDefSK(req.params.id) },
    }).promise();
    if (!Item) return res.status(404).json({ error: 'Journey definition not found' });
    res.json({ success: true, definition: Item });
  } catch (err) { next(err); }
});

// ── PUT /api/journeys/definitions/:id ────────────────────────────────────────
// No optimistic-lock ConditionExpression — admin edits aren't genuinely
// concurrent the way Task 2's engine writes are. Still advances version via
// updateMeta() so systemMeta conventions stay consistent.
router.put('/definitions/:id', checkRole(['admin']), async (req, res, next) => {
  try {
    const data = updateDefSchema.parse(req.body);
    const companyId = req.user.companyId;
    const key = { PK: journeyDefPK(companyId), SK: journeyDefSK(req.params.id) };

    const { Item: current } = await dynamodb.get({ TableName: TABLE(), Key: key }).promise();
    if (!current) return res.status(404).json({ error: 'Journey definition not found' });

    const meta = updateMeta(current, req.user.id);
    const names = { '#v': 'version' };
    const values = {
      ':ua': meta.updatedAt,
      ':ub': meta.updatedBy,
      ':nv': meta.version,
    };
    const sets = ['updatedAt = :ua', 'updatedBy = :ub', '#v = :nv'];

    if (data.name !== undefined) {
      names['#n'] = 'name';
      values[':n'] = data.name;
      sets.push('#n = :n');
    }
    if (data.industryPack !== undefined) {
      values[':ip'] = data.industryPack;
      sets.push('industryPack = :ip');
    }
    if (data.screens !== undefined) {
      values[':sc'] = data.screens;
      sets.push('screens = :sc');
    }
    if (data.brandingConfig !== undefined) {
      values[':bc'] = data.brandingConfig;
      sets.push('brandingConfig = :bc');
    }
    if (data.linkedWorkflowId !== undefined) {
      values[':lw'] = data.linkedWorkflowId;
      sets.push('linkedWorkflowId = :lw');
    }
    if (data.active !== undefined) {
      values[':a'] = data.active;
      sets.push('active = :a');
    }

    await dynamodb.update({
      TableName: TABLE(),
      Key: key,
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }).promise();

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/journeys/definitions/:id ─────────────────────────────────────
// Soft-delete only (active: false) — forms.js exact precedent. Never hard-delete;
// existing JOURNEY# instances may still reference this journeyDefId.
router.delete('/definitions/:id', checkRole(['admin']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const key = { PK: journeyDefPK(companyId), SK: journeyDefSK(req.params.id) };

    const { Item: current } = await dynamodb.get({ TableName: TABLE(), Key: key }).promise();
    if (!current) return res.status(404).json({ error: 'Journey definition not found' });

    const meta = updateMeta(current, req.user.id);
    await dynamodb.update({
      TableName: TABLE(),
      Key: key,
      UpdateExpression: 'SET active = :f, updatedAt = :ua, updatedBy = :ub, #v = :nv',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#v': 'version' },
      ExpressionAttributeValues: {
        ':f': false,
        ':ua': meta.updatedAt,
        ':ub': meta.updatedBy,
        ':nv': meta.version,
      },
    }).promise();

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/journeys/instances ──────────────────────────────────────────────
// Query JourneysByCompany GSI (never Scan). status / journeyDefId / date-range
// filters match crm.js + contacts.js: Query first, then in-memory filter.
router.get('/instances', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { status, journeyDefId, dateFrom, dateTo } = req.query;

    const items = [];
    let lastKey;
    do {
      const result = await dynamodb.query({
        TableName: TABLE(),
        IndexName: GSI.JOURNEYS_BY_COMPANY,
        KeyConditionExpression: 'journeysByCompanyGsiPK = :pk',
        ExpressionAttributeValues: {
          ':pk': journeysByCompanyGsiPK(companyId),
        },
        ScanIndexForward: false,
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }).promise();
      items.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    let instances = items.filter((i) => i.SK === 'META' || i.SK === journeyMetaSK());
    if (status) instances = instances.filter((i) => i.status === status);
    if (journeyDefId) instances = instances.filter((i) => i.journeyDefId === journeyDefId);
    if (dateFrom) instances = instances.filter((i) => i.createdAt && i.createdAt >= dateFrom);
    if (dateTo) {
      const endOfDay = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59.999Z`;
      instances = instances.filter((i) => i.createdAt && i.createdAt <= endOfDay);
    }

    res.json({ success: true, instances });
  } catch (err) { next(err); }
});

// ── GET /api/journeys/instances/:id ──────────────────────────────────────────
router.get('/instances/:id', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const pk = journeyPK(companyId, req.params.id);

    const [metaRes, recordRes] = await Promise.all([
      dynamodb.get({ TableName: TABLE(), Key: { PK: pk, SK: journeyMetaSK() } }).promise(),
      dynamodb.get({ TableName: TABLE(), Key: { PK: pk, SK: journeyRecordSK() } }).promise(),
    ]);

    if (!metaRes.Item) return res.status(404).json({ error: 'Journey instance not found' });

    res.json({
      success: true,
      instance: metaRes.Item,
      record: recordRes.Item ?? null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
