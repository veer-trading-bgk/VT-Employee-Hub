'use strict';

const { v4: uuidv4 } = require('uuid');
const dynamodb = require('../config/dynamodb');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

/**
 * Generic, company-scoped prepaid balance ("wallet points") — deliberately NOT
 * AI-specific in shape. It backs any future metered feature (AI overage beyond the
 * free monthly allowance, WhatsApp Calling's per-minute pass-through cost, etc.);
 * each ledger entry is tagged with a `meterType` so the balance itself stays one
 * fungible number while individual debits/credits remain attributable to whichever
 * feature caused them.
 *
 * Nothing calls credit()/debit() from AIService yet — usage is logged (AIUSAGE#),
 * not charged, in this phase (AI is fully covered by the subscription plan today).
 * This service exists now so WhatsApp Calling (which DOES need real per-minute
 * deduction) has a wallet to debit from the day it ships, without a second
 * migration to introduce the entity.
 */

const PK = (companyId) => `WALLET#${companyId}`;

async function ensureWallet(companyId) {
  const now = new Date().toISOString();
  try {
    await dynamodb.put({
      TableName: TABLE,
      Item: { PK: PK(companyId), SK: 'CURRENT', companyId, balancePoints: 0, createdAt: now, updatedAt: now },
      ConditionExpression: 'attribute_not_exists(PK)',
    }).promise();
  } catch (err) {
    if (err.code !== 'ConditionalCheckFailedException') throw err;
  }
}

async function getBalance(companyId) {
  await ensureWallet(companyId);
  const r = await dynamodb.get({ TableName: TABLE, Key: { PK: PK(companyId), SK: 'CURRENT' } }).promise();
  return r.Item?.balancePoints ?? 0;
}

async function _writeLedgerEntry(companyId, { type, amountPoints, meterType, reason, relatedId, balanceAfter }) {
  await dynamodb.put({
    TableName: TABLE,
    Item: {
      PK: PK(companyId),
      SK: `TXN#${new Date().toISOString()}#${uuidv4()}`,
      companyId, type, amountPoints, meterType, reason,
      ...(relatedId && { relatedId }),
      balanceAfter,
      createdAt: new Date().toISOString(),
    },
  }).promise();
}

/** Adds points to the wallet (e.g. a manual top-up or a plan-included allowance). */
async function credit(companyId, points, { meterType, reason, relatedId } = {}) {
  if (!(points > 0)) throw new Error('credit() amount must be a positive number');
  await ensureWallet(companyId);

  const now = new Date().toISOString();
  const res = await dynamodb.update({
    TableName: TABLE,
    Key: { PK: PK(companyId), SK: 'CURRENT' },
    UpdateExpression: 'ADD balancePoints :delta SET updatedAt = :now',
    ExpressionAttributeValues: { ':delta': points, ':now': now },
    ReturnValues: 'UPDATED_NEW',
  }).promise();

  const balancePoints = res.Attributes.balancePoints;
  await _writeLedgerEntry(companyId, { type: 'credit', amountPoints: points, meterType, reason, relatedId, balanceAfter: balancePoints });
  return { balancePoints };
}

/**
 * Subtracts points, guarded by a ConditionExpression so a balance can never go
 * negative under concurrent debits. Throws a typed { code: 'INSUFFICIENT_BALANCE' }
 * error (not a generic DynamoDB error) so callers can show a specific message.
 */
async function debit(companyId, points, { meterType, reason, relatedId } = {}) {
  if (!(points > 0)) throw new Error('debit() amount must be a positive number');
  await ensureWallet(companyId);

  const now = new Date().toISOString();
  let res;
  try {
    res = await dynamodb.update({
      TableName: TABLE,
      Key: { PK: PK(companyId), SK: 'CURRENT' },
      UpdateExpression: 'ADD balancePoints :delta SET updatedAt = :now',
      ConditionExpression: 'balancePoints >= :points',
      ExpressionAttributeValues: { ':delta': -points, ':points': points, ':now': now },
      ReturnValues: 'UPDATED_NEW',
    }).promise();
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') {
      const e = new Error('Insufficient wallet balance');
      e.code = 'INSUFFICIENT_BALANCE';
      throw e;
    }
    throw err;
  }

  const balancePoints = res.Attributes.balancePoints;
  await _writeLedgerEntry(companyId, { type: 'debit', amountPoints: points, meterType, reason, relatedId, balanceAfter: balancePoints });
  return { balancePoints };
}

module.exports = { ensureWallet, getBalance, credit, debit };
