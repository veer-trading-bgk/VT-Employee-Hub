const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const { randomUUID } = require('crypto');
const { loginSchema, registerSchema, verifyTotpSchema, verifyBackupSchema, companySignupSchema, selfProfileUpdateSchema } = require('../utils/validation');
const { logAudit } = require('../utils/audit');
const { encrypt, decrypt } = require('../utils/encryption');
const { loginRateLimiter } = require('../middleware/rateLimiter');
const { authMiddleware, fetchCompanyPlan } = require('../middleware/auth');
const { totpRateLimitCheck, recordTotpFailure, clearTotpAttempts } = require('../middleware/totpRateLimiter');
const dynamodb = require('../config/dynamodb');
const { s3Client, MEDIA_BUCKET } = require('../config/s3');
const bot = require('../config/telegram');
const logger = require('../config/logger');

const router = express.Router();
const TABLE_METRICS = process.env.DYNAMODB_TABLE_METRICS;

// ── Helpers ──────────────────────────────────────────────────────────────────

function markAttendance(user) {
  const date = new Date().toISOString().slice(0, 10);
  const PK = user.companyId ? `ATTENDANCE#${user.companyId}#${user.id}` : `ATTENDANCE#${user.id}`;
  dynamodb.put({
    TableName: TABLE_METRICS,
    Item: {
      PK, SK: date,
      userId: user.id, companyId: user.companyId ?? null,
      date, month: date.slice(0, 7),
      checkInTime: new Date().toISOString(), source: 'login',
    },
    ConditionExpression: 'attribute_not_exists(SK)',
  }).promise().catch(() => {});
}

function cookieAttrs() {
  const isProd = process.env.NODE_ENV === 'production';
  return isProd ? 'Secure; SameSite=None' : 'SameSite=Strict';
}

// FIX 4: planStatus + trialEndsAt are embedded in the JWT so subscriptionMiddleware
// can gate writes without a DB round-trip on every request.
function issueTokens(user, res) {
  const accessToken = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name || '',
      companyId: user.companyId || null,
      plan: user.plan || null,
      planStatus: user.planStatus || null,
      trialEndsAt: user.trialEndsAt || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '1h' }
  );
  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: '30d' }
  );
  const attrs = cookieAttrs();
  res.setHeader('Set-Cookie', [
    `accessToken=${accessToken}; HttpOnly; ${attrs}; Path=/; Max-Age=3600`,
    `refreshToken=${refreshToken}; HttpOnly; ${attrs}; Path=/; Max-Age=2592000`,
  ]);
  return { accessToken, refreshToken };
}

async function attachPlan(user) {
  if (!user.companyId) return user;
  const planData = await fetchCompanyPlan(user.companyId);
  return { ...user, plan: planData.plan, planStatus: planData.planStatus, trialEndsAt: planData.trialEndsAt };
}

