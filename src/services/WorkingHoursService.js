'use strict';

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const WASendSvc = require('./WhatsAppSendService');
const { resolveWelcomeVariables } = require('../utils/welcomeVariables');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const SYSTEM_USER = { id: 'system', role: 'admin', name: 'System' };

// Don't resend OOO to the same contact more than once within this window —
// a customer sending several messages in one off-hours conversation shouldn't
// get the same "we're closed" reply after every single one.
const OOO_RESEND_THROTTLE_MS = 6 * 3_600_000; // 6 hours

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Working Hours (CONFIG#HOURS) + Out of Office (CONFIG#OOO) — Item 2.
 *
 * PRECEDENCE RULE WITH WELCOME MESSAGE (documented here and enforced in
 * whatsapp.js's webhook): if OOO applies to an inbound message, Welcome is
 * skipped entirely for it — even a contact's very first message. OOO's
 * "we're closed, here's when we'll respond" is more actionable right now than
 * a generic first-contact welcome; the customer still gets a real welcome
 * experience once an agent responds during business hours. If OOO does not
 * apply (hours say open, OOO disabled, or already sent recently to this
 * contact — see OOO_RESEND_THROTTLE_MS), Welcome behaves exactly as it always
 * has. The two can never both fire for the same message.
 *
 * Uses Node's built-in Intl.DateTimeFormat for IANA-timezone-aware day/time
 * resolution — no new date/timezone dependency.
 */

async function _getHoursConfig(companyId) {
  const r = await dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#HOURS#${companyId}`, SK: 'CURRENT' } }).promise();
  return r.Item ?? null;
}

async function _getOOOConfig(companyId) {
  const r = await dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#OOO#${companyId}`, SK: 'CURRENT' } }).promise();
  return r.Item ?? null;
}

/**
 * @param {object} hoursCfg  { enabled, timezone, schedule: { monday: {closed, open, close}, ... } }
 * @param {Date}   [now]
 * @returns {boolean} true if "open" (or working hours aren't configured at all — can't be
 *   "outside hours" with no hours defined), false if outside the configured window.
 */
function isWithinWorkingHours(hoursCfg, now = new Date()) {
  if (!hoursCfg?.enabled) return true;

  const tz = hoursCfg.timezone || 'Asia/Kolkata';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === 'weekday').value.toLowerCase();
  const hour = parts.find((p) => p.type === 'hour').value;
  const minute = parts.find((p) => p.type === 'minute').value;
  const nowHHMM = `${hour}:${minute}`;

  const day = hoursCfg.schedule?.[weekday];
  if (!day || day.closed) return false;
  return nowHHMM >= day.open && nowHHMM < day.close;
}

async function _lastOOOSentAt(target) {
  const Key = target.leadPK ? { PK: target.leadPK, SK: 'METADATA' } : { PK: target.inboxPK, SK: 'CONTACT' };
  const r = await dynamodb.get({ TableName: TABLE, Key }).promise();
  return r.Item?.lastOOOSentAt ?? null;
}

/**
 * Whether an Out of Office reply should fire for this inbound message. Fails
 * safe (returns false) on any error — an unexpected exception should never
 * cause unwanted OOO spam.
 *
 * @param {string} companyId
 * @param {object} target  { leadPK? } | { inboxPK? }
 */
async function shouldSendOOO(companyId, target) {
  try {
    const [oooCfg, hoursCfg] = await Promise.all([_getOOOConfig(companyId), _getHoursConfig(companyId)]);
    if (!oooCfg?.enabled || !oooCfg.messageText) return false;
    if (isWithinWorkingHours(hoursCfg)) return false;

    const lastSent = await _lastOOOSentAt(target);
    if (lastSent && Date.now() - new Date(lastSent).getTime() < OOO_RESEND_THROTTLE_MS) return false;

    return true;
  } catch (err) {
    logger.warn(`WorkingHoursService.shouldSendOOO failed: ${err.message}`);
    return false;
  }
}

/**
 * Sends the configured OOO message and records lastOOOSentAt on the LEAD#/
 * INBOX# record for the resend throttle. Caller (whatsapp.js's webhook) is
 * expected to have already confirmed shouldSendOOO() — this does not
 * re-check.
 *
 * @param {string} companyId
 * @param {object} target  { leadPK?, inboxPK?, phone, name?, source? }
 */
async function sendOOO(companyId, { leadPK, inboxPK, phone, name, source }) {
  const oooCfg = await _getOOOConfig(companyId);
  const resolvedText = resolveWelcomeVariables(oooCfg.messageText, { name, phone, source });
  const sendTarget = leadPK ? { resolvedContact: { pk: leadPK, phone, isLead: true } } : { phone };

  await WASendSvc.sendText(companyId, sendTarget, resolvedText, SYSTEM_USER);

  const Key = leadPK ? { PK: leadPK, SK: 'METADATA' } : { PK: inboxPK, SK: 'CONTACT' };
  await dynamodb.update({
    TableName: TABLE,
    Key,
    UpdateExpression: 'SET lastOOOSentAt = :ts',
    ExpressionAttributeValues: { ':ts': new Date().toISOString() },
  }).promise();
}

module.exports = { isWithinWorkingHours, shouldSendOOO, sendOOO, WEEKDAYS };
