'use strict';

const { v4: uuidv4 } = require('uuid');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const WASendSvc = require('./WhatsAppSendService');
const { resolveWelcomeVariables } = require('../utils/welcomeVariables');
const { to10Digit } = require('../utils/phone');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const SYSTEM_USER = { id: 'system', role: 'admin', name: 'Delayed Response' };

/**
 * "Delayed Response Message" — if a customer messages in and no agent replies
 * within a configured delay, automatically send an acknowledgement. Reuses
 * AutomationEngine's existing AUTO_WAIT#{companyId} partition and
 * processDueWaits() scan/claim sweep as the shared timer mechanism — no
 * second timer is built. Items are discriminated by `waitType:
 * 'delayed_response'`; AutomationEngine.processDueWaits() dispatches here
 * instead of resumeExecution() when it claims one (see that file's own
 * comment). Cancellation (an agent's real reply) is hooked into
 * WhatsAppSendService's 4 send methods — see
 * WhatsAppSendService._fireDelayedResponseCancel().
 */

async function _getConfig(companyId) {
  const r = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#DELAYED_RESPONSE#${companyId}`, SK: 'CURRENT' },
  }).promise();
  return r.Item ?? null;
}

function _delayMs(cfg) {
  const amount = cfg.delayAmount ?? 5;
  return cfg.delayUnit === 'hours' ? amount * 3_600_000 : amount * 60_000;
}

async function _findPending(companyId, phone) {
  // ADR-013 Rule 3: never compare raw phone numbers. cancelPending() can be called
  // with a lead's raw phone field (up to 12 digits — see CustomerIdentityService's
  // leadItem.phone, which stores the caller's input as-is), while scheduleIfEnabled()
  // always stores a 10-digit phone10. Normalize both sides before comparing.
  const phone10 = to10Digit(phone);
  const { Items = [] } = await dynamodb.query({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `AUTO_WAIT#${companyId}` },
    Limit: 100,
  }).promise();
  return Items.filter((item) => item.waitType === 'delayed_response' && to10Digit(item.delayedResponse?.phone) === phone10);
}

/**
 * Schedules a delayed-response wait on a new inbound message, if the feature
 * is enabled and nothing is already pending for this phone (at most one
 * pending timer per conversation — a customer sending 3 messages in a row
 * shouldn't queue 3 delayed responses). Fire-and-forget: never throws.
 *
 * @param {string} companyId
 * @param {object} target  { phone, leadPK?, inboxPK?, name?, source? }
 */
async function scheduleIfEnabled(companyId, { phone, leadPK, inboxPK, name, source }) {
  try {
    const cfg = await _getConfig(companyId);
    if (!cfg?.enabled || !cfg.messageText) return;

    const existing = await _findPending(companyId, phone);
    if (existing.length > 0) return;

    const resumeAt = new Date(Date.now() + _delayMs(cfg)).toISOString();
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `AUTO_WAIT#${companyId}`,
        SK: `WAIT#${resumeAt}#${uuidv4()}`,
        waitType: 'delayed_response',
        companyId,
        delayedResponse: {
          phone, leadPK: leadPK ?? null, inboxPK: inboxPK ?? null, name: name ?? null,
          source: source ?? null, messageText: cfg.messageText,
        },
        createdAt: new Date().toISOString(),
      },
    }).promise();
  } catch (err) {
    logger.warn(`DelayedResponseService.scheduleIfEnabled failed [${phone}]: ${err.message}`);
  }
}

/**
 * Cancels any pending delayed-response wait for this phone — called when a
 * human agent sends a real outbound reply before the delay expires. Uses the
 * same conditional-delete claim as processDueWaits()/resumeOnButtonReply(),
 * so a cancellation racing the timeout sweep can never double-delete or
 * error. Fire-and-forget: never throws.
 */
async function cancelPending(companyId, phone) {
  try {
    const pending = await _findPending(companyId, phone);
    await Promise.all(pending.map((item) =>
      dynamodb.delete({
        TableName: TABLE,
        Key: { PK: item.PK, SK: item.SK },
        ConditionExpression: 'attribute_exists(PK)',
      }).promise().catch((e) => {
        if (e.code !== 'ConditionalCheckFailedException') throw e;
      }),
    ));
  } catch (err) {
    logger.warn(`DelayedResponseService.cancelPending failed [${phone}]: ${err.message}`);
  }
}

/**
 * Called by AutomationEngine.processDueWaits() when it claims a wait item
 * with waitType: 'delayed_response' — sends the configured message.
 */
async function resume(companyId, item) {
  const { phone, leadPK, name, source, messageText } = item.delayedResponse ?? {};
  if (!phone || !messageText) return;

  const target = leadPK ? { resolvedContact: { pk: leadPK, phone, isLead: true } } : { phone };
  const resolvedText = resolveWelcomeVariables(messageText, { name, phone, source });
  await WASendSvc.sendText(companyId, target, resolvedText, SYSTEM_USER);
}

module.exports = { scheduleIfEnabled, cancelPending, resume };
