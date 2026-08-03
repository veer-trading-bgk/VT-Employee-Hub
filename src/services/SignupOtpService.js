'use strict';

/**
 * Signup OTP service — Email channel for V1.
 *
 * Architecture is channel-aware so Mobile/SMS OTP can plug in later:
 *   sendOtp({ channel: 'email' | 'sms', destination, purpose })
 *   verifyOtp({ channel, destination, purpose, code })
 *
 * SMS send is intentionally not implemented (throws CHANNEL_NOT_CONFIGURED).
 */

const crypto = require('crypto');
const dynamodb = require('../config/dynamodb');
const { sesClient, SES_FROM_ADDRESS } = require('../config/ses');
const logger = require('../config/logger');
const {
  signupOtpPK, signupOtpSK,
  signupEmailProofPK, signupEmailProofSK,
} = require('../core/entityKeys');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

const CHANNEL_EMAIL = 'email';
const CHANNEL_SMS = 'sms';
const PURPOSE_SIGNUP = 'signup';

const OTP_TTL_MS = 10 * 60 * 1000;          // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;       // 60 seconds
const MAX_VERIFY_ATTEMPTS = 5;
const PROOF_TTL_MS = 30 * 60 * 1000;        // 30 minutes to complete signup
const OTP_LENGTH = 6;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateOtp() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(OTP_LENGTH, '0');
}

function generateProofToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function getChallenge(channel, purpose, destinationNorm) {
  const res = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: signupOtpPK(channel, purpose, destinationNorm), SK: signupOtpSK() },
  }).promise();
  return res.Item || null;
}

async function sendEmailOtp(email, code) {
  const minutes = Math.round(OTP_TTL_MS / 60_000);
  const params = {
    Source: SES_FROM_ADDRESS,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: 'Your APForce verification code', Charset: 'UTF-8' },
      Body: {
        Text: {
          Charset: 'UTF-8',
          Data: `Your APForce email verification code is: ${code}\n\n`
            + `This code expires in ${minutes} minutes. `
            + `If you didn't request this, you can ignore this email.`,
        },
        Html: {
          Charset: 'UTF-8',
          Data: `<p>Your APForce email verification code is:</p>`
            + `<p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>`
            + `<p>This code expires in ${minutes} minutes. `
            + `If you didn't request this, you can ignore this email.</p>`,
        },
      },
    },
  };

  const result = await sesClient.sendEmail(params).promise();
  logger.info(`SignupOtpService: email OTP sent ${JSON.stringify({
    messageId: result.MessageId,
    template: 'signup-email-otp',
  })}`);
  return true;
}

/**
 * @returns {Promise<{ ok: true, resendAfterSec: number } | { ok: false, error: string, code: string, resendAfterSec?: number }>}
 */
async function sendOtp({ channel, destination, purpose = PURPOSE_SIGNUP }) {
  if (channel === CHANNEL_SMS) {
    return { ok: false, error: 'SMS OTP is not available yet.', code: 'CHANNEL_NOT_CONFIGURED' };
  }
  if (channel !== CHANNEL_EMAIL) {
    return { ok: false, error: 'Unsupported OTP channel.', code: 'INVALID_CHANNEL' };
  }

  const email = normalizeEmail(destination);
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Enter a valid email.', code: 'INVALID_DESTINATION' };
  }

  const existing = await getChallenge(CHANNEL_EMAIL, purpose, email);
  const now = Date.now();
  if (existing?.lastSentAt) {
    const elapsed = now - new Date(existing.lastSentAt).getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const resendAfterSec = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return {
        ok: false,
        error: `Please wait ${resendAfterSec}s before resending.`,
        code: 'RESEND_COOLDOWN',
        resendAfterSec,
      };
    }
  }

  const code = generateOtp();
  const expiresAtMs = now + OTP_TTL_MS;
  await dynamodb.put({
    TableName: TABLE,
    Item: {
      PK: signupOtpPK(CHANNEL_EMAIL, purpose, email),
      SK: signupOtpSK(),
      channel: CHANNEL_EMAIL,
      purpose,
      destination: email,
      codeHash: hashOtp(code),
      attempts: 0,
      lastSentAt: new Date(now).toISOString(),
      createdAt: existing?.createdAt || new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttl: Math.floor(expiresAtMs / 1000) + 3600,
    },
  }).promise();

  try {
    await sendEmailOtp(email, code);
  } catch (err) {
    logger.error(
      `SignupOtpService: SES send failed (code: ${err.code ?? 'n/a'}, status: ${err.statusCode ?? 'n/a'})`,
      err.message,
    );
    if (process.env.NODE_ENV !== 'production' && process.env.SIGNUP_OTP_DEV_BYPASS === 'true') {
      logger.warn(`SignupOtpService: DEV bypass — OTP for ${email} is ${code}`);
    } else {
      return { ok: false, error: 'Could not send verification email. Try again shortly.', code: 'SEND_FAILED' };
    }
  }

  return { ok: true, resendAfterSec: Math.ceil(RESEND_COOLDOWN_MS / 1000) };
}