async function findUserByEmail(email) {
  const result = await dynamodb.query({
    TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
    IndexName: 'emailIndex',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email },
  }).promise();
  return result.Items?.[0] ?? null;
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    // Per-email rate limit: blocks only the account being attacked, not all office users
    if (await loginRateLimiter.isBlocked(email)) {
      await logAudit('unknown', 'login_rate_limited', email, 'blocked', req.ip).catch(() => {});
      return res.status(429).json({ error: 'Too many failed login attempts. Try again in 15 minutes.' });
    }

    const user = await findUserByEmail(email);

    if (!user) {
      await loginRateLimiter.recordFail(email);
      await logAudit('unknown', 'failed_login', email, 'user_not_found', req.ip);
      logger.warn(`Failed login for unknown email ${email} from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'inactive') {
      await logAudit(user.id, 'failed_login', email, 'account_inactive', req.ip);
      return res.status(401).json({ error: 'Account inactive. Contact admin.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const fails = await loginRateLimiter.recordFail(email);
      await logAudit(user.id, 'failed_login', email, 'invalid_password', req.ip);
      if (fails >= 5) {
        bot.sendMessage(
          process.env.TELEGRAM_ADMIN_CHAT_ID,
          `⚠️ Multiple failed logins for ${email}\nIP: ${req.ip}\nFailed attempts: ${fails}`
        ).catch(() => {});
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // ── 2FA path: required immediately once enabled ───────────────────────────
    if (user.totpEnabled && user.totpSecret) {
      const tempToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role, temp: true },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      await logAudit(user.id, 'login_initiated', email, 'awaiting_2fa', req.ip);
      return res.json({ requiresTOTP: true, tempToken, message: 'Enter your authenticator code' });
    }

    // ── No 2FA: issue full JWT ─────────────────────────────────────────────────
    await loginRateLimiter.reset(email);
    const userWithPlan = await attachPlan(user);
    const { accessToken } = issueTokens(userWithPlan, res);
    markAttendance(user);
    await logAudit(user.id, 'successful_login', email, 'success', req.ip, {}, user.companyId);
    logger.info(`User ${email} logged in from ${req.ip}`);

    res.json({
      success: true,
      message: 'Login successful',
      token: accessToken,
      user: {
        id: user.id, email: user.email, role: user.role, name: user.name,
        companyId: user.companyId || null,
        planStatus: userWithPlan.planStatus,
        trialEndsAt: userWithPlan.trialEndsAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/auth/verify-totp ────────────────────────────────────────────────

router.post('/verify-totp', async (req, res, next) => {
  try {
    const { tempToken, totpCode } = verifyTotpSchema.parse(req.body);

    // Verify the temp token — must have temp: true
    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    }
    if (!decoded.temp) {
      return res.status(401).json({ error: 'Invalid token type.' });
    }

    const user = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id: decoded.id },
    }).promise().then((r) => r.Item);

    if (!user || !user.totpSecret) {
      return res.status(401).json({ error: 'User not found or 2FA not configured.' });
    }

    // Rate limit check
    const allowed = await totpRateLimitCheck(user.email, user.id, res);
    if (!allowed) return;

    // Dev bypass modes (never active in production)
    let isValid = false;
    if (process.env.NODE_ENV !== 'production' && process.env.TOTP_DISABLED_FOR_DEV === 'true') {
      isValid = /^\d{6}$/.test(totpCode);
    } else if (process.env.NODE_ENV !== 'production' && process.env.TEST_TOTP_CODE) {
      isValid = totpCode === process.env.TEST_TOTP_CODE ||
        speakeasy.totp.verify({ secret: user.totpSecret, encoding: 'base32', token: totpCode, window: 1 });
    } else {
      isValid = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: 'base32',
        token: totpCode,
        window: 1, // ±30s tolerance
      });
    }

    if (!isValid) {
      const attempts = await recordTotpFailure(user.email, user.id);
      const remaining = Math.max(0, 5 - attempts);
      await logAudit(user.id, 'totp_failed', user.email, 'invalid_code', req.ip, { attempts });
      return res.status(401).json({
        error: `Invalid 2FA code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        attemptsRemaining: remaining,
      });
    }

    await clearTotpAttempts(user.email);
    const userWithPlan = await attachPlan(user);
    const { accessToken } = issueTokens(userWithPlan, res);
    markAttendance(user);
    await logAudit(user.id, 'totp_verified', user.email, 'success', req.ip, {}, user.companyId);
    logger.info(`User ${user.email} completed 2FA from ${req.ip}`);

    res.json({
      success: true,
      message: 'Login successful',
      token: accessToken,
      user: {
        id: user.id, email: user.email, role: user.role, name: user.name,
        companyId: user.companyId || null,
        planStatus: userWithPlan.planStatus,
        trialEndsAt: userWithPlan.trialEndsAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/auth/verify-totp-backup ─────────────────────────────────────────

router.post('/verify-totp-backup', async (req, res, next) => {
  try {
    const { tempToken, email, backupCode } = verifyBackupSchema.parse(req.body);
    const normalizedCode = backupCode.toUpperCase().replace(/\s/g, '');

    // Verify the temp token — must have temp: true (proves password was already checked)
    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    }
    if (!decoded.temp) {
      return res.status(401).json({ error: 'Invalid token type.' });
    }

    const user = await findUserByEmail(email);
    if (!user || user.id !== decoded.id) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (!user.backupCodes || !Array.isArray(user.backupCodes) || user.backupCodes.length === 0) {
      return res.status(400).json({ error: 'No backup codes configured for this account.' });
    }

    // Rate limit backup attempts the same way as TOTP
    const allowed = await totpRateLimitCheck(user.email, user.id, res);
    if (!allowed) return;

    // Find a matching, unused backup code
    let matchIndex = -1;
    for (let i = 0; i < user.backupCodes.length; i++) {
      const bc = user.backupCodes[i];
      if (bc.used) continue;
      try {
        const plain = decrypt(bc.encryptedCode);
        if (plain === normalizedCode) { matchIndex = i; break; }
      } catch {
        // Corrupted entry — skip
      }
    }

    if (matchIndex === -1) {
      await recordTotpFailure(user.email, user.id);
      await logAudit(user.id, 'backup_code_failed', user.email, 'invalid_code', req.ip);
      return res.status(401).json({ error: 'Invalid or already used backup code.' });
    }

    // Mark the code as used
    const updatedCodes = user.backupCodes.map((bc, i) =>
      i === matchIndex ? { ...bc, used: true, usedAt: new Date().toISOString() } : bc
    );
    const unusedCount = updatedCodes.filter((c) => !c.used).length;

    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id: user.id },
      UpdateExpression: 'SET backupCodes = :codes',
      ExpressionAttributeValues: { ':codes': updatedCodes },
    }).promise();

    await clearTotpAttempts(user.email);
    const userWithPlan = await attachPlan(user);
    const { accessToken } = issueTokens(userWithPlan, res);
    await logAudit(user.id, 'backup_code_used', user.email, 'success', req.ip, { unusedCount }, user.companyId);
    logger.info(`User ${user.email} used a backup code from ${req.ip}. ${unusedCount} codes remaining.`);

    res.json({
      success: true,
      message: 'Login successful via backup code.',
      token: accessToken,
      user: {
        id: user.id, email: user.email, role: user.role, name: user.name,
        companyId: user.companyId || null,
        planStatus: userWithPlan.planStatus,
        trialEndsAt: userWithPlan.trialEndsAt,
      },
      backupCodesRemaining: unusedCount,
      warning: unusedCount <= 2 ? 'You have very few backup codes left. Ask your admin to regenerate them.' : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token provided' });

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id: decoded.id },
    }).promise();

    if (!result.Item || result.Item.status !== 'active') {
      return res.status(401).json({ error: 'User account is inactive or deleted' });
    }

    const user = result.Item;
    const userWithPlan = await attachPlan(user);
    const { accessToken } = issueTokens(userWithPlan, res);
    res.json({
      success: true,
      token: accessToken,
      user: {
        id: user.id, email: user.email, role: user.role, name: user.name,
        companyId: user.companyId || null,
        planStatus: userWithPlan.planStatus,
        trialEndsAt: userWithPlan.trialEndsAt,
      },
    });
  } catch {
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// ── POST /api/auth/register (admin only) ──────────────────────────────────────

router.post('/register', authMiddleware, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      await logAudit(req.user.id, 'unauthorized_register', 'new_user', 'failed', req.ip, {}, req.user.companyId);
      return res.status(403).json({ error: 'Only admins can register users' });
    }

    const { email, password, name, role, mobileNumber, panNumber, aadhaarNumber, homeAddress } = registerSchema.parse(req.body);

    // FIX 3: email uniqueness is per-company — same email is allowed across different companies
    const existing = await dynamodb.query({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      IndexName: 'emailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
    }).promise();
    const sameCompanyDupe = existing.Items.find((e) => e.companyId === req.user.companyId);
    if (sameCompanyDupe) {
      return res.status(400).json({ error: 'Email already registered in this company' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = `emp_${Date.now()}`;

    const item = {
      id: userId,
      email,
      password: hashedPassword,
      name,
      role,
      ...(req.user.companyId && { companyId: req.user.companyId }),
      createdAt: new Date().toISOString(),
      createdBy: req.user.id,
      status: 'active',
      totpEnabled: false,
      totpSecret: null,
      backupCodes: [],
    };
    if (mobileNumber)  item.mobileNumber  = mobileNumber;
    if (panNumber)     item.panNumber     = panNumber;
    if (aadhaarNumber) item.aadhaarNumber = aadhaarNumber;
    if (homeAddress)   item.homeAddress   = homeAddress;

    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Item: item,
    }).promise();

    await logAudit(req.user.id, 'user_registered', email, 'success', req.ip, { role, name }, req.user.companyId);
    logger.info(`New user registered: ${email} (${role})`);

    res.status(201).json({ success: true, message: 'User registered successfully', user: { id: userId, email, name, role } });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', authMiddleware, async (req, res) => {
  await logAudit(req.user.id, 'logout', req.user.email, 'success', req.ip, {}, req.user.companyId);
  const attrs = cookieAttrs();
  res.setHeader('Set-Cookie', [
    `accessToken=; HttpOnly; ${attrs}; Max-Age=0; Path=/`,
    `refreshToken=; HttpOnly; ${attrs}; Max-Age=0; Path=/`,
  ]);
  res.json({ success: true, message: 'Logged out successfully' });
});

