'use strict';

// Self-service password reset (2026-07-25) — token lifecycle + email send.
// Deliberately separate from scripts/recover-admin.js (an operator-run CLI
// tool for out-of-band recovery) and admin.js's PUT
// /employees/:id/reset-password (an authenticated admin action) — this is
// the third, distinct path: an unauthenticated employee proving control of
// their own registered email address.

const crypto = require('crypto');
const dynamodb = require('../config/dynamodb');
const { sesClient, SES_FROM_ADDRESS } = require('../config/ses');
const logger = require('../config/logger');
const { pwResetPK, pwResetSK } = require('../core/entityKeys');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const TOKEN_TTL_MS = 45 * 60 * 1000; // 45 min -- within the requested 30-60 min window
const RESET_BASE_URL = process.env.FRONTEND_RESET_URL || 'https://app.apforce.in/reset-password';

// 256 bits from Node's CSPRNG -- not predictable, not derived from any
// guessable input (time, user id, etc.).
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createResetToken(user) {
  const token = generateToken();
  const now = Date.now();
  const expiresAtMs = now + TOKEN_TTL_MS;

  await dynamodb.put({
    TableName: TABLE,
    Item: {
      PK: pwResetPK(token),
      SK: pwResetSK(),
      token,
      employeeId: user.id,
      email: user.email,
      companyId: user.companyId ?? null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      // DynamoDB TTL for eventual cleanup only -- see entityKeys.js comment;
      // the expiresAt field above is the actual security boundary.
      ttl: Math.floor(expiresAtMs / 1000),
    },
  }).promise();

  return token;
}

// Never throws -- a send failure (including the expected SES-sandbox
// "MessageRejected: unverified recipient" case) must never change the
// caller's response, or it becomes an account-enumeration + deliverability
// oracle. Logs only; caller decides what (if anything) to tell the client.
// `meta` (companyId/userId) is observability-only -- optional, additive,
// never affects the send itself or the returned boolean.
async function sendResetEmail(email, token, meta = {}) {
  const resetLink = `${RESET_BASE_URL}?token=${token}`;
  const minutes = Math.round(TOKEN_TTL_MS / 60000);
  const params = {
    Source: SES_FROM_ADDRESS,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: 'Reset your APForce password', Charset: 'UTF-8' },
      Body: {
        Text: {
          Charset: 'UTF-8',
          Data: `We received a request to reset your APForce password.\n\n`
            + `Reset your password: ${resetLink}\n\n`
            + `This link expires in ${minutes} minutes and can only be used once. `
            + `If you didn't request this, you can safely ignore this email.`,
        },
        Html: {
          Charset: 'UTF-8',
          Data: `<p>We received a request to reset your APForce password.</p>`
            + `<p><a href="${resetLink}">Reset your password</a></p>`
            + `<p>This link expires in ${minutes} minutes and can only be used once. `
            + `If you didn't request this, you can safely ignore this email.</p>`,
        },
      },
    },
  };

  try {
    const result = await sesClient.sendEmail(params).promise();
    // Safe metadata only -- no token, no reset link, no email body. See
    // the module header on why nothing here can ever gate/change behavior.
    logger.info(`PasswordResetService: Password reset email sent ${JSON.stringify({
      messageId: result.MessageId,
      template: 'password-reset',
      companyId: meta.companyId ?? null,
      userId: meta.userId ?? null,
    })}`);
    return true;
  } catch (err) {
    logger.error(
      `PasswordResetService: SES send failed (code: ${err.code ?? 'n/a'}, status: ${err.statusCode ?? 'n/a'})`,
      err.message
    );
    return false;
  }
}

// Validates AND atomically claims (single-use) in one call -- a token that
// fails validation for any reason (missing, expired, already used) returns
// the same { valid: false } shape, deliberately not distinguishing which,
// to avoid giving an attacker a probing oracle on tokens they don't hold.
async function validateAndClaimToken(token) {
  const res = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: pwResetPK(token), SK: pwResetSK() },
  }).promise();

  const item = res.Item;
  if (!item) return { valid: false };
  if (item.usedAt) return { valid: false };
  if (new Date(item.expiresAt).getTime() < Date.now()) return { valid: false };

  // Atomic single-use claim: SET usedAt only if not already set, so two
  // concurrent requests racing on the same token can't both succeed.
  try {
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: pwResetPK(token), SK: pwResetSK() },
      UpdateExpression: 'SET usedAt = :now',
      ConditionExpression: 'attribute_not_exists(usedAt)',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    }).promise();
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') return { valid: false };
    throw err;
  }

  return { valid: true, employeeId: item.employeeId, email: item.email };
}

module.exports = { createResetToken, sendResetEmail, validateAndClaimToken, TOKEN_TTL_MS };
