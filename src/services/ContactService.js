'use strict';

const repo                                         = require('../repositories/ContactRepository');
const { publishEvent }                             = require('../events/publisher');
const { E, ENTITY }                                = require('../events/catalog');
const { generateContactId }                        = require('../core/id');
const { newMeta, updateMeta, softDeleteMeta, restoreMeta } = require('../core/systemMeta');
const { contactCompanyGsiPK, phoneLockPK, phoneLockSK }   = require('../core/entityKeys');
const { normalizeE164 }                            = require('../utils/phoneNormalize');
const logger                                       = require('../config/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isDuplicateTransaction(err) {
  // DynamoDB TransactionCanceledException fires when any item condition fails.
  return err.code === 'TransactionCanceledException';
}

function isVersionConflict(err) {
  return err.code === 'ConditionalCheckFailedException';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new contact, or return the existing one if the phone is already registered.
 *
 * Duplicate detection is atomic (TransactWrite: phone lock + contact item).
 * A concurrent duplicate request hits the phone lock condition and is redirected
 * to the existing contact via a GSI lookup.
 *
 * @param {string} companyId
 * @param {object} data
 *   @param {string}   data.phone        required — any format; normalised to E.164
 *   @param {string}   [data.displayName]
 *   @param {string}   [data.firstName]
 *   @param {string}   [data.lastName]
 *   @param {string}   [data.email]
 *   @param {string[]} [data.alternatePhones]
 *   @param {string}   [data.type]         'individual' | 'business' (default: 'individual')
 *   @param {string[]} [data.tags]
 *   @param {string}   [data.source]       first sourceHistory entry source value
 *                                         'whatsapp' | 'crm_manual' | 'import' | 'form' | 'api'
 *   @param {string}   [data.sourceId]     first sourceHistory entry sourceId (e.g. INBOX# PK)
 * @param {string}  [actorId='system']     employeeId or 'system' or 'webhook'
 * @returns {{ contact: object, created: boolean }}
 * @throws {Error} 'invalid_phone' when the phone cannot be normalised
 */
async function createContact(companyId, data, actorId = 'system') {
  if (!companyId) throw new Error('companyId is required');

  const phoneE164 = normalizeE164(data?.phone);
  if (!phoneE164) throw new Error('invalid_phone');

  const contactId = generateContactId();
  const meta      = newMeta(actorId);

  const contactItem = {
    // DynamoDB keys
    PK: `CONTACT#${companyId}#${contactId}`,
    SK: 'CONTACT#META',

    // Entity identity
    contactId,
    companyId,

    // Phone
    phoneE164,
    alternatePhones: data.alternatePhones ?? [],

    // Display
    displayName: data.displayName || data.firstName || phoneE164,
    firstName:   data.firstName   ?? null,
    lastName:    data.lastName    ?? null,
    email:       data.email       ?? null,

    // Classification
    type: data.type || 'individual',
    tags: data.tags ?? [],

    // Source audit trail — append-only array, newest last.
    // Each entry records how/when/who introduced this contact into the system.
    // Future: add entries when the contact is discovered on additional channels.
    sourceHistory: [
      {
        source:   data.source || 'crm_manual',
        sourceId: data.sourceId ?? null,
        addedAt:  meta.createdAt,
        addedBy:  actorId,
      },
    ],

    // Multi-channel identity collection — one entry per channel address.
    // Grows as the contact is discovered on WhatsApp, email, Instagram, Telegram, etc.
    // Only the primary phone identity is populated at creation time.
    identities: [
      {
        channel:   'whatsapp',
        value:     phoneE164,
        isPrimary: true,
        verified:  false,
        addedAt:   meta.createdAt,
      },
    ],

    // AI / communication preferences — null until set by the contact or inferred by AI.
    preferredChannel:  null, // 'whatsapp' | 'email' | 'telegram' | 'sms'
    preferredLanguage: null, // BCP 47 tag: 'en', 'hi', 'mr', 'te', etc.
    timezone:          null, // IANA tz: 'Asia/Kolkata', 'America/New_York', etc.

    // Counters (denormalised for list displays)
    leadCount: 0,
    convCount: 0,

    // Reserved — Phase 2 multi-channel support (set when the primary conversation is determined)
    primaryConversationId: null,

    // GSI attributes
    contactCompanyPK: contactCompanyGsiPK(companyId), // ContactsByCompany GSI PK

    // System metadata
    ...meta,
  };

  const phoneLockItem = {
    PK:        phoneLockPK(companyId, phoneE164),
    SK:        phoneLockSK(),
    contactId, // pointer to the contact that owns this phone
    createdAt: meta.createdAt,
  };

  try {
    await repo.transactCreate(contactItem, phoneLockItem);
  } catch (err) {
    if (isDuplicateTransaction(err)) {
      // Phone lock already existed — find and return the existing contact.
      const existing = await repo.queryByPhone(companyId, phoneE164);
      if (existing) return { contact: existing, created: false };
      // Phone lock exists but contact not found — should never happen in practice.
      // Re-throw to surface the inconsistency rather than silently swallowing it.
      throw err;
    }
    throw err;
  }

  publishEvent(E.CONTACT_CREATED, {
    companyId,
    entityType: ENTITY.CONTACT,
    entityId:   contactId,
    actorId,
    summary:    `Contact created: ${contactItem.displayName}`,
    metadata:   { phone: phoneE164, source: contactItem.sourceHistory[0].source },
  });

  return { contact: contactItem, created: true };
}

/**
 * Retrieve a contact by its ID. Returns null if not found or soft-deleted.
 */
async function getContact(companyId, contactId) {
  const item = await repo.getById(companyId, contactId);
  if (!item || item.deletedAt) return null;
  return item;
}

/**
 * Find a contact by phone number within a company.
 * Normalises the phone to E.164 before querying. Returns null if not found.
 *
 * @throws {Error} 'invalid_phone' if the phone cannot be normalised
 */
async function findContactByPhone(companyId, phone) {
  const phoneE164 = normalizeE164(phone);
  if (!phoneE164) throw new Error('invalid_phone');
  return repo.queryByPhone(companyId, phoneE164);
}

/**
 * Update mutable fields on an existing contact.
 * Increments version (optimistic locking). Publishes CONTACT_UPDATED event.
 *
 * @param {string} companyId
 * @param {string} contactId
 * @param {object} data       — fields to update (phone and metadata not updatable here)
 * @param {string} [actorId]
 * @returns {object} updated contact
 * @throws {Error} 'not_found' when contact doesn't exist or is deleted
 * @throws ConditionalCheckFailedException on concurrent version conflict
 */
async function updateContact(companyId, contactId, data, actorId = 'system') {
  const current = await repo.getById(companyId, contactId);
  if (!current || current.deletedAt) throw new Error('not_found');

  // sourceHistory and identities are append-only — use dedicated service methods (Phase 2).
  const allowedFields = ['displayName', 'firstName', 'lastName', 'email',
    'alternatePhones', 'type', 'tags', 'leadCount', 'convCount',
    'preferredChannel', 'preferredLanguage', 'timezone'];

  const fieldPatch = {};
  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      fieldPatch[key] = data[key];
    }
  }

  const patch = { ...fieldPatch, ...updateMeta(current, actorId) };
  const updated = await repo.updateItem(companyId, contactId, patch, current.version);

  publishEvent(E.CONTACT_UPDATED, {
    companyId,
    entityType: ENTITY.CONTACT,
    entityId:   contactId,
    actorId,
    summary:    `Contact updated: ${updated.displayName}`,
    metadata:   { changedFields: Object.keys(fieldPatch) },
  });

  return updated;
}