// ── POST /api/auth/company-signup ─────────────────────────────────────────────
// Public route: self-service signup for a new AP office (creates company + admin user)

router.post('/company-signup', async (req, res, next) => {
  try {
    const data = companySignupSchema.parse(req.body);

    // Check email not already registered
    const existing = await findUserByEmail(data.adminEmail);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered. Try logging in instead.' });
    }

    const now = Date.now();
    const companyId = `company_${now}`;
    const adminId = `emp_${now}`;
    const trialEndsAt = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();

    // Create company profile record (stored alongside employees for simplicity)
    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Item: {
        id: `COMPANY#${companyId}`,
        type: 'COMPANY_PROFILE',
        companyId,
        companyName: data.companyName,
        broker: data.broker,
        city: data.city,
        adminEmail: data.adminEmail,
        plan: 'trial',
        trialEndsAt,
        planStatus: 'active',
        createdAt: new Date().toISOString(),
      },
    }).promise();

    // Create admin user with companyId
    const hashedPassword = await bcrypt.hash(data.password, 10);
    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Item: {
        id: adminId,
        email: data.adminEmail,
        password: hashedPassword,
        name: data.adminName,
        role: 'admin',
        companyId,
        ...(data.adminMobile && { mobileNumber: data.adminMobile }),
        status: 'active',
        createdAt: new Date().toISOString(),
        createdBy: 'self',
        totpEnabled: false,
        totpSecret: null,
        backupCodes: [],
      },
    }).promise();

    const user = {
      id: adminId, email: data.adminEmail, role: 'admin', name: data.adminName, companyId,
      plan: 'trial', planStatus: 'active', trialEndsAt,
    };
    const { accessToken } = issueTokens(user, res);

    await logAudit(adminId, 'company_signup', data.adminEmail, 'success', req.ip, {
      companyId,
      companyName: data.companyName,
    }).catch(() => {});
    logger.info(`New company signed up: "${data.companyName}" (${companyId}) admin: ${data.adminEmail}`);

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `🎉 New APForce Signup!\n\nCompany: ${data.companyName}\nBroker: ${data.broker}\nCity: ${data.city}\nAdmin: ${data.adminEmail}\nTrial ends: ${trialEndsAt.slice(0, 10)}`
    ).catch(() => {});

    res.status(201).json({
      success: true,
      message: 'Account created! Your 14-day free trial starts now.',
      token: accessToken,
      user,
      company: { companyId, companyName: data.companyName, plan: 'trial', trialEndsAt },
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id: req.user.id },
    }).promise();

    if (!result.Item) return res.status(404).json({ error: 'User not found' });

    const { password, totpSecret, backupCodes, ...safe } = result.Item;
    const token = req.cookies?.accessToken;
    res.json(token ? { ...safe, token } : safe);
  } catch {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ── PUT /api/auth/me — self-service profile update (B3 finding #11) ──────────
// Operates strictly on req.user.id from the verified JWT — never a
// client-supplied id, so there is no path to editing someone else's
// profile. Field allowlist is selfProfileUpdateSchema (name/mobileNumber/
// homeAddress/avatarKey only) — role/status/email/panNumber/aadhaarNumber
// and every other admin-managed field are rejected by .strict(), not
// silently dropped. panNumber/aadhaarNumber are admin-only by explicit
// product decision (2026-07-13) — see admin.js's PUT /employees/:id for
// where those stay editable.
router.put('/me', authMiddleware, async (req, res, next) => {
  try {
    const updates = selfProfileUpdateSchema.parse(req.body);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    // avatarKey must be one this user's own upload route could have issued —
    // otherwise a crafted request could point a profile at another company's
    // uploaded file (cross-tenant reference, not a read, but still not a
    // value the schema alone can validate).
    if (updates.avatarKey && !updates.avatarKey.startsWith(`uploads/${req.user.companyId}/`)) {
      return res.status(400).json({ error: 'Invalid avatarKey' });
    }

    const existing = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id: req.user.id },
    }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'User not found' });

    const setClauses = ['updatedAt = :updatedAt'];
    const attrNames = {};
    const attrValues = { ':updatedAt': new Date().toISOString() };
    for (const [key, val] of Object.entries(updates)) {
      attrNames[`#${key}`] = key;
      setClauses.push(`#${key} = :${key}`);
      attrValues[`:${key}`] = val;
    }

    const result = await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id: req.user.id },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
      ReturnValues: 'ALL_NEW',
    }).promise();

    const { password, totpSecret, backupCodes, ...safe } = result.Attributes;

    logAudit(req.user.id, 'self_profile_updated', req.user.email, 'success', req.ip, {
      changes: Object.keys(updates),
    }, req.user.companyId).catch((err) => logger.error('Audit log failed for self_profile_updated', err));

    res.json({ success: true, employee: safe });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/auth/me/avatar-upload-url — presigned S3 PUT URL for own photo ──
