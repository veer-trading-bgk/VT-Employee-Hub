'use strict';

/**
 * WhatsAppSendService — centralized outbound WhatsApp messaging engine.
 *
 * ALL modules (Inbox, Broadcast, Automation, Customer360, AI Agents) must call
 * this service instead of implementing their own send logic.
 *
 * Responsibilities:
 *  • Contact resolution    — leadPK / leadId / phone (CRM lead → INBOX# fallback)
 *  • RBAC                  — "own leads only" enforcement for restricted roles
 *  • Config lookup         — per-company WABA credentials + graph API version
 *  • E.164 normalization   — Indian phone numbers (10-digit → 91XXXXXXXXXX)
 *  • Meta API calls        — text, template, interactive (others: future stubs)
 *  • DynamoDB writes       — message record + WAMID lookup + last-message update
 *  • ConversationService   — CONV# entity update (fire-and-forget, non-critical)
 *  • Error enrichment      — HTTP status codes on thrown errors
 */

const axios               = require('axios');
const dynamodb            = require('../config/dynamodb');
const logger              = require('../config/logger');
const { to10Digit }       = require('../utils/phone');
const ConversationService = require('./ConversationService');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0'}`;

// Roles whose send permission is limited to their own assigned leads
const RESTRICTED_ROLES = new Set(['telecaller', 'agent', 'intern']);

class WhatsAppSendService {

  // ── Internal helpers ──────────────────────────────────────────────────────

  _graphUrl(cfg) {
    return cfg?.graphApiVersion
      ? `https://graph.facebook.com/${cfg.graphApiVersion}`
      : GRAPH;
  }

