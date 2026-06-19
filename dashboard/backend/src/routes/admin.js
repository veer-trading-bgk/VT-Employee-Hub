const express = require('express');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { encrypt } = require('../utils/encryption');
const { registerSchema, updateEmployeeSchema } = require('../utils/validation');
const dynamodb = require('../config/dynamodb');
const bot = require('../config/telegram');
const logger = require('../config/logger');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

// ── GET /api/admin/employees ──────────────────────────────────────────────────

router.get('/employees', async (req, res, next) => {
  try {
    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      ProjectionExpression: 'id, #name, email, #role, telegramId, createdAt, #status, totpEnabled',
      ExpressionAttributeNames: { '#name': 'name', '#role': 'role', '#status': 'status' },
    }).promise();

    logAudit(req.user.id, 'list_employees', 'employees_table', 'success', req.ip)
      .catch((err) => logger.error('Audit log failed for list_employees', err));

    res.json({ success: true, data: result.Items ?? [] });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/admin/employees/:id ─────────────────────────────────────────────

router.get('/employees/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();

    if (!result.Item) return res.status(404).json({ error: 'Employee not found' });

    const { password, totpSecret, backupCodes, ...safe } = result.Item;
    res.json({ success: true, employee: safe });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/admin/employees ─────────────────────────────────────────────────

router.post('/employees', async (req, res, next) => {
  try {
    const { email, password, name, role, panNumber, aadhaarNumber, homeAddress } = registerSchema.parse(req.body);

    const existing = await dynamodb.query({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      IndexName: 'emailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
    }).promise();

    if (existing.Items.length > 0) {
      return res.status(409).json({ success: false, error: 'Email already registered' });
    }

    const id = `emp_${Date.now()}`;
    const hashedPassword = await bcrypt.hash(password, 10);

    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Item: {
        id,
        email,
        password: hashedPassword,
        name,
        role,
        ...(panNumber     && { panNumber }),
        ...(aadhaarNumber && { aadhaarNumber }),
        ...(homeAddress   && { homeAddress }),
        status: 'active',
        createdAt: new Date().toISOString(),
        createdBy: req.user.id,
        totpEnabled: false,
        totpSecret: null,
        backupCodes: [],
      },
    }).promise();

    logAudit(req.user.id, 'create_employee', email, 'success', req.ip, { name, role })
      .catch((err) => logger.error('Audit log failed for create_employee', err));

    res.status(201).json({ success: true, user: { id, email, name, role } });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/admin/employees/:id ─────────────────────────────────────────────

router.put('/employees/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = updateEmployeeSchema.parse(req.body);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    if (id === req.user.id && updates.status === 'inactive') {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const existing = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();

    const employee = existing.Item;
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    // If email is changing, check for duplicates
    if (updates.email && updates.email !== employee.email) {
      const dupe = await dynamodb.query({
        TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
        IndexName: 'emailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': updates.email },
      }).promise();
      if (dupe.Items.length > 0) {
        return res.status(409).json({ error: 'Email already exists' });
      }
    }

    const now = new Date().toISOString();
    const setClauses = [];
    const attrNames = {};
    const attrValues = { ':updatedAt': now, ':updatedBy': req.user.id };

    for (const [key, val] of Object.entries(updates)) {
      setClauses.push(`#${key} = :${key}`);
      attrNames[`#${key}`] = key;
      attrValues[`:${key}`] = val;
    }
    setClauses.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');

    const result = await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
      ReturnValues: 'ALL_NEW',
    }).promise();

    const updated = result.Attributes;
    const { password: _, totpSecret: __, backupCodes: ___, ...safe } = updated;

    await logAudit(req.user.id, 'employee_updated', employee.email, 'success', req.ip, {
      targetId: id,
      changes: Object.keys(updates),
    });
    logger.info(`Admin ${req.user.email} updated employee ${employee.email}: ${Object.keys(updates).join(', ')}`);

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `✏️ Employee Updated\n\nEmployee: ${employee.email}\nFields: ${Object.keys(updates).join(', ')}\nBy admin: ${req.user.email}`
    ).catch(() => {});

    res.json({ success: true, employee: safe });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/admin/employees/:id/reset-password ───────────────────────────────

