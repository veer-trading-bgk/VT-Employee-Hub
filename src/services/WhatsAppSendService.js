'use strict';

/**
 * WhatsAppSendService — single authoritative engine for all outbound WhatsApp messages.
 *
 * Every APForce module (Inbox, Broadcast, Automation, Customer360, Campaigns, AI Agents)
 * MUST send through this service.  No module may implement its own Meta API call.
 *
 * Responsibilities:
 *  • Contact resolution    — leadPK / leadId / phone via company-phone-index GSI (O(1))
 *                            Falls back to INBOX# for unknown contacts.
 *  • RBAC enforcement      — restricted roles (telecaller/agent/intern) see only own leads
 *  • WABA config           — per-company credentials, per-company graph API version override
 *                            10-min in-process cache avoids N DDB reads in broadcast loops
 *  • E.164 normalisation   — Indian 10-digit numbers → 91XXXXXXXXXX
 *  • Meta API calls        — text, template, interactive, media (image/video/audio/document), location
 *  • DynamoDB writes       — message record + WAMID reverse-index + last-message update
 *  • ConversationService   — CONV# entity fire-and-forget sync (Phase 2 model)
 *  • Future stubs          — sendCatalog/Payment/Flow/Poll/Contact (all 501)
 */

const axios               = require('axios');
const S3                  = require('aws-sdk/clients/s3');
const dynamodb            = require('../config/dynamodb');
const logger              = require('../config/logger');
const { to10Digit }       = require('../utils/phone');
const ConversationService = require('./ConversationService');
const { updateLeadLastMessage } = require('../utils/updateLeadLastMessage');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0'}`;
const s3Client = new S3({ region: process.env.AWS_REGION ?? 'ap-south-1' });

// Roles whose send permission is limited to their own assigned leads
const RESTRICTED_ROLES = new Set(['telecaller', 'agent', 'intern']);

// In-process WABA config cache — prevents N uncached DDB reads in broadcast loops.
// Invalidated on disconnect/reconnect via invalidateConfigCache().
const _cfgCache  = new Map(); // companyId → { data, ts }
const CFG_TTL_MS = 10 * 60 * 1000; // 10 minutes

class WhatsAppSendService {

  // ── Internal helpers ──────────────────────────────────────────────────────

  _graphUrl(cfg) {
    return cfg?.graphApiVersion
      ? `https://graph.facebook.com/${cfg.graphApiVersion}`
      : GRAPH;
  }