  /** Strip non-digits and prepend India country code if needed. */
  _toE164(phone) {
    const d = String(phone).replace(/\D/g, '');
    if (d.length === 10) return '91' + d;
    if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1);
    return d;
  }

  _err(msg, status) {
    const e = new Error(msg);
    e.status = status;
    return e;
  }

  async _getConfig(companyId) {
    const r = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
    }).promise();
    return r.Item ?? null;
  }

  async _requireConfig(companyId) {
    const cfg = await this._getConfig(companyId);
    if (!cfg?.accessToken || !cfg?.phoneNumberId) {
      throw this._err('WhatsApp not configured for this account', 400);
    }
    return cfg;
  }

  async _storeMessage(pk, msgSK, fields) {
    await dynamodb.put({ TableName: TABLE, Item: { PK: pk, SK: msgSK, ...fields } }).promise();
  }

  async _storeWamidLookup(wamid, pk, msgSK, companyId) {
    if (!wamid) return;
    try {
      await dynamodb.put({
        TableName: TABLE,
        Item: { PK: `WAMID#${wamid}`, SK: 'LOOKUP', leadPK: pk, msgSK, companyId },
        ConditionExpression: 'attribute_not_exists(PK)',
      }).promise();
    } catch { /* ignore duplicate */ }
  }

  async _updateLastMessage(pk, content, direction, ts, isLead) {
    const preview = String(content).slice(0, 100);
    if (isLead) {
      let expr = 'SET lastMessageAt = :ts, lastMessagePreview = :prev, lastMessageDirection = :dir';
      const vals = { ':ts': ts, ':prev': preview, ':dir': direction };
      if (direction === 'inbound') {
        expr += ', lastInboundAt = :ts, unreadCount = if_not_exists(unreadCount, :zero) + :one';
        vals[':zero'] = 0;
        vals[':one'] = 1;
      }
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: pk, SK: 'METADATA' },
        UpdateExpression: expr,
        ExpressionAttributeValues: vals,
      }).promise().catch((e) => logger.warn('_updateLastMessage(lead) failed', e.message));
    } else {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: pk, SK: 'CONTACT' },
        UpdateExpression: 'SET lastMessageAt = :ts, lastMessagePreview = :prev, lastMessageDirection = :dir',
        ExpressionAttributeValues: { ':ts': ts, ':prev': preview, ':dir': direction },
      }).promise().catch((e) => logger.warn('_updateLastMessage(contact) failed', e.message));
    }
  }

  // ── Contact Resolution ────────────────────────────────────────────────────
  /**
   * Resolve a flexible target reference to a canonical contact record.
   *
   * Accepts:  { leadPK? }   — most specific (e.g. "LEAD#cid#lid")
   *           { leadId? }   — short ID; PK is constructed from companyId
   *           { phone? }    — scans for matching CRM lead, falls back to INBOX#
   *
   * Returns: { pk, phone, leadItem, isLead }
   */
  async resolveContact(companyId, target) {

    if (target.leadPK) {
      const r = await dynamodb.get({
        TableName: TABLE, Key: { PK: target.leadPK, SK: 'METADATA' },
      }).promise();
      const leadItem = r.Item;
      if (!leadItem) throw this._err('Lead not found', 404);
      if (leadItem.companyId !== companyId) throw this._err('Forbidden', 403);
      return { pk: target.leadPK, phone: leadItem.phone, leadItem, isLead: true };
    }

    if (target.leadId) {
      const pk = `LEAD#${companyId}#${target.leadId}`;
      const r  = await dynamodb.get({ TableName: TABLE, Key: { PK: pk, SK: 'METADATA' } }).promise();
      const leadItem = r.Item;
      if (!leadItem) throw this._err('Lead not found', 404);
      if (leadItem.companyId !== companyId) throw this._err('Forbidden', 403);
      return { pk, phone: leadItem.phone, leadItem, isLead: true };
    }

    if (target.phone) {
      const phone   = String(target.phone).replace(/\D/g, '');
      const phone10 = to10Digit(phone);

      // Best-effort: scan for an existing CRM lead with this phone.
      // INBOX# contacts are stored without a CRM lead record — the scan
      // ensures we use the lead PK if one exists (avoids duplicate message history).
      const items = [];
      let lastKey;
      do {
        const r = await dynamodb.scan({
          TableName: TABLE,
          FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND phone = :ph',
          ExpressionAttributeValues: {
            ':prefix': `LEAD#${companyId}#`,
            ':sk': 'METADATA',
            ':ph': phone10,
          },
          ...(lastKey && { ExclusiveStartKey: lastKey }),
        }).promise();
        items.push(...(r.Items ?? []));
        if (items.length) break; // found — no need to page further
        lastKey = r.LastEvaluatedKey;
      } while (lastKey);

      if (items.length) {
        const leadItem = items[0];
        return { pk: leadItem.PK, phone: leadItem.phone, leadItem, isLead: true };
      }

      // No CRM lead found — use INBOX# unknown contact
      return { pk: `INBOX#${companyId}#${phone}`, phone, leadItem: null, isLead: false };
    }

    throw this._err('leadPK, leadId, or phone is required', 400);
  }

  // ── RBAC ─────────────────────────────────────────────────────────────────
  /**
   * Checks whether the acting user may send to the resolved contact.
   * Restricted roles (telecaller / agent / intern) can only message their own leads.
   * They can always message unknown contacts (no assignment concept on INBOX#).
   */
  _assertSendPermission(user, contact) {
    if (
      RESTRICTED_ROLES.has(user.role) &&
      contact.isLead &&
      contact.leadItem?.assignedTo !== user.id
    ) {
      throw this._err('Not your lead', 403);
    }
  }

  // ── sendText ──────────────────────────────────────────────────────────────
  /**
   * Send a plain text message to a contact.
   *
   * @param {string} companyId
   * @param {{ leadPK?, leadId?, phone? }} target
   * @param {string} message
   * @param {{ id, role, name }} user  — acting user (RBAC + audit)
   * @param {{ replyToWaMessageId?, replyToContent?, replyToDirection?, replyToSenderName? }} [options]
   * @returns {{ waMessageId, timestamp, pk, msgSK }}
   */
  async sendText(companyId, target, message, user, options = {}) {
    const contact = await this.resolveContact(companyId, target);
    this._assertSendPermission(user, contact);

    const cfg = await this._requireConfig(companyId);
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this._toE164(contact.phone),
      type: 'text',
      text: { preview_url: false, body: message },
    };
    if (options.replyToWaMessageId) payload.context = { message_id: options.replyToWaMessageId };

    const apiRes = await axios.post(
      `${this._graphUrl(cfg)}/${cfg.phoneNumberId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } },
    );
    const waMessageId = apiRes.data?.messages?.[0]?.id ?? null;

    const ts    = new Date().toISOString();
    const msgSK = `MSG#${ts}#${waMessageId ?? Date.now()}`;

    await this._storeMessage(contact.pk, msgSK, {
      direction: 'outbound', content: message, type: 'text',
      sentBy: user.id, sentByName: user.name,
      timestamp: ts, waMessageId, msgStatus: 'sent',
      ...(options.replyToWaMessageId && {
        replyToWaMessageId:  options.replyToWaMessageId,
        replyToContent:      options.replyToContent      ?? '',
        replyToDirection:    options.replyToDirection    ?? 'inbound',
        replyToSenderName:   options.replyToSenderName   ?? null,
      }),
    });

    await Promise.all([
      this._storeWamidLookup(waMessageId, contact.pk, msgSK, companyId),
      this._updateLastMessage(contact.pk, message, 'outbound', ts, contact.isLead),
    ]);

    // Fire-and-forget: keep CONV# entity in sync (Phase 2 conversation model)
    if (contact.leadItem?.convId) {
      ConversationService.updateLastMessage(companyId, contact.leadItem.convId, {
        text: message, timestamp: ts,
      }).catch(() => {});
    }

    return { waMessageId, timestamp: ts, pk: contact.pk, msgSK };
  }

  // ── sendTemplate ──────────────────────────────────────────────────────────
  /**
   * Send an approved template message to a contact.
   * Resolves unknown contacts by phone — no prior CRM lead required.
   *
   * @param {string} companyId
   * @param {{ leadPK?, leadId?, phone? }} target
   * @param {string} templateId
   * @param {string[]} variableValues  — ordered variable substitutions
   * @param {{ id, role, name }} user
   * @returns {{ wamid, timestamp, pk, msgSK }}
   */
  /**
   * @param {string[]} variableValues  — ordered body {{n}} substitutions
   * @param {{ headerVariableValue?: string }} [options]
   */
  async sendTemplate(companyId, target, templateId, variableValues = [], user, options = {}) {
    const contact = await this.resolveContact(companyId, target);
    this._assertSendPermission(user, contact);

    const cfg = await this._requireConfig(companyId);

    const tmplRes = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${companyId}`, SK: `TMPL#${templateId}` },
    }).promise();
    const tmpl = tmplRes.Item;
    if (!tmpl) throw this._err('Template not found', 404);

    const bodyParams   = (variableValues ?? []).map(String);
    const components   = [];

    // Header variable support — TEXT header with {{1}}
    const headerComp = (tmpl.components ?? []).find(
      (c) => c.type === 'HEADER' && c.format === 'TEXT' && /\{\{1\}\}/.test(c.text ?? ''),
    );
    if (headerComp && options.headerVariableValue != null) {
      components.push({ type: 'header', parameters: [{ type: 'text', text: String(options.headerVariableValue) }] });
    }
    if (bodyParams.length) {
      components.push({ type: 'body', parameters: bodyParams.map((v) => ({ type: 'text', text: v })) });
    }

    const apiRes = await axios.post(
      `${this._graphUrl(cfg)}/${cfg.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: this._toE164(contact.phone),
        type: 'template',
        template: {
          name: tmpl.templateName,
          language: { code: tmpl.language ?? 'en' },
          components,
        },
      },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } },
    );
    const wamid = apiRes.data?.messages?.[0]?.id ?? null;

    const ts    = new Date().toISOString();
    const msgSK = `MSG#${ts}#${wamid ?? Date.now()}`;

    await this._storeMessage(contact.pk, msgSK, {
      direction: 'outbound', content: `[Template: ${tmpl.name}]`, type: 'template',
      sentBy: user.id, sentByName: user.name ?? null,
      templateId, timestamp: ts, waMessageId: wamid, msgStatus: 'sent',
    });

    await Promise.all([
      this._storeWamidLookup(wamid, contact.pk, msgSK, companyId),
      this._updateLastMessage(contact.pk, `[Template: ${tmpl.name}]`, 'outbound', ts, contact.isLead),
    ]);

    if (contact.leadItem?.convId) {
      ConversationService.updateLastMessage(companyId, contact.leadItem.convId, {
        text: `[Template: ${tmpl.name}]`, timestamp: ts,
      }).catch(() => {});
    }

    return { wamid, timestamp: ts, pk: contact.pk, msgSK };
  }

  // ── sendInteractive ───────────────────────────────────────────────────────
  /**
   * Send a structured interactive message (list, reply buttons, etc.).
   * The `interactive` payload must conform to the Meta Interactive Message spec.
   *
   * @param {string} companyId
   * @param {{ leadPK?, leadId?, phone? }} target
   * @param {object} interactive  — Meta interactive object
   * @param {{ id, role, name }} user
   * @returns {{ wamid, timestamp, pk, msgSK }}
   */
  async sendInteractive(companyId, target, interactive, user) {
    const contact = await this.resolveContact(companyId, target);
    this._assertSendPermission(user, contact);

    const cfg = await this._requireConfig(companyId);

    const apiRes = await axios.post(
      `${this._graphUrl(cfg)}/${cfg.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: this._toE164(contact.phone),
        type: 'interactive',
        interactive,
      },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } },
    );
    const wamid = apiRes.data?.messages?.[0]?.id ?? null;

    const ts      = new Date().toISOString();
    const msgSK   = `MSG#${ts}#${wamid ?? Date.now()}`;
    const preview = interactive?.body?.text ?? '[Interactive]';

    await this._storeMessage(contact.pk, msgSK, {
      direction: 'outbound', content: preview, type: 'interactive',
      sentBy: user.id, sentByName: user.name ?? null,
      timestamp: ts, waMessageId: wamid, msgStatus: 'sent',
    });

    await Promise.all([
      this._storeWamidLookup(wamid, contact.pk, msgSK, companyId),
      this._updateLastMessage(contact.pk, preview, 'outbound', ts, contact.isLead),
    ]);

    return { wamid, timestamp: ts, pk: contact.pk, msgSK };
  }

  // ── Future stubs ──────────────────────────────────────────────────────────
  // Each returns 501 until the backend implementation is ready.
  // Route handlers in whatsapp.js delegate here so the API surface is stable.

  async sendCatalog()  { throw this._err('Catalog messages not yet implemented',      501); }
  async sendPayment()  { throw this._err('Payment messages not yet implemented',      501); }
  async sendFlow()     { throw this._err('Flow messages not yet implemented',         501); }
  async sendPoll()     { throw this._err('Poll messages not yet implemented',         501); }
  async sendLocation() { throw this._err('Location messages not yet implemented',     501); }
  async sendContact()  { throw this._err('Contact card messages not yet implemented', 501); }
}

module.exports = new WhatsAppSendService();
