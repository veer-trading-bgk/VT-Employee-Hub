'use strict';

const repo                             = require('../repositories/ConversationRepository');
const { publishEvent }                 = require('../events/publisher');
const { E, ENTITY }                    = require('../events/catalog');
const { generateConversationId }       = require('../core/id');
const { newMeta, updateMeta, softDeleteMeta, restoreMeta } = require('../core/systemMeta');
const { convCompanyGsiPK, convContactGsiPK } = require('../core/entityKeys');

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS = Object.freeze({
  OPEN:     'open',
  RESOLVED: 'resolved',
  PENDING:  'pending',
  SNOOZED:  'snoozed',
});

// Reserved for Phase 2 AI/automation — determines how this conversation is classified
// and whether it appears in agent queues, broadcast reply threads, or internal channels.
const CONVERSATION_TYPE = Object.freeze({
  CUSTOMER:  'customer',   // default — direct customer-facing thread
  INTERNAL:  'internal',   // team-internal discussion (not visible to customer)
  GROUP:     'group',      // group/community chat
  BROADCAST: 'broadcast',  // reply thread from a broadcast message
  BOT:       'bot',        // fully bot-managed conversation
  SYSTEM:    'system',     // system-generated (automated notifications)
});

// Reserved for Phase 2 AI handoff state machine.
// Tracks who is "in control" of the conversation response at any point in time.
const HANDOFF_STATE = Object.freeze({
  HUMAN:         'human',          // default — agent is handling
  AI:            'ai',             // AI bot is handling, no agent needed
  PENDING_HUMAN: 'pending_human',  // AI flagged, waiting for agent to accept
  AI_RESUMED:    'ai_resumed',     // agent returned control to AI
});

const VALID_CHANNELS = Object.freeze(['whatsapp', 'email', 'sms', 'telegram', 'instagram']);

// Maximum characters stored in the last-message preview field.
const PREVIEW_MAX_CHARS = 200;

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Fetch conversation and validate it exists and is not deleted.
 * Throws 'not_found' on failure — keeps public methods concise.
 */
async function _require(companyId, conversationId) {
  const item = await repo.getById(companyId, conversationId);
  if (!item || item.deletedAt) throw new Error('not_found');
  return item;
}

/**
 * Apply a status change with optional extra patch fields.
 * Always uses optimistic locking via the current version.
 */
async function _setStatus(companyId, conversationId, newStatus, actorId, extraPatch = {}) {
  const current = await _require(companyId, conversationId);
  const patch   = { status: newStatus, ...extraPatch, ...updateMeta(current, actorId) };
  return repo.updateItem(companyId, conversationId, patch, current.version);
}

/**
 * Build the additionalEntities fan-out target for the contact timeline.
 * Keeps all conversation events visible in the Contact 360 view.
 */
