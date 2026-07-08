'use strict';

/**
 * conversationResolver — find-or-create CONV# entities for WhatsApp threads.
 *
 * This module bridges the existing LEAD# / INBOX# message storage (which stays
 * intact for backward compatibility) and the new V2 CONV# entity layer.
 *
 * All exported functions are fire-and-forget — they never throw. Callers
 * MUST append .catch(() => {}) or call without await. resolveForLead/
 * resolveForInbox resolve with { conversationId } on success (or undefined on
 * any internal failure) so a caller MAY chain further fire-and-forget work off
 * them via .then() — see whatsapp.js's webhook, which chains intent
 * classification this way. This is purely additive: the return value was
 * previously always undefined, so no existing caller's behavior changes.
 *
 * Data model after this commit:
 *   LEAD#${companyId}#${leadId}   METADATA  → convId, contactId fields added
 *   INBOX#${companyId}#${phone10} CONTACT   → convId, contactId fields added
 *
 * These pointer fields allow O(1) CONV# lookup on subsequent messages without
 * needing a GSI query.
 *
 * Cross-path dedup (2026-07-08, Era 41): resolveForInbox() and resolveForLead()
 * are called from two independent call stacks that can run concurrently for
 * the exact same contact — a first-ever WhatsApp message triggers
 * whatsapp.js's unknown-contact branch, which fires resolveForInbox()
 * fire-and-forget, then (if the auto-bot-engagement feature is on) awaits
 * ConversationalAgentService.maybeStart(), which independently promotes the
 * contact to a real lead and calls resolveForLead() — with neither function
 * aware of the other. Confirmed via a real production trace: both created
 * their own Conversation within ~500ms of each other, permanently splitting
 * one physical WhatsApp thread into two CONV# entities — the first message
 * lands in whichever one loses, and is never seen again once the UI follows
 * the other. `CONTACT#...META.primaryConversationId` (previously a dormant,
 * never-set field) is now the shared cross-path pointer both functions check
 * before creating a new Conversation, and race-safely claim if not yet set —
 * see _getPrimaryConversationId()/_claimPrimaryConversation() below.
 */

const dynamodb            = require('../config/dynamodb');
const logger              = require('../config/logger');
const ContactService      = require('../services/ContactService');
const ConversationService = require('../services/ConversationService');
const { contactPK, contactSK, conversationPK, conversationSK } = require('../core/entityKeys');

function table() { return process.env.DYNAMODB_TABLE_METRICS; }

// ─── Cross-path conversation dedup (Era 41) ───────────────────────────────────

/**
 * Read the Contact's shared conversation pointer, if any caller has already
 * claimed one for this contact.
 */
async function _getPrimaryConversationId(companyId, contactId) {
  const r = await dynamodb.get({
    TableName: table(),
    Key: { PK: contactPK(companyId, contactId), SK: contactSK() },
  }).promise();
  return r.Item?.primaryConversationId ?? null;
}

/**
 * Race-safe claim: try to write our own newly-created conversationId onto the
 * Contact's shared pointer, using the same if_not_exists() convention already
 * used for the INBOX#/LEAD# pointer writes below — but paired with
 * ReturnValues so we can tell, in the same round trip, whether OUR write
 * actually stuck or a concurrent caller's claim (from the other call stack)
 * got there first. Same loser-defers-to-winner shape as
 * CustomerIdentityService's LEAD_PHONE# lock race handling — attempt an
 * atomic conditional write, then whoever didn't win re-reads and defers to
 * whatever value actually stuck, instead of surfacing two divergent results.
 *
 * @returns {Promise<string>} the conversationId that actually won — our own,
 *   or a concurrent caller's if we lost the race.
 */
async function _claimPrimaryConversation(companyId, contactId, conversationId) {
  const r = await dynamodb.update({
    TableName: table(),
    Key: { PK: contactPK(companyId, contactId), SK: contactSK() },
    UpdateExpression:          'SET primaryConversationId = if_not_exists(primaryConversationId, :cv)',
    ExpressionAttributeValues: { ':cv': conversationId },
    ReturnValues:              'UPDATED_NEW',
  }).promise();
  return r.Attributes?.primaryConversationId ?? conversationId;
}

