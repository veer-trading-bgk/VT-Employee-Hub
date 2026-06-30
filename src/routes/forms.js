const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { getAutoAssignConfig, pickNextEmployee } = require('../utils/autoAssign');
const { to10Digit } = require('../utils/phone');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

function leadPK(companyId, leadId) { return `LEAD#${companyId}#${leadId}`; }

async function getPipelineStages(companyId) {
  try {
    const r = await dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#CRM#${companyId}`, SK: 'PIPELINE' } }).promise();
    return r.Item?.stages ?? [];
  } catch { return []; }
}

// ── GET /api/forms — list forms (admin) ──────────────────────────────────────
router.get('/', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `CONFIG#FORM#${req.user.companyId}`, ':sk': 'FORM#' },
    }).promise();
    res.json({ success: true, forms: (result.Items ?? []).sort((a, b) => b.createdAt?.localeCompare(a.createdAt)) });
  } catch (err) { next(err); }
});

// ── POST /api/forms — create form ─────────────────────────────────────────────
router.post('/', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { name, fields, defaultStage, defaultAssignedTo, defaultAssignedToName, source, redirectUrl, thankYouMessage } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const id = uuidv4();
    const now = new Date().toISOString();
    const item = {
      PK: `CONFIG#FORM#${req.user.companyId}`, SK: `FORM#${id}`,
      id, companyId: req.user.companyId,
      name: name.trim(),
      fields: fields ?? ['name', 'phone', 'email'],
      defaultStage: defaultStage ?? null,
      defaultAssignedTo: defaultAssignedTo ?? null,
      defaultAssignedToName: defaultAssignedToName ?? null,
      source: source ?? 'web_form',
      redirectUrl: redirectUrl?.trim() ?? null,
      thankYouMessage: thankYouMessage?.trim() ?? 'Thank you! We will contact you soon.',
      active: true,
      submissionCount: 0,
      createdBy: req.user.id,
      createdAt: now, updatedAt: now,
    };
    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.status(201).json({ success: true, form: item });
  } catch (err) { next(err); }
});

// ── GET /api/forms/:id — get single form (used by public form page) ───────────
router.get('/:id', async (req, res, next) => {
  try {
    const result = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND id = :id AND active = :true',
      ExpressionAttributeValues: {
        ':prefix': 'CONFIG#FORM#', ':sk': `FORM#${req.params.id}`,
        ':id': req.params.id, ':true': true,
      },
    }).promise();
    const form = result.Items?.[0];
    if (!form) return res.status(404).json({ error: 'Form not found' });
    res.json({ success: true, form: { id: form.id, name: form.name, fields: form.fields, thankYouMessage: form.thankYouMessage, redirectUrl: form.redirectUrl } });
  } catch (err) { next(err); }
});

// ── PUT /api/forms/:id — update form ─────────────────────────────────────────
router.put('/:id', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { name, fields, defaultStage, defaultAssignedTo, defaultAssignedToName, source, redirectUrl, thankYouMessage, active } = req.body;
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `CONFIG#FORM#${req.user.companyId}`, SK: `FORM#${req.params.id}` },
      UpdateExpression: 'SET #n = :n, fields = :f, defaultStage = :ds, defaultAssignedTo = :dat, defaultAssignedToName = :datn, #src = :src, redirectUrl = :ru, thankYouMessage = :ty, active = :a, updatedAt = :ua',
      ExpressionAttributeNames: { '#n': 'name', '#src': 'source' },
      ExpressionAttributeValues: {
        ':n': name?.trim(), ':f': fields ?? ['name', 'phone'],
        ':ds': defaultStage ?? null, ':dat': defaultAssignedTo ?? null, ':datn': defaultAssignedToName ?? null,
        ':src': source ?? 'web_form', ':ru': redirectUrl ?? null,
        ':ty': thankYouMessage ?? 'Thank you!', ':a': active !== false,
        ':ua': new Date().toISOString(),
      },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/forms/:id ─────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `CONFIG#FORM#${req.user.companyId}`, SK: `FORM#${req.params.id}` },
      UpdateExpression: 'SET active = :f, updatedAt = :ua',
      ExpressionAttributeValues: { ':f': false, ':ua': new Date().toISOString() },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/forms/:id/submit — PUBLIC, no auth ──────────────────────────────