router.put('/employees/:id/reset-password', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be 8+ chars with uppercase and number' });
    }

    const existing = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();

    const employee = existing.Item;
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const hashed = await bcrypt.hash(newPassword, 10);

    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
      UpdateExpression: 'SET password = :p, updatedAt = :at, updatedBy = :by',
      ExpressionAttributeValues: {
        ':p': hashed,
        ':at': new Date().toISOString(),
        ':by': req.user.id,
      },
    }).promise();

    await logAudit(req.user.id, 'password_reset', employee.email, 'success', req.ip, { targetId: id });

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `🔑 Password Reset\n\nEmployee: ${employee.email}\nBy admin: ${req.user.email}\nTime: ${new Date().toUTCString()}`
    ).catch(() => {});

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/admin/employees/:id ── permanent hard delete ─────────────────

router.delete('/employees/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const existing = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();

    const employee = existing.Item;
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    await dynamodb.delete({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();

    await logAudit(req.user.id, 'employee_permanently_deleted', employee.email, 'success', req.ip, { targetId: id });
    logger.info(`Admin ${req.user.email} permanently deleted employee ${employee.email}`);

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `🗑️ Employee Permanently Deleted\n\nEmployee: ${employee.email}\nBy admin: ${req.user.email}\nTime: ${new Date().toUTCString()}`
    ).catch(() => {});

    res.json({
      success: true,
      message: 'Employee permanently deleted',
      employee: { id, name: employee.name, email: employee.email },
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/admin/employees/:id/setup-2fa ───────────────────────────────────

router.post('/employees/:id/setup-2fa', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();

    const employee = result.Item;
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    // Generate TOTP secret
    const secret = speakeasy.generateSecret({
      name: `VT Trading (${employee.email})`,
      issuer: 'VT Employee Hub',
      length: 20,
    });

    // Generate QR code as a data URL
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    // Generate 5 backup codes — 8 random uppercase alphanumeric chars each
    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const plainBackupCodes = Array.from({ length: 5 }, () =>
      Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('')
    );

    // Encrypt backup codes before storing
    const encryptedBackupCodes = plainBackupCodes.map((code) => ({
      encryptedCode: encrypt(code),
      used: false,
      usedAt: null,
    }));

    // Persist to DynamoDB
    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
      UpdateExpression: 'SET totpSecret = :s, totpEnabled = :e, backupCodes = :b, totpSetupAt = :at, totpSetupBy = :by',
      ExpressionAttributeValues: {
        ':s': secret.base32,
        ':e': true,
        ':b': encryptedBackupCodes,
        ':at': new Date().toISOString(),
        ':by': req.user.id,
      },
    }).promise();

    await logAudit(req.user.id, 'setup_2fa', employee.email, 'success', req.ip, { targetId: id });
    logger.info(`2FA enabled for ${employee.email} by admin ${req.user.email}`);

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `🔐 2FA Enabled\n\nEmployee: ${employee.email}\nBy admin: ${req.user.email}\nTime: ${new Date().toUTCString()}`
    ).catch(() => {});

    res.json({
      success: true,
      qrCode,
      manualEntryKey: secret.base32,
      backupCodes: plainBackupCodes, // shown once — admin must share with employee
      message: 'Share the QR code or manual entry key with the employee.',
    });
  } catch (error) {
    logger.error('setup-2fa error', error);
    next(error);
  }
});

// ── DELETE /api/admin/employees/:id/2fa ───────────────────────────────────────

router.delete('/employees/:id/2fa', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();

    const employee = result.Item;
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
      UpdateExpression: 'SET totpEnabled = :e, totpSecret = :s, backupCodes = :b, totpResetAt = :at, totpResetBy = :by',
      ExpressionAttributeValues: {
        ':e': false,
        ':s': null,
        ':b': [],
        ':at': new Date().toISOString(),
        ':by': req.user.id,
      },
    }).promise();

    await logAudit(req.user.id, 'reset_2fa', employee.email, 'success', req.ip, { targetId: id });
    logger.info(`2FA reset for ${employee.email} by admin ${req.user.email}`);

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `🔓 2FA Reset\n\nEmployee: ${employee.email}\nBy admin: ${req.user.email}\nTime: ${new Date().toUTCString()}`
    ).catch(() => {});

    res.json({
      success: true,
      message: '2FA disabled for employee. They can re-enroll anytime.',
    });
  } catch (error) {
    logger.error('reset-2fa error', error);
    next(error);
  }
});