/**
 * @returns {Promise<{ ok: true, emailProofToken: string } | { ok: false, error: string, code: string }>}
 */
async function verifyOtp({ channel, destination, purpose = PURPOSE_SIGNUP, code }) {
  if (channel === CHANNEL_SMS) {
    return { ok: false, error: 'SMS OTP is not available yet.', code: 'CHANNEL_NOT_CONFIGURED' };
  }
  if (channel !== CHANNEL_EMAIL) {
    return { ok: false, error: 'Unsupported OTP channel.', code: 'INVALID_CHANNEL' };
  }

  const email = normalizeEmail(destination);
  const otp = String(code || '').trim();
  if (!/^\d{6}$/.test(otp)) {
    return { ok: false, error: 'Enter the 6-digit code.', code: 'INVALID_CODE' };
  }

  const item = await getChallenge(CHANNEL_EMAIL, purpose, email);
  if (!item) {
    return { ok: false, error: 'No verification in progress. Send a new code.', code: 'NO_CHALLENGE' };
  }
  if (new Date(item.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: 'Code expired. Send a new one.', code: 'EXPIRED' };
  }
  if ((item.attempts ?? 0) >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, error: 'Too many attempts. Send a new code.', code: 'ATTEMPTS_EXCEEDED' };
  }

  let match = false;
  try {
    match = crypto.timingSafeEqual(
      Buffer.from(hashOtp(otp), 'hex'),
      Buffer.from(String(item.codeHash), 'hex'),
    );
  } catch {
    match = false;
  }

  if (!match) {
    const attempts = (item.attempts ?? 0) + 1;
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: signupOtpPK(CHANNEL_EMAIL, purpose, email), SK: signupOtpSK() },
      UpdateExpression: 'SET attempts = :a',
      ExpressionAttributeValues: { ':a': attempts },
    }).promise().catch(() => {});
    return { ok: false, error: 'Incorrect code. Try again.', code: 'MISMATCH' };
  }

  await dynamodb.delete({
    TableName: TABLE,
    Key: { PK: signupOtpPK(CHANNEL_EMAIL, purpose, email), SK: signupOtpSK() },
  }).promise().catch(() => {});

  const proofToken = generateProofToken();
  const proofExpires = Date.now() + PROOF_TTL_MS;
  await dynamodb.put({
    TableName: TABLE,
    Item: {
      PK: signupEmailProofPK(proofToken),
      SK: signupEmailProofSK(),
      email,
      channel: CHANNEL_EMAIL,
      purpose,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(proofExpires).toISOString(),
      ttl: Math.floor(proofExpires / 1000),
    },
  }).promise();

  return { ok: true, emailProofToken: proofToken };
}

/**
 * Atomically claim a one-time email proof for company-signup.
 * @returns {Promise<{ valid: true, email: string } | { valid: false }>}
 */
async function claimEmailProof(token, expectedEmail) {
  if (!token || typeof token !== 'string') return { valid: false };
  const email = normalizeEmail(expectedEmail);

  const res = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: signupEmailProofPK(token), SK: signupEmailProofSK() },
  }).promise();
  const item = res.Item;
  if (!item) return { valid: false };
  if (item.usedAt) return { valid: false };
  if (new Date(item.expiresAt).getTime() < Date.now()) return { valid: false };
  if (normalizeEmail(item.email) !== email) return { valid: false };

  try {
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: signupEmailProofPK(token), SK: signupEmailProofSK() },
      UpdateExpression: 'SET usedAt = :now',
      ConditionExpression: 'attribute_not_exists(usedAt)',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    }).promise();
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') return { valid: false };
    throw err;
  }

  return { valid: true, email };
}

module.exports = {
  sendOtp,
  verifyOtp,
  claimEmailProof,
  normalizeEmail,
  CHANNEL_EMAIL,
  CHANNEL_SMS,
  PURPOSE_SIGNUP,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_VERIFY_ATTEMPTS,
  hashOtp,
};
