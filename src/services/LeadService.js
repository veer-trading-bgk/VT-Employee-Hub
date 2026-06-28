'use strict';

const dynamodb       = require('../config/dynamodb');
const logger         = require('../config/logger');
const ContactService = require('./ContactService');

function table() { return process.env.DYNAMODB_TABLE_METRICS; }

/**
 * Link a Contact entity to a Lead by finding or creating a Contact for the lead's phone.
 *
 * On first call:
 *   1. GetItem on LEAD# METADATA — bail early if contactId is already set (idempotency)
 *   2. findContactByPhone → create if none found (phone dedup atomic in ContactService)
 *   3. Write contactId onto LEAD# METADATA with if_not_exists guard (race-safe)
 *
 * Called fire-and-forget from CRM lead creation routes. Never throws.
 *
 * @param {string} companyId
 * @param {string} leadPK     'LEAD#${companyId}#${leadId}'
 * @param {string} phone      10-digit phone (already cleaned by caller)
 * @param {string} [leadName] display name from lead data; falls back to phone
 * @returns {Promise<void>}   — never throws
 */
async function linkContactToLead(companyId, leadPK, phone, leadName) {
  try {
    // 1. Idempotency — skip if contactId was already written (e.g. re-import or retry)
    const existing = await dynamodb.get({
      TableName: table(),
      Key: { PK: leadPK, SK: 'METADATA' },
    }).promise();
    if (existing.Item?.contactId) return;

    // 2. Find existing Contact or create one from lead data
    let contact = await ContactService.findContactByPhone(companyId, phone);
    if (!contact) {
      const result = await ContactService.createContact(companyId, {
        phone,
        displayName: leadName ?? phone,
        source:      'lead',
      }, 'system');
      contact = result.contact;
    }

    // 3. Write contactId onto Lead — if_not_exists guards concurrent create calls
    await dynamodb.update({
      TableName: table(),
      Key: { PK: leadPK, SK: 'METADATA' },
      UpdateExpression:          'SET contactId = if_not_exists(contactId, :ctid)',
      ExpressionAttributeValues: { ':ctid': contact.contactId },
    }).promise();

    logger.info(`leadService: contact=${contact.contactId} linked to ${leadPK} company=${companyId}`);
  } catch (err) {
    logger.warn(`leadService.linkContactToLead failed [${leadPK}]: ${err.message}`);
  }
}

module.exports = { linkContactToLead };
