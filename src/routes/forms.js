const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { verifyMetaWebhookSignature } = require('../utils/verifyMetaWebhookSignature');
const CIS = require('../services/CustomerIdentityService');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

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

    const companyId = form.companyId;

    // ADR-013: identity resolution, atomic phone locking, and dedup live in
    // CustomerIdentityService. No actorId in context — a public form has no
    // authenticated user, so CIS's fallback-to-actor auto-assign step correctly
    // never fires; the form's static assignee or its own auto-assign config
    // (keyed on the same `source`) resolves it exactly as before.
    const result = await CIS.resolveOrCreate(companyId, {
      phone: cleanPhone,
      name: name.trim(),
      email: email?.trim() ?? null,
      productInterest: Array.isArray(productInterest) ? productInterest : [],
      source: form.source ?? 'web_form',
      notes: notes?.trim() ?? '',
      stage: form.defaultStage ?? undefined,
      tags: [`form:${form.name}`],
      assignedTo: form.defaultAssignedTo ?? null,
      assignedToName: form.defaultAssignedToName ?? null,
      formId: form.id,
    }, {
      createdBy: 'form_submit',
    });

    // Public intake form keeps its existing "reject on duplicate" response — CIS still
    // ran its enrichment against the existing record, recording this as a real touch.
    if (result.existed) {
      return res.status(409).json({ error: 'This phone number is already in the system', duplicate: true });
    }

    const item = result.lead;

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
        leadId: item.leadId, leadPK: item.PK, phone: cleanPhone, name: name.trim(),
        source: form.source, stage: item.stage, tags: item.tags,
        assignedTo: item.assignedTo,
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
  // Verify BEFORE responding — fail closed with a real status code instead of accepting
  // (200) then silently dropping, so a genuine signature mismatch (e.g. a rotated
  // META_APP_SECRET not yet deployed) is visible in Meta's delivery log rather than hidden.
  if (!verifyMetaWebhookSignature(req)) {
    logger.warn('Meta Lead Ads webhook signature verification failed');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // Always respond 200 immediately once verified
  try {
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

        // Find companyId by page ID (scan CONFIG#FORM# items for meta_page_id match)
        const formScan = await dynamodb.scan({
          TableName: TABLE,
          FilterExpression: 'begins_with(PK, :prefix) AND begins_with(SK, :sk) AND meta_page_id = :pid AND active = :t',
          ExpressionAttributeValues: { ':prefix': 'CONFIG#FORM#', ':sk': 'FORM#', ':pid': entry.id, ':t': true },
        }).promise();

        const form = formScan.Items?.[0];
        if (!form) { logger.warn(`No form found for Meta page ${entry.id}`); continue; }

        const companyId = form.companyId;

        // ADR-013: identity resolution, atomic phone locking, and dedup live in
        // CustomerIdentityService. idempotencyKey is Meta's own leadgen_id — Meta does
        // retry webhook deliveries, and this ensures a redelivery of the same lead is
        // recognised as the same event rather than racing the dedup check again.
        const result = await CIS.resolveOrCreate(companyId, {
          phone,
          name,
          email,
          productInterest: [],
          source: 'meta_lead_ads',
          notes: `Meta Lead Ads: leadgen_id=${lead.leadgen_id}`,
          stage: form.defaultStage ?? undefined,
          tags: ['meta-ads'],
          assignedTo: form.defaultAssignedTo ?? null,
          assignedToName: form.defaultAssignedToName ?? null,
          idempotencyKey: `meta_lead_ads:${lead.leadgen_id}`,
        }, {
          createdBy: 'meta_lead_ads',
        });

        // A redelivered/duplicate leadgen_id enriches the existing record (recording
        // this as a real touch) rather than creating a duplicate — no automation fires
        // for it, matching the previous "skip on duplicate" behavior for lead_created.
        if (result.existed) continue;

        const item = result.lead;
        const { runAutomations } = require('./automations');
        await runAutomations(companyId, 'lead_created', {
          leadId: item.leadId, leadPK: item.PK, phone, name,
          source: 'meta_lead_ads', stage: item.stage, tags: item.tags,
          assignedTo: item.assignedTo,
        }).catch(() => {});

        logger.info(`Meta Lead Ad: created lead ${item.leadId} for company ${companyId}`);
      }
    }
  } catch (err) { logger.error('Meta leads webhook error', err.message); }
});

module.exports = router;