/**
 * We lost the race: the Conversation we just created was never seen by
 * anyone (created milliseconds ago, no messages/UI ever pointed at it) — hard
 * delete it rather than leaving it as a second, smaller version of the exact
 * orphan this fix exists to stop creating. Best-effort: a failure here is
 * logged and swallowed, never surfaces to the caller (matches this module's
 * fire-and-forget contract).
 */
async function _discardLosingConversation(companyId, conversationId) {
  await dynamodb.delete({
    TableName: table(),
    Key: { PK: conversationPK(companyId, conversationId), SK: conversationSK() },
  }).promise().catch((e) => logger.warn(`conversationResolver: failed to discard losing conversation ${conversationId}: ${e.message}`));
}

// ─── resolveForInbox ──────────────────────────────────────────────────────────

/**
 * Find-or-create a CONV# entity for an INBOX# (unknown-contact) thread.
 *
 * On first message:
 *   1. Find-or-create Contact via ContactService (phone dedup handled atomically)
 *   2. Create CONV# via ConversationService
 *   3. Write convId + contactId onto INBOX# CONTACT item (if_not_exists guards races)
 *
 * On subsequent messages:
 *   1. Read convId from INBOX# CONTACT item (fast O(1) GetItem)
 *   2. Update CONV# lastMessage + increment unread counter
 *
 * @param {string} companyId
 * @param {string} phone10    10-digit Indian phone (from to10Digit())
 * @param {object} opts
 *   @param {string}  opts.inboxPK   'INBOX#${companyId}#${phone10}'
 *   @param {string}  [opts.text]    message preview text
 *   @param {string}  [opts.timestamp] ISO 8601 timestamp
 *   @param {string}  [opts.waName]  WhatsApp display name (from contacts[].profile.name)
 * @returns {Promise<{conversationId: string}|undefined>}  — never throws; undefined on failure
 */
async function resolveForInbox(companyId, phone10, opts = {}) {
  const { inboxPK, text = '', timestamp, waName } = opts;
  try {
    // 1. Fast path — check for existing convId on CONTACT item
    const ci = await dynamodb.get({
      TableName: table(),
      Key: { PK: inboxPK, SK: 'CONTACT' },
    }).promise();
    const convId = ci.Item?.convId ?? null;

    if (convId) {
      // Conversation already exists — keep metadata fresh
      await ConversationService.updateLastMessage(companyId, convId, { text, timestamp });
      await ConversationService.incrementUnread(companyId, convId, 1);
      return { conversationId: convId };
    }

    // 2. Find-or-create Contact (ContactService handles phone normalisation and atomic dedup)
    const { contact } = await ContactService.createContact(companyId, {
      phone:       phone10,
      displayName: waName ?? phone10,
      source:      'whatsapp_inbound',
    }, 'system');

    // 2.5 (Era 41) — a sibling resolveForLead() call, running on a different
    // call stack for this exact contact (e.g. ConversationalAgentService's
    // auto-promotion path), may have already claimed a conversation. Reuse it
    // instead of creating a second one for the same physical thread.
    const existingConvId = await _getPrimaryConversationId(companyId, contact.contactId);
    if (existingConvId) {
      await ConversationService.updateLastMessage(companyId, existingConvId, { text, timestamp });
      await ConversationService.incrementUnread(companyId, existingConvId, 1);
      await dynamodb.update({
        TableName: table(),
        Key: { PK: inboxPK, SK: 'CONTACT' },
        UpdateExpression:          'SET convId = if_not_exists(convId, :cv), contactId = if_not_exists(contactId, :ctid)',
        ExpressionAttributeValues: { ':cv': existingConvId, ':ctid': contact.contactId },
      }).promise();
      logger.info(`conversationResolver: inbox reusing existing contact conversation conv=${existingConvId} contact=${contact.contactId} phone=${phone10} company=${companyId}`);
      return { conversationId: existingConvId };
    }

    // 3. Create Conversation linked to the Contact
    const conv = await ConversationService.createConversation(companyId, {
      contactId:      contact.contactId,
      channel:        'whatsapp',
      channelAddress: contact.phoneE164,
    }, 'system');

    // 3.5 (Era 41) — race-safe claim on the Contact's shared pointer. If a
    // concurrent resolveForLead() call claimed it first, defer to that one.
    const winningConvId = await _claimPrimaryConversation(companyId, contact.contactId, conv.conversationId);
    if (winningConvId !== conv.conversationId) {
      await _discardLosingConversation(companyId, conv.conversationId);
      await ConversationService.updateLastMessage(companyId, winningConvId, { text, timestamp });
      await ConversationService.incrementUnread(companyId, winningConvId, 1);
      logger.info(`conversationResolver: inbox lost conversation race — discarded ${conv.conversationId}, reusing ${winningConvId} contact=${contact.contactId} phone=${phone10} company=${companyId}`);
    } else {
      logger.info(`conversationResolver: inbox conv=${conv.conversationId} contact=${contact.contactId} phone=${phone10} company=${companyId}`);
    }

    // 4. Store pointers on CONTACT item — if_not_exists prevents duplicate writes
    //    under concurrent webhook delivery (Meta sometimes re-delivers within ms).
    await dynamodb.update({
      TableName: table(),
      Key: { PK: inboxPK, SK: 'CONTACT' },
      UpdateExpression:          'SET convId = if_not_exists(convId, :cv), contactId = if_not_exists(contactId, :ctid)',
      ExpressionAttributeValues: { ':cv': winningConvId, ':ctid': contact.contactId },
    }).promise();

    return { conversationId: winningConvId };
  } catch (err) {
    logger.warn(`conversationResolver.resolveForInbox failed [${companyId}/${phone10}]: ${err.message}`);
  }
}