  _toE164(phone) {
    const d = String(phone ?? '').replace(/\D/g, '');
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
    const hit = _cfgCache.get(companyId);
    if (hit && Date.now() - hit.ts < CFG_TTL_MS) return hit.data;
    const r = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
    }).promise();
    const data = r.Item ?? null;
    _cfgCache.set(companyId, { data, ts: Date.now() });
    return data;
  }

  /** Call when a company disconnects or reconnects WhatsApp so the cache is refreshed. */
  invalidateConfigCache(companyId) {
    _cfgCache.delete(companyId);
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

  /**
   * Substitutes an already-resolved params array into a template's raw BODY
   * component text (Meta's own {{1}}/{{2}}/... syntax) — the exact text this
   * customer actually received, not just the generic unsubstituted template.
   * A {{n}} with no corresponding param (index out of range) is left as-is
   * rather than blanked, same "visible leftover placeholder is safer than a
   * silent wrong guess" reasoning as welcomeVariables.js's unsupported-token
   * handling. Returns null when there's no BODY component with text — the
   * name-only {templateName, language} send path always hits this
   * (components: [] — see sendTemplate()), and any real template whose BODY
   * component is missing .text for some reason.
   */
  _resolveTemplateBody(components, bodyParams) {
    const bodyComp = (components ?? []).find((c) => c.type === 'BODY' && c.text);
    if (!bodyComp) return null;
    return bodyComp.text.replace(/\{\{(\d+)\}\}/g, (match, n) => {
      const idx = parseInt(n, 10) - 1;
      return bodyParams[idx] ?? match;
    });
  }

  /**
   * Cancels any pending "Delayed Response Message" wait for this contact —
   * called from all 4 send methods after a successful outbound send. Only
   * fires for a real human agent (user.id !== 'system'); a system-initiated
   * send (automation, welcome message, the delayed response itself once it
   * fires) must not cancel a still-pending timer for an unrelated reason.
   *
   * DelayedResponseService is required lazily, not at module load, because it
   * calls sendText() itself when a delayed response actually fires — a
   * top-level require in both directions would be circular. This mirrors the
   * existing lazy-require pattern whatsapp.js's webhook already uses for
   * AutomationEngine.resumeOnButtonReply().
   *
   * Fire-and-forget by design: never awaited by callers, never throws.
   */
  _fireDelayedResponseCancel(companyId, contact, user) {
    if (user.id === 'system') return;
    require('./DelayedResponseService').cancelPending(companyId, contact.phone).catch(() => {});
  }

  async _storeWamidLookup(wamid, pk, msgSK, companyId, extras = {}) {
    if (!wamid) return;
    try {
      await dynamodb.put({
        TableName: TABLE,
        Item: { PK: `WAMID#${wamid}`, SK: 'LOOKUP', leadPK: pk, msgSK, companyId, ...extras },
        ConditionExpression: 'attribute_not_exists(PK)',
      }).promise();
    } catch { /* ignore duplicate */ }
  }

  // ── Contact Resolution ────────────────────────────────────────────────────
  /**
   * Resolve a flexible target to { pk, phone, leadItem, isLead }.
   *
   * Target variants (evaluated in order):
   *   { resolvedContact }  — pre-resolved object; skips all lookups (for broadcast loops)
   *   { leadPK }          — point-read by full PK  (e.g. "LEAD#companyId#leadId")
   *   { leadId }          — construct PK from companyId + leadId, then point-read
   *   { phone }           — O(1) query on company-phone-index GSI (PK=companyId, SK=phoneNorm)
   *   { phoneNorm }       — alias for phone (same GSI path)
   *
   * phone/phoneNorm falls back to INBOX# unknown contact when no CRM lead matches.
   *
   * Future recipient types (customer groups, contact identifiers) can be added here
   * without changing any caller — callers just pass a new target shape.
   */
  async resolveContact(companyId, target) {
    if (target.resolvedContact) return target.resolvedContact;

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

    const rawPhone = target.phone ?? target.phoneNorm;
    if (rawPhone != null) {
      const phone   = String(rawPhone).replace(/\D/g, '');
      const phone10 = to10Digit(phone);

      // O(1) indexed lookup — replaces the previous full-table scan.
      // company-phone-index: PK=companyId (String), SK=phoneNorm (String, 10-digit canonical)
      const r = await dynamodb.query({
        TableName: TABLE,
        IndexName: 'company-phone-index',
        KeyConditionExpression: 'companyId = :cid AND phoneNorm = :norm',
        ExpressionAttributeValues: { ':cid': companyId, ':norm': phone10 },
        Limit: 1,
      }).promise();

      if (r.Items?.length) {
        const leadItem = r.Items[0];
        return { pk: leadItem.PK, phone: leadItem.phone ?? phone10, leadItem, isLead: true };
      }

      // No CRM lead found — use INBOX# unknown contact key
      return { pk: `INBOX#${companyId}#${phone}`, phone, leadItem: null, isLead: false };
    }

    throw this._err('leadPK, leadId, phone, or resolvedContact is required', 400);
  }

  // ── RBAC ─────────────────────────────────────────────────────────────────
  /**
   * Telecaller/agent/intern may only message leads assigned to them.
   * Unknown contacts (INBOX#) have no assignment concept — all roles may reach them.
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
   * Send a plain text message.
   *
   * @param {string}  companyId
   * @param {object}  target   — { leadPK?, leadId?, phone?, resolvedContact? }
   * @param {string}  message
   * @param {object}  user     — { id, role, name }
   * @param {object}  [options]
   * @param {string}  [options.replyToWaMessageId]
   * @param {string}  [options.replyToContent]
   * @param {string}  [options.replyToDirection]
   * @param {string}  [options.replyToSenderName]
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
        replyToWaMessageId: options.replyToWaMessageId,
        replyToContent:     options.replyToContent     ?? '',
        replyToDirection:   options.replyToDirection   ?? 'inbound',
        replyToSenderName:  options.replyToSenderName  ?? null,
      }),
    });

    await Promise.all([
      this._storeWamidLookup(waMessageId, contact.pk, msgSK, companyId),
      updateLeadLastMessage(contact.pk, message, 'outbound', ts, contact.isLead),
    ]);

    if (contact.leadItem?.convId) {
      ConversationService.updateLastMessage(companyId, contact.leadItem.convId, {
        text: message, timestamp: ts,
      }).catch(() => {});
    }

    this._fireDelayedResponseCancel(companyId, contact, user);

    return { waMessageId, timestamp: ts, pk: contact.pk, msgSK };
  }

  // ── sendTemplate ──────────────────────────────────────────────────────────
  /**
   * Send an approved WhatsApp template message.
   *
   * @param {string|object} templateRef
   *   string → templateId (fetches template from DDB; used by Inbox, Customer360)
   *   object → { templateName, language } (skips DDB lookup; used by Automation, welcome)
   *
   * @param {string[]}  variableValues  — ordered body {{n}} substitutions
   *
   * @param {object}  [options]
   * @param {string}  [options.headerVariableValue]  — TEXT header {{1}} value
   * @param {string}  [options.content]              — override content stored in DDB
   *                                                   (broadcast uses "[Broadcast: ...]")
   * @param {object}  [options.extraFields]          — merged into the DDB message item
   *                                                   (broadcast adds broadcastId, templateId)
   * @param {object}  [options.wamidExtras]          — merged into the WAMID lookup item
   *                                                   (broadcast adds broadcastId, broadcastSK)
   *
   * @returns {{ wamid, timestamp, pk, msgSK }}
   */
  async sendTemplate(companyId, target, templateRef, variableValues = [], user, options = {}) {
    const contact = await this.resolveContact(companyId, target);
    this._assertSendPermission(user, contact);
    const cfg = await this._requireConfig(companyId);

    // Resolve template — fetch from DDB when given an ID, use name directly otherwise
    let tmpl;
    if (typeof templateRef === 'string') {
      const r = await dynamodb.get({
        TableName: TABLE,
        Key: { PK: `CONFIG#TMPL#${companyId}`, SK: `TMPL#${templateRef}` },
      }).promise();
      tmpl = r.Item;
      if (!tmpl) throw this._err('Template not found', 404);
    } else {
      // { templateName, language } — name-only path for Automation / welcome messages
      tmpl = {
        templateName: templateRef.templateName,
        language:     templateRef.language ?? 'en',
        name:         templateRef.templateName,
        components:   [],
      };
    }

    const bodyParams = (variableValues ?? []).map(String);
    const components = [];

    // 2026-07-10 fix (docs/phase3/TECHNICAL_DEBT.md): this only ever handled
    // TEXT headers -- an approved template with an IMAGE/VIDEO/DOCUMENT
    // header (e.g. cdsl_invite_marketing, approved the same night) got NO
    // header component at all here, and Meta rejected the send outright:
    // "(#132012) ... header: Format mismatch, expected IMAGE, received
    // UNKNOWN". Confirmed via Meta's own docs (Media/Message API reference,
    // Media Card Carousel Templates) that a template header parameter at
    // SEND time needs a MediaObject ({id} or {link}) -- a DIFFERENT Meta API
    // concern from the Resumable Upload handle used once at template
    // CREATION time (uploadTemplateHeaderHandle(), ~24h validity, never
    // reused). Using `id` here, not `link`: Meta's regular /media-endpoint
    // media IDs are valid ~30 days and are the more reliable choice --
    // `link` sends are documented (real production reports, not just Meta's
    // docs) to intermittently fail with 429s because Meta proxies external
    // URL fetches and rate-limits by the HOSTING PROVIDER'S ASN, not per
    // WABA account.
    const headerComp = (tmpl.components ?? []).find((c) => c.type === 'HEADER');
    if (headerComp?.format === 'TEXT' && /\{\{1\}\}/.test(headerComp.text ?? '') && options.headerVariableValue != null) {
      components.push({ type: 'header', parameters: [{ type: 'text', text: String(options.headerVariableValue) }] });
    } else if (headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format)) {
      if (!tmpl.headerMediaRef?.s3Key) {
        // Fail fast with a clear, actionable message instead of letting Meta's
        // opaque "Format mismatch, expected X, received UNKNOWN" happen again --
        // this is the exact same underlying gap (no header sent at all), just
        // caught before the API call instead of surfaced as a Meta rejection.
        throw this._err(
          `Template "${tmpl.templateName}" has a ${headerComp.format} header but no stored media reference — re-upload its header image via the Templates editor`,
          500,
        );
      }
      const mediaType = headerComp.format.toLowerCase(); // 'image' | 'video' | 'document'
      const mediaId = await this.resolveMediaId(companyId, {
        s3Key: tmpl.headerMediaRef.s3Key,
        mimeType: tmpl.headerMediaRef.mimeType,
        filename: tmpl.headerMediaRef.filename,
        // s3Key doubles as resolveMediaId()'s dedup cache key here instead of
        // a real SHA-256 content hash -- it's already unique-per-asset
        // (uploads/{companyId}/{randomUUID()}.{ext}, per GET /upload-url) and
        // immutable for a given template, which is exactly what the cache key
        // needs to be. Avoids re-uploading the SAME header image to Meta on
        // every single send of a template that might go out to hundreds of
        // leads, and reuses resolveMediaId()'s existing 29-day MEDIACACHE#
        // mechanism unmodified rather than building a second cache.
        fileHash: tmpl.headerMediaRef.s3Key,
      });
      components.push({ type: 'header', parameters: [{ type: mediaType, [mediaType]: { id: mediaId } }] });
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
        template: { name: tmpl.templateName, language: { code: tmpl.language ?? 'en' }, components },
      },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } },
    );
    const wamid = apiRes.data?.messages?.[0]?.id ?? null;

    const ts      = new Date().toISOString();
    const msgSK   = `MSG#${ts}#${wamid ?? Date.now()}`;
    const content = options.content ?? `[Template: ${tmpl.name}]`;

    // resolvedBody is the actual text this customer received — the template's
    // real BODY component with {{n}} substituted from bodyParams, not just a
    // "[Template: name]" label. null when unavailable (the name-only
    // {templateName, language} path never has real component definitions —
    // see `components: []` above — and any template whose BODY component
    // lacks a .text). Deliberately a separate field from `content`, which
    // keeps its exact existing meaning (options.content's Automation/
    // Broadcast/Campaign tag, or the placeholder) unchanged — content is what
    // TemplateBubble's category-label regex parses; overloading it with real
    // prose would silently break that. Found + fixed 2026-07-09
    // (docs/phase3/TECHNICAL_DEBT.md).
    const resolvedBody = this._resolveTemplateBody(tmpl.components, bodyParams);

    await this._storeMessage(contact.pk, msgSK, {
      direction: 'outbound', content, type: 'template', resolvedBody,
      sentBy: user.id, sentByName: user.name ?? null,
      // Include templateId only when we resolved from DDB (we have the ID)
      ...(typeof templateRef === 'string' && { templateId: templateRef }),
      timestamp: ts, waMessageId: wamid, msgStatus: 'sent',
      ...(options.extraFields ?? {}),
    });

    await Promise.all([
      this._storeWamidLookup(wamid, contact.pk, msgSK, companyId, options.wamidExtras ?? {}),
      updateLeadLastMessage(contact.pk, content, 'outbound', ts, contact.isLead),
    ]);

    if (contact.leadItem?.convId) {
      ConversationService.updateLastMessage(companyId, contact.leadItem.convId, {
        text: content, timestamp: ts,
      }).catch(() => {});
    }

    this._fireDelayedResponseCancel(companyId, contact, user);

    return { wamid, timestamp: ts, pk: contact.pk, msgSK };
  }

  // ── sendInteractive ───────────────────────────────────────────────────────
  /**
   * Send a structured interactive message (list, reply buttons, CTA, etc.).
   * The `interactive` payload must conform to the Meta Interactive Message spec.
   *
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

    // interactiveType/interactiveAction persist the actual buttons/list-rows
    // sent to Meta (interactive.action, e.g. { buttons: [...] } or
    // { button, sections: [{ rows }] }) -- previously only body.text was
    // stored, so the Inbox had no way to show what was actually sent beyond
    // the message body (found 2026-07-09, docs/phase3/TECHNICAL_DEBT.md).
    // Purely additive: `content` is unchanged, existing readers of it
    // (last-message preview, ConversationService, older stored records with
    // neither new field) are unaffected.
    await this._storeMessage(contact.pk, msgSK, {
      direction: 'outbound', content: preview, type: 'interactive',
      interactiveType: interactive?.type ?? null,
      interactiveAction: interactive?.action ?? null,
      sentBy: user.id, sentByName: user.name ?? null,
      timestamp: ts, waMessageId: wamid, msgStatus: 'sent',
    });

    await Promise.all([
      this._storeWamidLookup(wamid, contact.pk, msgSK, companyId),
      updateLeadLastMessage(contact.pk, preview, 'outbound', ts, contact.isLead),
    ]);

    if (contact.leadItem?.convId) {
      ConversationService.updateLastMessage(companyId, contact.leadItem.convId, {
        text: preview, timestamp: ts,
      }).catch(() => {});
    }

    this._fireDelayedResponseCancel(companyId, contact, user);

    return { wamid, timestamp: ts, pk: contact.pk, msgSK };
  }

  // ── sendMedia ─────────────────────────────────────────────────────────────
  /**
   * Send a media message (image, video, audio, document, sticker).
   *
   * @param {object}  media
   * @param {string}  media.mediaType  — 'image' | 'video' | 'audio' | 'document' | 'sticker'
   * @param {string}  [media.mediaId]  — Meta media_id (pre-uploaded via /media endpoint)
   * @param {string}  [media.url]      — publicly accessible direct link (alternative to mediaId)
   * @param {string}  [media.caption]  — optional caption text
   * @param {string}  [media.filename] — shown for documents in WhatsApp UI
   * @param {string}  [media.mimeType] — MIME type for DDB record
   * @param {string}  [media.s3Key]    — S3 key for DDB record (enables presigned GET gallery)
   *
   * @returns {{ wamid, timestamp, pk, msgSK }}
   */
  async sendMedia(companyId, target, media, user) {
    const contact = await this.resolveContact(companyId, target);
    this._assertSendPermission(user, contact);
    const cfg = await this._requireConfig(companyId);

    const { mediaType, mediaId, url, caption, filename, mimeType, s3Key } = media;

    const mediaPayload = {};
    if (mediaId)  mediaPayload.id   = mediaId;
    else if (url) mediaPayload.link = url;
    if (caption)  mediaPayload.caption  = caption;
    if (filename && mediaType === 'document') mediaPayload.filename = filename;

    const apiRes = await axios.post(
      `${this._graphUrl(cfg)}/${cfg.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: this._toE164(contact.phone),
        type: mediaType,
        [mediaType]: mediaPayload,
      },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } },
    );
    const wamid    = apiRes.data?.messages?.[0]?.id ?? null;
    const ts       = new Date().toISOString();
    const msgSK    = `MSG#${ts}#${wamid ?? Date.now()}`;
    const preview  = caption ?? `[${mediaType}]`;

    await this._storeMessage(contact.pk, msgSK, {
      direction: 'outbound', type: mediaType, content: preview,
      ...(mediaId  && { mediaId }),
      ...(url      && { mediaUrl: url }),
      ...(s3Key    && { s3Key }),
      ...(filename && { filename }),
      ...(mimeType && { mimeType }),
      sentBy: user.id, sentByName: user.name ?? null,
      timestamp: ts, waMessageId: wamid, msgStatus: 'sent',
    });

    await Promise.all([
      this._storeWamidLookup(wamid, contact.pk, msgSK, companyId),
      updateLeadLastMessage(contact.pk, preview, 'outbound', ts, contact.isLead),
    ]);

    if (contact.leadItem?.convId) {
      ConversationService.updateLastMessage(companyId, contact.leadItem.convId, {
        text: preview, timestamp: ts,
      }).catch(() => {});
    }

    this._fireDelayedResponseCancel(companyId, contact, user);

    return { wamid, timestamp: ts, pk: contact.pk, msgSK };
  }

  // ── resolveMediaId ────────────────────────────────────────────────────────
  /**
   * Turns an S3-uploaded file into a Meta media_id, ready to pass as
   * sendMedia()'s media.mediaId. Extracted from whatsapp.js's POST /upload-send
   * route (which still owns the S3-key-scoping/auth checks and calls this for
   * the S3→Meta step) so a second caller — AutomationEngine's send_document
   * action, which has no lead/target to resolve at config time, only at
   * execution time — can reuse the exact same upload + 29-day dedup-cache
   * logic instead of duplicating it.
   *
   * @param {object} media
   * @param {string} media.s3Key     — must already be scoped/validated by the caller
   * @param {string} media.mimeType
   * @param {string} [media.filename]
   * @param {string} [media.fileHash] — sha256 hex; enables the MEDIACACHE dedup
   * @returns {Promise<string>} mediaId
   */
  async resolveMediaId(companyId, { s3Key, mimeType, filename, fileHash }) {
    const mediaBucket = process.env.WA_MEDIA_BUCKET;
    if (!mediaBucket) { const e = new Error('WA_MEDIA_BUCKET env var not set'); e.status = 500; throw e; }
    const cfg = await this._requireConfig(companyId);

    if (fileHash) {
      const cached = await dynamodb.get({
        TableName: TABLE,
        Key: { PK: `MEDIACACHE#${companyId}`, SK: fileHash },
      }).promise();
      if (cached.Item?.mediaId) {
        logger.info(`Media dedup hit: reusing mediaId ${cached.Item.mediaId}`);
        return cached.Item.mediaId;
      }
    }

    // Download from S3 (internal AWS network — fast, no Lambda payload limit)
    const s3Obj = await s3Client.getObject({ Bucket: mediaBucket, Key: s3Key }).promise();
    const safeFilename = filename ?? s3Key.split('/').pop() ?? 'file';

    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', mimeType);
    formData.append('file', new Blob([s3Obj.Body], { type: mimeType }), safeFilename);

    const uploadRes = await fetch(`${this._graphUrl(cfg)}/${cfg.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      body: formData,
    });
    if (!uploadRes.ok) {
      const errBody = await uploadRes.json().catch(() => ({}));
      logger.error('Meta media upload failed', errBody);
      const e = new Error('Media upload to Meta failed'); e.status = 400; e.details = errBody; throw e;
    }
    const { id: mediaId } = await uploadRes.json();
    if (!mediaId) { const e = new Error('Meta did not return a media_id'); e.status = 500; throw e; }

    // Cache for 29 days (Meta media_id valid 30 days)
    if (fileHash) {
      dynamodb.put({
        TableName: TABLE,
        Item: {
          PK: `MEDIACACHE#${companyId}`, SK: fileHash,
          mediaId, mimeType, filename: safeFilename,
          ttl: Math.floor(Date.now() / 1000) + 29 * 24 * 3600,
        },
      }).promise().catch(() => {});
    }

    return mediaId;
  }

  // ── uploadTemplateHeaderHandle ────────────────────────────────────────────
  /**
   * Turns an S3-uploaded file into a Meta Resumable-Upload asset handle,
   * ready to place at a template's HEADER component's example.header_handle.
   * A DIFFERENT Meta API surface from resolveMediaId()'s /media endpoint —
   * that one returns a message-send media_id (valid ~30 days, used to send a
   * message); this one returns a template-example handle (valid ~24 HOURS
   * per Meta's own docs, used only inside a POST /{waba-id}/message_templates
   * call). Called by POST /templates/:id/submit right before building the
   * Meta payload — NOT at draft-save time — specifically because of that
   * short lifetime: a handle resolved when a draft is saved would very
   * plausibly be expired by the time it's actually submitted (drafts
   * routinely sit for days; the template that surfaced this whole bug did).
   *
   * No dedup cache (unlike resolveMediaId()'s 29-day MEDIACACHE# pattern) —
   * a cache for a resource that expires in ~24h and is used once per submit
   * attempt has no real value.
   *
   * Two-step Resumable Upload flow (docs.developers.facebook.com/docs/
   * graph-api/guides/upload/ + .../templates/components/):
   *   1. POST /{app-id}/uploads?file_length&file_type&file_name&access_token
   *      (access_token as a QUERY param here) -> { id: "upload:<session>" }
   *   2. POST /{session_id} with header Authorization: OAuth {token} (NOT
   *      "Bearer" — every other Graph call in this file uses Bearer; this
   *      one is documented as OAuth specifically) + file_offset: 0 + raw
   *      bytes as the body -> { h: "<handle>" }
   *
   * @param {object} media
   * @param {string} media.s3Key     — must already be scoped/validated by the caller
   * @param {string} media.mimeType
   * @param {string} [media.filename]
   * @returns {Promise<string>} handle, e.g. "4::aW..."
   */
  async uploadTemplateHeaderHandle(companyId, { s3Key, mimeType, filename }) {
    const mediaBucket = process.env.WA_MEDIA_BUCKET;
    if (!mediaBucket) throw this._err('WA_MEDIA_BUCKET env var not set', 500);
    const appId = process.env.META_APP_ID;
    if (!appId) throw this._err('META_APP_ID env var not set', 500);
    const cfg = await this._requireConfig(companyId);

    // Download from S3 (internal AWS network — fast, no Lambda payload limit)
    const s3Obj = await s3Client.getObject({ Bucket: mediaBucket, Key: s3Key }).promise();
    const fileBytes = s3Obj.Body;
    const safeFilename = filename ?? s3Key.split('/').pop() ?? 'file';

    let sessionRes;
    try {
      sessionRes = await axios.post(`${this._graphUrl(cfg)}/${appId}/uploads`, null, {
        params: {
          file_length: fileBytes.length,
          file_type: mimeType,
          file_name: safeFilename,
          access_token: cfg.accessToken,
        },
      });
    } catch (e) {
      logger.error(
        `uploadTemplateHeaderHandle: session creation failed for s3Key=${s3Key} (status ${e.response?.status ?? 'n/a'})`,
        JSON.stringify(e.response?.data ?? { message: e.message }),
      );
      const err = this._err('Failed to start Meta upload session', e.response?.status ?? 502);
      err.details = e.response?.data;
      throw err;
    }
    const uploadSessionId = sessionRes.data?.id;
    if (!uploadSessionId) throw this._err('Meta did not return an upload session id', 500);

    let uploadRes;
    try {
      uploadRes = await axios.post(`${this._graphUrl(cfg)}/${uploadSessionId}`, fileBytes, {
        headers: {
          Authorization: `OAuth ${cfg.accessToken}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
      });
    } catch (e) {
      logger.error(
        `uploadTemplateHeaderHandle: byte upload failed for s3Key=${s3Key} (status ${e.response?.status ?? 'n/a'})`,
        JSON.stringify(e.response?.data ?? { message: e.message }),
      );
      const err = this._err('Failed to upload file to Meta', e.response?.status ?? 502);
      err.details = e.response?.data;
      throw err;
    }
    const handle = uploadRes.data?.h;
    if (!handle) throw this._err('Meta did not return an upload handle', 500);

    return handle;
  }

  // ── sendReadReceipt ──────────────────────────────────────────────────────
  /**
   * Send a read-receipt status update (blue ticks) for an inbound message.
   * Unlike the send* methods above, this has no DDB message record or WAMID
   * index to write — a read receipt is a status update against a message
   * already received, not a new message in its own right.
   *
   * @param {string}  companyId
   * @param {object}  target       — { leadPK?, leadId?, phone?, resolvedContact? }
   * @param {string}  waMessageId  — WAMID of the inbound message being marked read
   * @param {object}  user         — { id, role, name }
   * @returns {{ sent: boolean }}
   */
  async sendReadReceipt(companyId, target, waMessageId, user) {
    if (!waMessageId) return { sent: false };
    const contact = await this.resolveContact(companyId, target);
    this._assertSendPermission(user, contact);
    const cfg = await this._requireConfig(companyId);

    await axios.post(
      `${this._graphUrl(cfg)}/${cfg.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: waMessageId },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } },
    );
    return { sent: true };
  }

  // ── Future stubs ──────────────────────────────────────────────────────────
  // Each throws 501 until the backend is ready.
  // API surface is stable — callers can be wired up before implementation.

  // ── sendLocation ──────────────────────────────────────────────────────────
  /**
   * Send a static location pin (Item 1c — Send Location canvas node + Inbox
   * composer's own "Send Location" button both call this with a saved
   * CONFIG#BRANCH# office's coordinates).
   *
   * @param {object} location
   * @param {number}  location.latitude
   * @param {number}  location.longitude
   * @param {string}  [location.name]     — stored + shown in OUR OWN Inbox
   *                                         bubble only (see below) — never
   *                                         sent to Meta, see 2026-07-10 fix note
   * @param {string}  [location.address]  — same as name, Inbox-only
   *
   * @returns {{ wamid, timestamp, pk, msgSK }}
   */
  // 2026-07-10 (docs/phase3/TECHNICAL_DEBT.md): name/address used to be
  // forwarded to Meta's location message API too. Confirmed via a real A/B
  // send to a test number — with name/address, WhatsApp's client opens the
  // location as a text SEARCH on tap (many name matches, not the pin); with
  // ONLY latitude/longitude, it opens as an exact pin. This isn't about the
  // name's content (a short, clean name reproduced it identically to a
  // messy one) — Android's own geo: URI intent docs explain why: a label
  // requires the `q=` (search) form of the intent, whereas bare coordinates
  // use the direct "show a map here" form — so ANY non-empty name forces
  // search mode, regardless of what's in it. name/address are still fully
  // captured in `location` below and still stored via _storeMessage() +
  // rendered in the Inbox's own bubble (inbox/page.tsx's MessageBubble,
  // which reads message.location.name/.address from OUR stored record, not
  // from anything Meta echoes back) — this fix only removes them from the
  // outbound Graph API call, i.e. what the CUSTOMER's phone receives.
  async sendLocation(companyId, target, location, user) {
    const contact = await this.resolveContact(companyId, target);
    this._assertSendPermission(user, contact);
    const cfg = await this._requireConfig(companyId);

    const { latitude, longitude, name, address } = location;

    const apiRes = await axios.post(
      `${this._graphUrl(cfg)}/${cfg.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: this._toE164(contact.phone),
        type: 'location',
        location: { latitude, longitude }, // name/address deliberately omitted — see fix note above
      },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } },
    );
    const wamid = apiRes.data?.messages?.[0]?.id ?? null;
    const ts    = new Date().toISOString();
    const msgSK = `MSG#${ts}#${wamid ?? Date.now()}`;
    const preview = name ? `[Location: ${name}]` : '[Location]';

    await this._storeMessage(contact.pk, msgSK, {
      direction: 'outbound', type: 'location', content: preview,
      location: { latitude, longitude, name: name ?? null, address: address ?? null },
      sentBy: user.id, sentByName: user.name ?? null,
      timestamp: ts, waMessageId: wamid, msgStatus: 'sent',
    });

    await Promise.all([
      this._storeWamidLookup(wamid, contact.pk, msgSK, companyId),
      updateLeadLastMessage(contact.pk, preview, 'outbound', ts, contact.isLead),
    ]);

    if (contact.leadItem?.convId) {
      ConversationService.updateLastMessage(companyId, contact.leadItem.convId, {
        text: preview, timestamp: ts,
      }).catch(() => {});
    }

    this._fireDelayedResponseCancel(companyId, contact, user);

    return { wamid, timestamp: ts, pk: contact.pk, msgSK };
  }

  // ── Future stubs ──────────────────────────────────────────────────────────
  // Each throws 501 until the backend is ready.
  // API surface is stable — callers can be wired up before implementation.

  async sendCatalog()  { throw this._err('Catalog messages not yet implemented',      501); }
  async sendPayment()  { throw this._err('Payment messages not yet implemented',      501); }
  async sendFlow()     { throw this._err('Flow messages not yet implemented',         501); }
  async sendPoll()     { throw this._err('Poll messages not yet implemented',         501); }
  async sendContact()  { throw this._err('Contact card messages not yet implemented', 501); }
}

module.exports = new WhatsAppSendService();