function _contactTarget(contactId) {
  return contactId ? [{ entityType: ENTITY.CONTACT, entityId: contactId }] : [];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new conversation linked to an existing contact.
 *
 * Each call creates a distinct conversation even if one already exists for the same
 * contact + channel. The WhatsApp webhook (Commit 9) will contain the "find or create"
 * business logic that decides when to reuse vs. open a fresh conversation.
 *
 * @param {string} companyId
 * @param {object} data
 *   @param {string}  data.contactId       required — CONTACT# entity ID
 *   @param {string}  data.channel         required — 'whatsapp' | 'email' | 'sms' | 'telegram' | 'instagram'
 *   @param {string}  [data.channelAddress] E.164 for phone channels; email address for email
 *   @param {string}  [data.assignedTo]    initial assignee employeeId
 *   @param {string}  [data.assignedToName]
 * @param {string}  [actorId='system']
 * @returns {object} created conversation item
 * @throws {Error} 'companyId is required' | 'contactId is required' | 'invalid_channel'
 */
async function createConversation(companyId, data, actorId = 'system') {
  if (!companyId)      throw new Error('companyId is required');
  if (!data?.contactId) throw new Error('contactId is required');
  if (!VALID_CHANNELS.includes(data.channel)) throw new Error('invalid_channel');

  const conversationId = generateConversationId();
  const meta           = newMeta(actorId);

  const item = {
    // DynamoDB keys
    PK: `CONV#${companyId}#${conversationId}`,
    SK: 'CONV#META',

    // Entity identity
    conversationId,
    companyId,

    // Contact link
    contactId: data.contactId,

    // Channel
    channel:        data.channel,
    channelAddress: data.channelAddress ?? null,

    // Status
    status: STATUS.OPEN,

    // Assignment
    assignedTo:     data.assignedTo     ?? null,
    assignedToName: data.assignedToName ?? null,

    // Activity tracking
    lastMessageAt:   null,
    lastMessageText: null,
    lastActivityAt:  meta.createdAt,  // GSI SK — kept current on every activity
    unreadCount:     0,

    // GSI attributes (dedicated prefixes, no collision with leadsByCompany)
    convCompanyPK: convCompanyGsiPK(companyId),
    convContactPK: convContactGsiPK(companyId, data.contactId),

    // ── Reserved AI / workflow fields (Phase 2/3) ─────────────────────────────
    // Populated by AI classification pipeline, never by this service directly.
    purpose:      null,  // 'support' | 'sales' | 'onboarding' | 'complaint'
    intent:       null,  // AI-detected intent string
    confidence:   null,  // float 0.0–1.0 — AI classification confidence
    classifiedAt: null,  // ISO timestamp of last AI classification
    priority:     null,  // 'urgent' | 'high' | 'medium' | 'low'
    labels:       [],    // string[] — agent or AI labels
    sla:          null,  // { dueAt, breachedAt, status } — Phase 2 SLA engine
    aiSummary:    null,  // AI-generated conversation summary
    waitingSince: null,  // ISO timestamp — set when status → pending

    // ── Bot / AI control fields (Phase 2) ────────────────────────────────────
    conversationType: data.conversationType ?? CONVERSATION_TYPE.CUSTOMER,
    isBotActive:      data.isBotActive      ?? false,
    handoffState:     data.handoffState     ?? HANDOFF_STATE.HUMAN,
    // ─────────────────────────────────────────────────────────────────────────

    // System metadata
    ...meta,
  };

  await repo.putConversation(item);

  publishEvent(E.CONVERSATION_CREATED, {
    companyId,
    entityType:         ENTITY.CONV,
    entityId:           conversationId,
    contactId:          data.contactId,
    actorId,
    channel:            data.channel,
    summary:            `Conversation opened on ${data.channel}`,
    metadata:           { channel: data.channel, channelAddress: data.channelAddress },
    additionalEntities: _contactTarget(data.contactId),
  });

  return item;
}

/**
 * Retrieve a conversation by ID. Returns null when not found or soft-deleted.
 */
async function getConversation(companyId, conversationId) {
  const item = await repo.getById(companyId, conversationId);
  if (!item || item.deletedAt) return null;
  return item;
}

/**
 * Record an AI intent classification (IntentDetectionService's only write path
 * into CONV#). No optimistic lock — mirrors incrementUnread/updateLastMessage's
 * own reasoning: nothing else in the codebase writes intent/confidence/
 * classifiedAt, so there's no concurrent writer to guard against, and a
 * fire-and-forget classification shouldn't have to retry on an unrelated
 * version bump (e.g. an agent reassigning the conversation at the same moment).
 *
 * @param {string} companyId
 * @param {string} conversationId
 * @param {object} data  { intent, confidence }
 * @returns {{ intent, confidence, classifiedAt }}
 */
async function classifyIntent(companyId, conversationId, { intent, confidence }) {
  const classifiedAt = new Date().toISOString();
  await repo.updateClassification(companyId, conversationId, { intent, confidence, classifiedAt });
  return { intent, confidence, classifiedAt };
}

/**
 * Assign a conversation to an employee.
 * Publishes CONVERSATION_ASSIGNED event (fans out to both CONV and CONTACT timelines).
 *
 * Pass assignedTo = null to unassign.
 *
 * @throws {Error} 'not_found'
 */
async function assignConversation(companyId, conversationId, assignedTo, assignedToName, actorId = 'system') {
  const current = await _require(companyId, conversationId);

  const patch = {
    assignedTo,
    assignedToName: assignedToName ?? null,
    ...updateMeta(current, actorId),
  };

  const updated = await repo.updateItem(companyId, conversationId, patch, current.version);

  publishEvent(E.CONVERSATION_ASSIGNED, {
    companyId,
    entityType:         ENTITY.CONV,
    entityId:           conversationId,
    contactId:          current.contactId,
    actorId,
    summary:            assignedTo
                          ? `Conversation assigned to ${assignedToName ?? assignedTo}`
                          : 'Conversation unassigned',
    metadata:           { assignedTo, assignedToName, previousAssignedTo: current.assignedTo },
    additionalEntities: _contactTarget(current.contactId),
  });

  return updated;
}

/**
 * Mark a conversation as resolved.
 * Clears waitingSince (no longer pending).
 *
 * @throws {Error} 'not_found'
 */
async function resolveConversation(companyId, conversationId, actorId = 'system') {
  const current = await _require(companyId, conversationId);
  const patch = { status: STATUS.RESOLVED, waitingSince: null, ...updateMeta(current, actorId) };
  const updated = await repo.updateItem(companyId, conversationId, patch, current.version);

  publishEvent(E.CONVERSATION_RESOLVED, {
    companyId,
    entityType:         ENTITY.CONV,
    entityId:           conversationId,
    contactId:          current.contactId,
    actorId,
    summary:            'Conversation resolved',
    metadata:           {},
    additionalEntities: _contactTarget(current.contactId),
  });

  return updated;
}

/**
 * Reopen a resolved or snoozed conversation.
 * Clears waitingSince and sets status → open.
 *
 * @throws {Error} 'not_found'
 */
async function reopenConversation(companyId, conversationId, actorId = 'system') {
  const current = await _require(companyId, conversationId);
  const patch = { status: STATUS.OPEN, waitingSince: null, ...updateMeta(current, actorId) };
  const updated = await repo.updateItem(companyId, conversationId, patch, current.version);

  publishEvent(E.CONVERSATION_REOPENED, {
    companyId,
    entityType:         ENTITY.CONV,
    entityId:           conversationId,
    contactId:          current.contactId,
    actorId,
    summary:            'Conversation reopened',
    metadata:           { previousStatus: current.status },
    additionalEntities: _contactTarget(current.contactId),
  });

  return updated;
}

/**
 * Snooze a conversation — hides it until un-snoozed or a new message arrives.
 *
 * @throws {Error} 'not_found'
 */
async function snoozeConversation(companyId, conversationId, actorId = 'system') {
  return _setStatus(companyId, conversationId, STATUS.SNOOZED, actorId);
}

/**
 * Set a conversation to pending — waiting for the customer to reply.
 * Records waitingSince for SLA tracking (Phase 2).
 *
 * @throws {Error} 'not_found'
 */
async function pendConversation(companyId, conversationId, actorId = 'system') {
  return _setStatus(companyId, conversationId, STATUS.PENDING, actorId, {
    waitingSince: new Date().toISOString(),
  });
}

/**
 * Reset the unread count to zero (agent has read the conversation).
 * Uses optimistic locking — a concurrent `incrementUnread` call may briefly re-increment.
 *
 * @throws {Error} 'not_found'
 */
async function markRead(companyId, conversationId, actorId = 'system') {
  const current = await _require(companyId, conversationId);
  const patch   = { unreadCount: 0, ...updateMeta(current, actorId) };
  return repo.updateItem(companyId, conversationId, patch, current.version);
}

/**
 * Atomically increment the unread counter.
 * No version check — designed for high-frequency inbound message events.
 * Called by the WhatsApp webhook (Commit 9) for every inbound message.
 *
 * @param {number} [delta=1]
 */
async function incrementUnread(companyId, conversationId, delta = 1) {
  await repo.incrementUnread(companyId, conversationId, delta);
}

/**
 * Update last-message display fields after a message is sent or received.
 * Best-effort — no version locking, safe for concurrent updates.
 *
 * @param {object} message  { text: string, timestamp: string (ISO) }
 */
async function updateLastMessage(companyId, conversationId, message) {
  const timestamp   = message.timestamp || new Date().toISOString();
  const previewText = (message.text || '').slice(0, PREVIEW_MAX_CHARS);

  await repo.updateLastMessage(companyId, conversationId, {
    lastMessageAt:   timestamp,
    lastMessageText: previewText,
    lastActivityAt:  timestamp,
    updatedAt:       timestamp,
  });
}

/**
 * Start AI bot handling on a conversation — the first real write to the
 * isBotActive/handoffState fields anywhere in the codebase (both existed,
 * reserved, since the Phase 2 scaffolding above; ConversationalAgentService.js
 * is their first actual caller, 2026-07-06 Era 22). No version check, same
 * reasoning as updateBotState's own doc comment — this fires once, from the
 * webhook, on the single message that starts a bot conversation.
 *
 * @throws {Error} 'not_found'
 */
async function startBotHandling(companyId, conversationId) {
  await _require(companyId, conversationId);
  await repo.updateBotState(companyId, conversationId, {
    isBotActive: true, handoffState: HANDOFF_STATE.AI, aiTurnCount: 0,
  });
}

/**
 * Record one completed AI turn (an AI-generated reply actually sent).
 */
async function incrementAiTurn(companyId, conversationId, currentTurnCount) {
  await repo.updateBotState(companyId, conversationId, { aiTurnCount: currentTurnCount + 1 });
}

/**
 * Hand a bot conversation off to a human — sets handoffState: pending_human
 * and isBotActive: false so no further inbound message is treated as a bot
 * turn (ConversationalAgentService checks handoffState before ever engaging).
 */
async function handoffToHuman(companyId, conversationId) {
  await repo.updateBotState(companyId, conversationId, {
    isBotActive: false, handoffState: HANDOFF_STATE.PENDING_HUMAN,
  });
}

/**
 * Soft-delete a conversation. Sets deletedAt/deletedBy. Increments version.
 * Preserves the record for audit. GSI queries exclude it via attribute_not_exists(deletedAt).
 *
 * @throws {Error} 'not_found' when conversation doesn't exist or is already deleted
 */
async function softDeleteConversation(companyId, conversationId, actorId = 'system') {
  const current = await repo.getById(companyId, conversationId);
  if (!current || current.deletedAt) throw new Error('not_found');

  const patch   = softDeleteMeta(current, actorId);
  return repo.updateItem(companyId, conversationId, patch, current.version);
}

/**
 * Restore a soft-deleted conversation. Removes deletedAt/deletedBy. Increments version.
 *
 * @throws {Error} 'not_found' when conversation doesn't exist
 * @throws {Error} 'not_deleted' when conversation is not soft-deleted
 */
async function restoreConversation(companyId, conversationId, actorId = 'system') {
  const current = await repo.getById(companyId, conversationId);
  if (!current) throw new Error('not_found');
  if (!current.deletedAt) throw new Error('not_deleted');

  const patch = restoreMeta(current, actorId);
  return repo.updateItem(companyId, conversationId, patch, current.version);
}

/**
 * List conversations for a company with optional filters.
 * Results are sorted newest-first by lastActivityAt.
 *
 * @param {string} companyId
 * @param {object} [opts]
 *   @param {number} [opts.limit=50]
 *   @param {object} [opts.lastKey]    pagination cursor
 *   @param {string} [opts.status]     filter by status
 *   @param {string} [opts.assignedTo] filter by agent employeeId
 * @returns {{ conversations: object[], lastKey: object|null }}
 */
async function listByCompany(companyId, opts = {}) {
  const { items, lastKey } = await repo.queryByCompany(companyId, opts);
  return { conversations: items, lastKey };
}

/**
 * List all conversations for a specific contact.
 * Results are sorted newest-first by lastActivityAt.
 *
 * @returns {{ conversations: object[], lastKey: object|null }}
 */
async function listByContact(companyId, contactId, opts = {}) {
  const { items, lastKey } = await repo.queryByContact(companyId, contactId, opts);
  return { conversations: items, lastKey };
}

module.exports = {
  STATUS,
  CONVERSATION_TYPE,
  HANDOFF_STATE,
  VALID_CHANNELS,
  createConversation,
  getConversation,
  classifyIntent,
  assignConversation,
  resolveConversation,
  reopenConversation,
  snoozeConversation,
  pendConversation,
  markRead,
  incrementUnread,
  updateLastMessage,
  startBotHandling,
  incrementAiTurn,
  handoffToHuman,
  softDeleteConversation,
  restoreConversation,
  listByCompany,
  listByContact,
};