// ─── resolveForLead ───────────────────────────────────────────────────────────

/**
 * Find-or-create a CONV# entity for a known lead's WhatsApp thread.
 *
 * On first message:
 *   1. GetItem on LEAD# METADATA (avoids GSI projection uncertainty)
 *   2. Look up existing Contact by phone; create if none found
 *   3. Create CONV# and write convId + contactId onto METADATA
 *
 * On subsequent messages:
 *   1. GetItem convId from METADATA
 *   2. Update CONV# lastMessage + increment unread counter
 *
 * @param {string} companyId
 * @param {string} leadPK     'LEAD#${companyId}#${leadId}'
 * @param {string} phone10    10-digit phone
 * @param {object} opts
 *   @param {string}  [opts.text]
 *   @param {string}  [opts.timestamp]
 * @returns {Promise<{conversationId: string}|undefined>}  — never throws; undefined on failure
 */
async function resolveForLead(companyId, leadPK, phone10, opts = {}) {
  const { text = '', timestamp } = opts;
  try {
    // 1. Always GetItem — don't rely on GSI projection completeness for new fields
    const meta = await dynamodb.get({
      TableName: table(),
      Key: { PK: leadPK, SK: 'METADATA' },
    }).promise();
    const convId = meta.Item?.convId ?? null;

    if (convId) {
      await ConversationService.updateLastMessage(companyId, convId, { text, timestamp });
      await ConversationService.incrementUnread(companyId, convId, 1);
      return { conversationId: convId };
    }

    // 2. Find existing Contact by phone (uses ContactPhoneIndex GSI from Commit 3)
    let contact = await ContactService.findContactByPhone(companyId, phone10);

    if (!contact) {
      // No Contact entity exists for this phone yet — create one from lead data
      const result = await ContactService.createContact(companyId, {
        phone:       phone10,
        displayName: meta.Item?.name ?? phone10,
        source:      'lead',
        sourceId:    meta.Item?.leadId ?? null,
      }, 'system');
      contact = result.contact;
    }

    // 2.5 (Era 41) — a sibling resolveForInbox() call, running on a different
    // call stack for this exact contact (e.g. the webhook's unknown-contact
    // branch, fired fire-and-forget before this lead-promotion path ran),
    // may have already claimed a conversation. Reuse it instead of creating
    // a second one for the same physical thread.
    const existingConvId = await _getPrimaryConversationId(companyId, contact.contactId);
    if (existingConvId) {
      await ConversationService.updateLastMessage(companyId, existingConvId, { text, timestamp });
      await ConversationService.incrementUnread(companyId, existingConvId, 1);
      await dynamodb.update({
        TableName: table(),
        Key: { PK: leadPK, SK: 'METADATA' },
        UpdateExpression:          'SET convId = if_not_exists(convId, :cv), contactId = if_not_exists(contactId, :ctid)',
        ExpressionAttributeValues: { ':cv': existingConvId, ':ctid': contact.contactId },
      }).promise();
      logger.info(`conversationResolver: lead reusing existing contact conversation conv=${existingConvId} contact=${contact.contactId} leadPK=${leadPK} company=${companyId}`);
      return { conversationId: existingConvId };
    }

    // 3. Create Conversation linked to the Contact
    const conv = await ConversationService.createConversation(companyId, {
      contactId:      contact.contactId,
      channel:        'whatsapp',
      channelAddress: contact.phoneE164,
    }, 'system');

    // 3.5 (Era 41) — race-safe claim on the Contact's shared pointer. If a
    // concurrent resolveForInbox() call claimed it first, defer to that one.
    const winningConvId = await _claimPrimaryConversation(companyId, contact.contactId, conv.conversationId);
    if (winningConvId !== conv.conversationId) {
      await _discardLosingConversation(companyId, conv.conversationId);
      await ConversationService.updateLastMessage(companyId, winningConvId, { text, timestamp });
      await ConversationService.incrementUnread(companyId, winningConvId, 1);
      logger.info(`conversationResolver: lead lost conversation race — discarded ${conv.conversationId}, reusing ${winningConvId} contact=${contact.contactId} leadPK=${leadPK} company=${companyId}`);
    } else {
      logger.info(`conversationResolver: lead conv=${conv.conversationId} contact=${contact.contactId} leadPK=${leadPK} company=${companyId}`);
    }

    // 4. Write pointers onto LEAD# METADATA
    await dynamodb.update({
      TableName: table(),
      Key: { PK: leadPK, SK: 'METADATA' },
      UpdateExpression:          'SET convId = if_not_exists(convId, :cv), contactId = if_not_exists(contactId, :ctid)',
      ExpressionAttributeValues: { ':cv': winningConvId, ':ctid': contact.contactId },
    }).promise();

    return { conversationId: winningConvId };
  } catch (err) {
    logger.warn(`conversationResolver.resolveForLead failed [${leadPK}]: ${err.message}`);
  }
}