// Purpose-built, not a reuse of GET /api/whatsapp/upload-url (B3 finding
// #11) — that route's MIME allowlist/size limit are WhatsApp/Meta-specific
// (5MB, video/audio/documents allowed), wider than a profile photo needs.
// Same key prefix (uploads/{companyId}/...) as the WhatsApp upload flow on
// purpose, so the existing GET /api/whatsapp/s3-url resolver (which only
// accepts uploads/{cid}/* and inbound/{cid}/* keys) can serve the avatar
// back for display too, with zero changes there.
// Maps each allowed MIME type to the exact extension its key gets — the
// extension is derived from this validated mimeType, never from parsing the
// client-supplied filename (which is attacker-controlled and proves nothing
// about the file's real type; a ".jpg" filename can carry any bytes).
const AVATAR_MIME_EXT = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
]);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB — matches ProfileSection's own "JPG, PNG up to 2MB" copy

router.get('/me/avatar-upload-url', authMiddleware, async (req, res, next) => {
  try {
    const { mimeType, filename, fileSize } = req.query;
    // filename is still required for parity with the request shape uploadFileToS3()
    // always sends, but it no longer drives the key's extension — see AVATAR_MIME_EXT.
    if (!mimeType || !filename) return res.status(400).json({ error: 'mimeType and filename required' });
    if (!MEDIA_BUCKET) return res.status(500).json({ error: 'WA_MEDIA_BUCKET env var not set' });
    if (!AVATAR_MIME_EXT.has(mimeType)) return res.status(400).json({ error: 'Only JPG and PNG images are allowed' });
    if (fileSize && Number(fileSize) > AVATAR_MAX_BYTES) {
      return res.status(400).json({ error: 'Avatar must be under 2 MB' });
    }

    const ext = AVATAR_MIME_EXT.get(mimeType);
    const key = `uploads/${req.user.companyId}/${randomUUID()}.${ext}`;

    const uploadUrl = s3Client.getSignedUrl('putObject', {
      Bucket: MEDIA_BUCKET,
      Key: key,
      ContentType: mimeType,
      Expires: 300,
    });

    res.json({ success: true, uploadUrl, key });
  } catch (err) { next(err); }
});

module.exports = router;