router.post('/:id/submit', async (req, res, next) => {
  try {
    // Find the form (scan since we don't know companyId)
    const formResult = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'SK = :sk AND active = :true',
      ExpressionAttributeValues: { ':sk': `FORM#${req.params.id}`, ':true': true },
    }).promise();
    const form = formResult.Items?.[0];
    if (!form) return res.status(404).json({ error: 'Form not found' });

    const { name, phone, email, productInterest, notes } = req.body;
    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 7) return res.status(400).json({ error: 'Invalid phone number' });
    const normPhone = to10Digit(cleanPhone);

    const companyId = form.companyId;
    const stages = await getPipelineStages(companyId);
    const defaultStage = form.defaultStage ?? stages[0]?.key ?? 'new_lead';

    const leadId = uuidv4();
    const now = new Date().toISOString();

    // Auto-assign: use form's static assignee; fall back to auto-assign if none set
    let formAssignedTo   = form.defaultAssignedTo   ?? null;
    let formAssignedName = form.defaultAssignedToName ?? null;
    let wasAutoAssigned  = false;
    if (!formAssignedTo) {
      try {
        const cfg = await getAutoAssignConfig(companyId);
        if (cfg.enabled) {
          const picked = await pickNextEmployee(companyId, form.source ?? 'web_form', cfg);
          if (picked) { formAssignedTo = picked.id; formAssignedName = picked.name ?? null; wasAutoAssigned = true; }
        }
      } catch (e) { logger.warn('form auto-assign error: ' + e.message); }
    }

    const item = {
      PK: leadPK(companyId, leadId), SK: 'METADATA',
      leadId, companyId,
      name: name.trim(), phone: cleanPhone, phoneNorm: normPhone,
      email: email?.trim() ?? null,
      productInterest: Array.isArray(productInterest) ? productInterest : [],
      source: form.source ?? 'web_form',
      notes: notes?.trim() ?? '',
      stage: defaultStage,
      tags: [`form:${form.name}`],
      assignedTo: formAssignedTo,
      assignedToName: formAssignedName,
      autoAssigned: wasAutoAssigned,
      createdBy: 'form_submit',
      createdAt: now, updatedAt: now,
      convertedAt: null,
      formId: form.id,
    };

    // Dedup via company-phone-index GSI on phoneNorm — catches cross-format duplicates
    // (e.g. form submits 919866141993 but an existing lead is stored as 9866141993).
    const existing = await dynamodb.query({
      TableName: TABLE,
      IndexName: 'company-phone-index',
      KeyConditionExpression: 'companyId = :cid AND phoneNorm = :norm',
      FilterExpression: 'SK = :meta AND attribute_not_exists(deletedAt)',
      ExpressionAttributeValues: { ':cid': companyId, ':norm': normPhone, ':meta': 'METADATA' },
      Limit: 1,
    }).promise();
    if ((existing.Items?.length ?? 0) > 0) {
      return res.status(409).json({ error: 'This phone number is already in the system', duplicate: true });
    }

    await dynamodb.put({ TableName: TABLE, Item: item }).promise();

    // Increment form submission count
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: form.PK, SK: form.SK },
      UpdateExpression: 'SET submissionCount = if_not_exists(submissionCount, :z) + :inc',
      ExpressionAttributeValues: { ':z': 0, ':inc': 1 },
    }).promise().catch(() => {});

    // Fire automations
    try {
      const { runAutomations } = require('./automations');
      await runAutomations(companyId, 'lead_created', {
        leadId, leadPK: item.PK, phone: cleanPhone, name: name.trim(),
        source: form.source, stage: defaultStage, tags: item.tags,
        assignedTo: form.defaultAssignedTo,
      });
    } catch (e) { logger.warn('Form submit automation error: ' + e.message); }

    res.status(201).json({ success: true, thankYouMessage: form.thankYouMessage, redirectUrl: form.redirectUrl });
  } catch (err) { next(err); }
});

// ── GET /api/forms/meta-leads/webhook — Meta Lead Ads verification ────────────
router.get('/meta-leads/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_LEAD_WEBHOOK_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.status(403).end();
});