// ─── syncConvStatus ───────────────────────────────────────────────────────────

/**
 * Mirror a lead chatStatus change onto the linked CONV# entity.
 * Called fire-and-forget from the resolve/reopen WhatsApp inbox routes.
 *
 * @param {string} companyId
 * @param {string} leadPK     'LEAD#${companyId}#${leadId}'
 * @param {string} newStatus  'resolved' | 'open'
 * @param {string} actorId    employeeId who triggered the action
 * @returns {Promise<void>}  — never throws
 */
async function syncConvStatus(companyId, leadPK, newStatus, actorId) {
  try {
    const meta = await dynamodb.get({
      TableName: table(),
      Key: { PK: leadPK, SK: 'METADATA' },
    }).promise();
    const convId = meta.Item?.convId ?? null;
    if (!convId) return; // CONV# not yet created — nothing to sync

    if (newStatus === 'resolved') {
      await ConversationService.resolveConversation(companyId, convId, actorId);
    } else if (newStatus === 'open') {
      await ConversationService.reopenConversation(companyId, convId, actorId);
    }
  } catch (err) {
    logger.warn(`conversationResolver.syncConvStatus failed [${leadPK} → ${newStatus}]: ${err.message}`);
  }
}

// ─── syncMarkRead ─────────────────────────────────────────────────────────────

/**
 * Mirror a mark-read action onto the linked CONV# entity (resets unreadCount to 0).
 * Called fire-and-forget from the mark-read WhatsApp inbox routes.
 *
 * @param {string} companyId
 * @param {object} keys     exactly one of: { leadPK } | { inboxPK }
 * @param {string} actorId
 * @returns {Promise<void>}  — never throws
 */
async function syncMarkRead(companyId, { leadPK, inboxPK } = {}, actorId) {
  try {
    let convId = null;
    if (leadPK) {
      const r = await dynamodb.get({ TableName: table(), Key: { PK: leadPK, SK: 'METADATA' } }).promise();
      convId = r.Item?.convId ?? null;
    } else if (inboxPK) {
      const r = await dynamodb.get({ TableName: table(), Key: { PK: inboxPK, SK: 'CONTACT' } }).promise();
      convId = r.Item?.convId ?? null;
    }
    if (convId) {
      await ConversationService.markRead(companyId, convId, actorId);
    }
  } catch (err) {
    logger.warn(`conversationResolver.syncMarkRead failed: ${err.message}`);
  }
}

module.exports = { resolveForInbox, resolveForLead, syncConvStatus, syncMarkRead };
