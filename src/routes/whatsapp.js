const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const { sendTextMessage } = require('../config/whatsapp');
const logger = require('../config/logger');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// ── GET /api/whatsapp/webhook — Meta webhook verification ─────────────────────
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }
  res.status(403).json({ error: 'Forbidden' });
});

// ── POST /api/whatsapp/webhook — receive incoming messages ────────────────────
router.post('/webhook', async (req, res) => {
  // Always ACK immediately so Meta doesn't retry
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    if (change?.field !== 'messages') return;

    const value = change.value;
    const messages = value?.messages ?? [];
    const companyId = process.env.META_WABA_ID; // used as fallback lookup key

    for (const msg of messages) {
      if (msg.type !== 'text') continue; // handle text only for now
      const fromPhone = msg.from;
      const text = msg.text?.body ?? '';
      const waMessageId = msg.id;
      const timestamp = new Date(Number(msg.timestamp) * 1000).toISOString();

      // Find lead by phone
      const scanResult = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta AND phone = :phone',
        ExpressionAttributeValues: {
          ':prefix': 'LEAD#',
          ':meta': 'METADATA',
          ':phone': fromPhone,
        },
        Limit: 1,
      }).promise();

      const lead = scanResult.Items?.[0];
      if (!lead) {
        logger.info(`Incoming WhatsApp from unknown number ${fromPhone} — no lead found`);
        continue;
      }

      const msgId = `MSG#${timestamp}#${waMessageId}`;
      await dynamodb.put({
        TableName: TABLE,
        Item: {
          PK: lead.PK,
          SK: msgId,
          messageId: waMessageId,
          direction: 'inbound',
          content: text,
          type: 'text',
          timestamp,
          waMessageId,
        },
        ConditionExpression: 'attribute_not_exists(SK)',
      }).promise().catch(() => {}); // idempotent
    }
  } catch (err) {
    logger.error('WhatsApp webhook processing error', err);
  }
});

// ── POST /api/whatsapp/send — send message to a lead ─────────────────────────
router.post('/send', authMiddleware, checkRole(['admin', 'manager', 'team_lead', 'telecaller', 'agent', 'intern']), async (req, res, next) => {
  try {
    const { leadPK, message } = req.body;
    if (!leadPK || !message?.trim()) {
      return res.status(400).json({ error: 'leadPK and message required' });
    }

    // Fetch lead
    const result = await dynamodb.get({ TableName: TABLE, Key: { PK: leadPK, SK: 'METADATA' } }).promise();
    const lead = result.Item;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Check company isolation
    if (lead.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Employee can only message their own leads
    const empRoles = ['telecaller', 'agent', 'intern'];
    if (empRoles.includes(req.user.role) && lead.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Not your lead' });
    }

    const waMessageId = await sendTextMessage(lead.phone, message.trim());
    const timestamp = new Date().toISOString();
    const msgId = `MSG#${timestamp}#${waMessageId ?? Date.now()}`;

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: leadPK,
        SK: msgId,
        messageId: waMessageId,
        direction: 'outbound',
        content: message.trim(),
        type: 'text',
        sentBy: req.user.id,
        sentByName: req.user.name,
        timestamp,
        waMessageId,
      },
    }).promise();

    res.json({ success: true, messageId: waMessageId, timestamp });
  } catch (err) {
    logger.error('whatsapp/send error', err);
    next(err);
  }
});

module.exports = router;