// ── POST /api/forms/meta-leads/webhook — Meta Lead Ads incoming leads ─────────
router.post('/meta-leads/webhook', async (req, res, next) => {
  res.sendStatus(200); // Always respond 200 immediately
  try {
    // Verify signature
    const secret = process.env.META_APP_SECRET;
    if (secret) {
      const sig = req.headers['x-hub-signature-256'];
      if (!sig) return;
      const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig !== expected) { logger.warn('Meta Lead Ads webhook signature mismatch'); return; }
    }

    const entries = req.body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'leadgen') continue;
        const lead = change.value;
        if (!lead?.leadgen_id) continue;

        // Map Meta fields to APForce fields
        const fields = {};
        for (const f of lead.field_data ?? []) {
          const key = f.name?.toLowerCase().replace(/\s+/g, '_');
          fields[key] = f.values?.[0] ?? '';
        }

        const name = fields.full_name || fields.first_name ? `${fields.first_name ?? ''} ${fields.last_name ?? ''}`.trim() : 'Meta Lead';
        const phone = String(fields.phone_number ?? fields.phone ?? '').replace(/\D/g, '');
        const email = fields.email ?? null;

        if (!phone || phone.length < 7) continue;
        const normPhone = to10Digit(phone);

        // Find companyId by page ID (scan CONFIG#FORM# items for meta_page_id match)
        const formScan = await dynamodb.scan({
          TableName: TABLE,
          FilterExpression: 'begins_with(PK, :prefix) AND begins_with(SK, :sk) AND meta_page_id = :pid AND active = :t',
          ExpressionAttributeValues: { ':prefix': 'CONFIG#FORM#', ':sk': 'FORM#', ':pid': entry.id, ':t': true },
        }).promise();

        const form = formScan.Items?.[0];
        if (!form) { logger.warn(`No form found for Meta page ${entry.id}`); continue; }

        const companyId = form.companyId;
        const stages = await getPipelineStages(companyId);
        const defaultStage = form.defaultStage ?? stages[0]?.key ?? 'new_lead';

        // Deduplicate via GSI on phoneNorm — O(1) and format-invariant
        const dupCheck = await dynamodb.query({
          TableName: TABLE,
          IndexName: 'company-phone-index',
          KeyConditionExpression: 'companyId = :cid AND phoneNorm = :norm',
          FilterExpression: 'SK = :meta AND attribute_not_exists(deletedAt)',
          ExpressionAttributeValues: { ':cid': companyId, ':norm': normPhone, ':meta': 'METADATA' },
          Limit: 1,
        }).promise();
        if ((dupCheck.Items?.length ?? 0) > 0) continue;

        const leadId = uuidv4();
        const now = new Date().toISOString();

        let metaAssignedTo   = form.defaultAssignedTo   ?? null;
        let metaAssignedName = form.defaultAssignedToName ?? null;
        let metaAutoAssigned = false;
        if (!metaAssignedTo) {
          try {
            const cfg = await getAutoAssignConfig(companyId);
            if (cfg.enabled) {
              const picked = await pickNextEmployee(companyId, 'meta_lead_ads', cfg);
              if (picked) { metaAssignedTo = picked.id; metaAssignedName = picked.name ?? null; metaAutoAssigned = true; }
            }
          } catch (e) { logger.warn('meta lead auto-assign error: ' + e.message); }
        }

        await dynamodb.put({
          TableName: TABLE,
          Item: {
            PK: leadPK(companyId, leadId), SK: 'METADATA',
            leadId, companyId, name, phone, phoneNorm: normPhone, email,
            productInterest: [], source: 'meta_lead_ads',
            notes: `Meta Lead Ads: leadgen_id=${lead.leadgen_id}`,
            stage: defaultStage, tags: ['meta-ads'],
            assignedTo: metaAssignedTo,
            assignedToName: metaAssignedName,
            autoAssigned: metaAutoAssigned,
            createdBy: 'meta_lead_ads', createdAt: now, updatedAt: now, convertedAt: null,
          },
        }).promise();

        const { runAutomations } = require('./automations');
        await runAutomations(companyId, 'lead_created', {
          leadId, leadPK: leadPK(companyId, leadId), phone, name,
          source: 'meta_lead_ads', stage: defaultStage, tags: ['meta-ads'],
        }).catch(() => {});

        logger.info(`Meta Lead Ad: created lead ${leadId} for company ${companyId}`);
      }
    }
  } catch (err) { logger.error('Meta leads webhook error', err.message); }
});

module.exports = router;