/**
 * Soft-delete a contact. Sets deletedAt/deletedBy. Increments version.
 * The record is preserved in DynamoDB for audit. GSI queries exclude it via
 * attribute_not_exists(deletedAt) filter.
 *
 * @returns {object} updated (soft-deleted) contact
 * @throws {Error} 'not_found' when contact doesn't exist or is already deleted
 */
async function softDeleteContact(companyId, contactId, actorId = 'system') {
  const current = await repo.getById(companyId, contactId);
  if (!current || current.deletedAt) throw new Error('not_found');

  const patch   = softDeleteMeta(current, actorId);
  const updated = await repo.updateItem(companyId, contactId, patch, current.version);

  publishEvent(E.CONTACT_ARCHIVED, {
    companyId,
    entityType: ENTITY.CONTACT,
    entityId:   contactId,
    actorId,
    summary:    `Contact archived: ${current.displayName}`,
    metadata:   {},
  });

  return updated;
}

/**
 * Restore a previously soft-deleted contact.
 * Removes deletedAt/deletedBy. Increments version.
 *
 * @returns {object} restored contact
 * @throws {Error} 'not_found' when contact doesn't exist
 * @throws {Error} 'not_deleted' when contact is not currently soft-deleted
 */
async function restoreContact(companyId, contactId, actorId = 'system') {
  const current = await repo.getById(companyId, contactId);
  if (!current) throw new Error('not_found');
  if (!current.deletedAt) throw new Error('not_deleted');

  const patch   = restoreMeta(current, actorId);
  const updated = await repo.updateItem(companyId, contactId, patch, current.version);

  publishEvent(E.CONTACT_UPDATED, {
    companyId,
    entityType: ENTITY.CONTACT,
    entityId:   contactId,
    actorId,
    summary:    `Contact restored: ${current.displayName}`,
    metadata:   { action: 'restore' },
  });

  return updated;
}

/**
 * List contacts for a company with cursor-based pagination.
 * Results are sorted newest-first by createdAt.
 * Soft-deleted contacts are excluded.
 *
 * @param {string} companyId
 * @param {object} [opts]
 *   @param {number} [opts.limit=50]
 *   @param {object} [opts.lastKey]   pagination cursor from previous response
 * @returns {{ contacts: object[], lastKey: object|null }}
 */
async function listContacts(companyId, opts = {}) {
  const { items, lastKey } = await repo.queryByCompany(companyId, opts);
  return { contacts: items, lastKey };
}

module.exports = {
  createContact,
  getContact,
  findContactByPhone,
  updateContact,
  softDeleteContact,
  restoreContact,
  listContacts,
};