// ── Admin: edit a metric entry ────────────────────────────────────────────────
// Admin-edited entries are auto-approved and preserve the original value in audit

router.put('/metrics/:userId/:date/:metricType', async (req, res, next) => {
  try {
    const { userId, date, metricType } = req.params;
    const { value, notes } = req.body;

    if (value === undefined || isNaN(Number(value)) || Number(value) < 0) {
      return res.status(400).json({ error: 'value must be a non-negative number' });
    }

    const existing = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: userId, SK: `${date}#${metricType}` },
    }).promise();
    const originalValue = existing.Item?.value ?? null;

    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: userId, SK: `${date}#${metricType}` },
      UpdateExpression:
        'SET #val = :v, editedBy = :eb, editedAt = :ea, ' +
        'originalValue = if_not_exists(originalValue, :ov), adminNotes = :an, ' +
        'verificationStatus = :vs, verified = :vf',
      ExpressionAttributeNames: { '#val': 'value' },
      ExpressionAttributeValues: {
        ':v': Number(value),
        ':eb': req.user.id,
        ':ea': new Date().toISOString(),
        ':ov': originalValue,
        ':an': notes || '',
        ':vs': 'approved',
        ':vf': true,
      },
    }).promise();

    await logAudit(req.user.id, 'admin_edit_metric', `${userId}#${date}#${metricType}`, 'success', req.ip, {
      from: originalValue, to: Number(value),
    });
    logger.info(`Admin ${req.user.email} edited ${metricType} for ${userId} on ${date}: ${originalValue} → ${Number(value)}`);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ── Admin: targets CRUD ───────────────────────────────────────────────────────

const TARGETS_KEY = { PK: 'CONFIG#TARGETS', SK: 'current' };

const TARGET_DEFAULTS = {
  kyc:         { target: 4,      targetPeriod: 'day'   },
  demat:       { target: 50,     targetPeriod: 'month' },
  mf:          { target: 40,     targetPeriod: 'month' },
  insurance:   { target: 100000, targetPeriod: 'month' },
  algo:        { target: 10,     targetPeriod: 'month' },
  coaching:    { target: 20000,  targetPeriod: 'month' },
  pms:         { target: 10,     targetPeriod: 'month' },
  pro_insight: { target: 15,     targetPeriod: 'month' },
  ltpp:        { target: 10,     targetPeriod: 'month' },
};

router.get('/targets', async (req, res, next) => {
  try {
    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: TARGETS_KEY,
    }).promise();
    res.json({
      success: true,
      data: result.Item?.targets ?? TARGET_DEFAULTS,
      isCustom: !!result.Item,
    });
  } catch (error) {
    next(error);
  }
});

router.put('/targets', async (req, res, next) => {
  try {
    const { targets } = req.body;
    if (!targets || typeof targets !== 'object') {
      return res.status(400).json({ error: 'targets object required' });
    }
    const VALID_KEYS = ['kyc', 'demat', 'mf', 'insurance', 'algo', 'coaching', 'pms', 'pro_insight', 'ltpp'];
    for (const [key, val] of Object.entries(targets)) {
      if (!VALID_KEYS.includes(key)) return res.status(400).json({ error: `Unknown metric: ${key}` });
      if (typeof val.target !== 'number' || val.target <= 0 || !['day', 'month'].includes(val.targetPeriod)) {
        return res.status(400).json({ error: `Invalid target config for ${key}` });
      }
    }
    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Item: { ...TARGETS_KEY, targets, updatedBy: req.user.id, updatedAt: new Date().toISOString() },
    }).promise();
    await logAudit(req.user.id, 'update_targets', 'config', 'success', req.ip, { targets });
    logger.info(`Admin ${req.user.email} updated metric targets`);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/targets', async (req, res, next) => {
  try {
    await dynamodb.delete({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: TARGETS_KEY,
    }).promise();
    await logAudit(req.user.id, 'reset_targets', 'config', 'success', req.ip);
    res.json({ success: true, message: 'Targets reset to defaults' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
