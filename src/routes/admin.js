const express = require('express');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const { queryAll } = require('../utils/db');
const { logAudit } = require('../utils/audit');
const { encrypt } = require('../utils/encryption');
const { registerSchema, updateEmployeeSchema } = require('../utils/validation');
const { METRIC_CONFIG, TARGET_DEFAULTS, METRIC_KEYS, toDailyTargets, toMonthlyTargets, calcPoints, emptyTotals, buildCustomWeights } = require('../config/metricsConfig');
const dynamodb = require('../config/dynamodb');
const bot = require('../config/telegram');
const logger = require('../config/logger');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

// ── GET /api/admin/employees ──────────────────────────────────────────────────

router.get('/employees', async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const TABLE = process.env.DYNAMODB_TABLE_EMPLOYEES;
    const PROJ = 'id, #name, email, mobileNumber, #role, telegramId, createdAt, #status, totpEnabled';
    const NAMES = { '#name': 'name', '#role': 'role', '#status': 'status' };

    let items;
    if (companyId) {
      items = await queryAll({
        TableName: TABLE,
        IndexName: 'companyIdIndex',
        KeyConditionExpression: 'companyId = :cid',
        FilterExpression: 'attribute_not_exists(#type)',
        ProjectionExpression: PROJ,
        ExpressionAttributeNames: { ...NAMES, '#type': 'type' },
        ExpressionAttributeValues: { ':cid': companyId },
      });
    } else {
      const r = await dynamodb.scan({ TableName: TABLE, ProjectionExpression: PROJ, ExpressionAttributeNames: NAMES }).promise();
      items = r.Items ?? [];
    }

    logAudit(req.user.id, 'list_employees', 'employees_table', 'success', req.ip, {}, req.user.companyId)
      .catch((err) => logger.error('Audit log failed for list_employees', err));

    res.json({ success: true, data: items });
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

    if (req.user.role !== 'superadmin' && result.Item.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { password, totpSecret, backupCodes, ...safe } = result.Item;
    res.json({ success: true, employee: safe });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/admin/employees ─────────────────────────────────────────────────

router.post('/employees', rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { email, password, name, role, mobileNumber, panNumber, aadhaarNumber, homeAddress } = registerSchema.parse(req.body);

    // Only an Owner (raw superadmin) may grant the admin role — an admin
    // creating another admin is the privilege-escalation path
    // docs/v3/09_PERMISSION_MATRIX.md:292,330-332 documents as blocked.
    if (role === 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only a superadmin can assign the admin role' });
    }

    const existing = await dynamodb.query({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      IndexName: 'emailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
    }).promise();

    // FIX 2: email uniqueness is per-company — same email allowed in different companies
    const sameCompanyDupe = existing.Items.find((e) => e.companyId === req.user.companyId);
    if (sameCompanyDupe) {
      return res.status(409).json({ success: false, error: 'Email already registered in this company' });
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
        ...(req.user.companyId && { companyId: req.user.companyId }),
        ...(mobileNumber  && { mobileNumber }),
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

    logAudit(req.user.id, 'create_employee', email, 'success', req.ip, { name, role }, req.user.companyId)
      .catch((err) => logger.error('Audit log failed for create_employee', err));

    res.status(201).json({ success: true, user: { id, email, name, role } });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/admin/employees/:id ─────────────────────────────────────────────

router.put('/employees/:id', rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = updateEmployeeSchema.parse(req.body);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    // Only an Owner (raw superadmin) may grant the admin role — same
    // escalation boundary as POST /employees above. Role changes AWAY from
    // admin are not blocked here: demotion isn't a privilege escalation, and
    // docs/v3/09_PERMISSION_MATRIX.md:292,330-332 documents this boundary
    // specifically as "can't create Admin," not "can't change an Admin."
    if (updates.role === 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only a superadmin can assign the admin role' });
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

    if (req.user.role !== 'superadmin' && employee.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (updates.email && updates.email !== employee.email) {
      const dupe = await dynamodb.query({
        TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
        IndexName: 'emailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': updates.email },
      }).promise();
      // FIX 2: email uniqueness is per-company
      const sameCompanyDupe = dupe.Items.find((e) => e.companyId === req.user.companyId && e.id !== id);
      if (sameCompanyDupe) {
        return res.status(409).json({ error: 'Email already exists in this company' });
      }
    }

    const now = new Date().toISOString();
    const setClauses = [];
    const removeClauses = [];
    const attrNames = {};
    const attrValues = { ':updatedAt': now, ':updatedBy': req.user.id };

    for (const [key, val] of Object.entries(updates)) {
      attrNames[`#${key}`] = key;
      if (val === null) {
        // null means "remove this field" (e.g. clearing teamLeadId assignment)
        removeClauses.push(`#${key}`);
      } else {
        setClauses.push(`#${key} = :${key}`);
        attrValues[`:${key}`] = val;
      }
    }
    setClauses.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');

    const updateParts = [`SET ${setClauses.join(', ')}`];
    if (removeClauses.length > 0) updateParts.push(`REMOVE ${removeClauses.join(', ')}`);

    const result = await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
      UpdateExpression: updateParts.join(' '),
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
      ReturnValues: 'ALL_NEW',
    }).promise();

    const updated = result.Attributes;
    const { password: _, totpSecret: __, backupCodes: ___, ...safe } = updated;

    await logAudit(req.user.id, 'employee_updated', employee.email, 'success', req.ip, {
      targetId: id,
      changes: Object.keys(updates),
    }, req.user.companyId);
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

router.put('/employees/:id/reset-password', rateLimit(10, 60_000), async (req, res, next) => {
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

    if (req.user.role !== 'superadmin' && employee.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

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

    await logAudit(req.user.id, 'password_reset', employee.email, 'success', req.ip, { targetId: id }, req.user.companyId);

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `🔑 Password Reset\n\nEmployee: ${employee.email}\nBy admin: ${req.user.email}\nTime: ${new Date().toUTCString()}`
    ).catch(() => {});

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/admin/employees/:id ── hard delete + cascade metrics ──────────

router.delete('/employees/:id', rateLimit(10, 60_000), async (req, res, next) => {
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

    if (req.user.role !== 'superadmin' && employee.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Cascade: delete all metric records for this employee
    let metricsDeleted = 0;
    let lastKey;
    do {
      const metricsResult = await dynamodb.query({
        TableName: process.env.DYNAMODB_TABLE_METRICS,
        KeyConditionExpression: 'PK = :uid',
        ExpressionAttributeValues: { ':uid': id },
        ProjectionExpression: 'PK, SK',
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }).promise();

      const items = metricsResult.Items ?? [];
      // DynamoDB batchWrite accepts max 25 items at a time
      for (let i = 0; i < items.length; i += 25) {
        const chunk = items.slice(i, i + 25);
        await dynamodb.batchWrite({
          RequestItems: {
            [process.env.DYNAMODB_TABLE_METRICS]: chunk.map((item) => ({
              DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
            })),
          },
        }).promise();
        metricsDeleted += chunk.length;
      }
      lastKey = metricsResult.LastEvaluatedKey;
    } while (lastKey);

    // Delete employee record
    await dynamodb.delete({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();

    await logAudit(req.user.id, 'employee_permanently_deleted', employee.email, 'success', req.ip, {
      targetId: id,
      metricsDeleted,
    }, req.user.companyId);
    logger.info(`Admin ${req.user.email} permanently deleted employee ${employee.email} + ${metricsDeleted} metric records`);

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `🗑️ Employee Permanently Deleted\n\nEmployee: ${employee.email}\nMetric records purged: ${metricsDeleted}\nBy admin: ${req.user.email}\nTime: ${new Date().toUTCString()}`
    ).catch(() => {});

    res.json({
      success: true,
      message: `Employee permanently deleted (${metricsDeleted} metric records purged)`,
      employee: { id, name: employee.name, email: employee.email },
      metricsDeleted,
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/admin/employees/:id/setup-2fa ───────────────────────────────────

router.post('/employees/:id/setup-2fa', rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();

    const employee = result.Item;
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    if (req.user.role !== 'superadmin' && employee.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const secret = speakeasy.generateSecret({
      name: `VT Trading (${employee.email})`,
      issuer: 'VT Employee Hub',
      length: 20,
    });

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const plainBackupCodes = Array.from({ length: 5 }, () =>
      Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('')
    );

    const encryptedBackupCodes = plainBackupCodes.map((code) => ({
      encryptedCode: encrypt(code),
      used: false,
      usedAt: null,
    }));

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

    await logAudit(req.user.id, 'setup_2fa', employee.email, 'success', req.ip, { targetId: id }, req.user.companyId);
    logger.info(`2FA enabled for ${employee.email} by admin ${req.user.email}`);

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `🔐 2FA Enabled\n\nEmployee: ${employee.email}\nBy admin: ${req.user.email}\nTime: ${new Date().toUTCString()}`
    ).catch(() => {});

    res.json({
      success: true,
      qrCode,
      manualEntryKey: secret.base32,
      backupCodes: plainBackupCodes,
      message: 'Share the QR code or manual entry key with the employee.',
    });
  } catch (error) {
    logger.error('setup-2fa error', error);
    next(error);
  }
});

// ── DELETE /api/admin/employees/:id/2fa ───────────────────────────────────────

router.delete('/employees/:id/2fa', rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();

    const employee = result.Item;
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    if (req.user.role !== 'superadmin' && employee.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

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

    await logAudit(req.user.id, 'reset_2fa', employee.email, 'success', req.ip, { targetId: id }, req.user.companyId);
    logger.info(`2FA reset for ${employee.email} by admin ${req.user.email}`);

    bot.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `🔓 2FA Reset\n\nEmployee: ${employee.email}\nBy admin: ${req.user.email}\nTime: ${new Date().toUTCString()}`
    ).catch(() => {});

    res.json({ success: true, message: '2FA disabled for employee. They can re-enroll anytime.' });
  } catch (error) {
    logger.error('reset-2fa error', error);
    next(error);
  }
});

// ── PUT /api/admin/metrics/:userId/:date/:metricType ──────────────────────────

router.put('/metrics/:userId/:date/:metricType', rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { userId, date, metricType } = req.params;
    const { value, notes } = req.body;

    if (value === undefined || isNaN(Number(value)) || Number(value) < 0) {
      return res.status(400).json({ error: 'value must be a non-negative number' });
    }

    if (!METRIC_KEYS.includes(metricType)) {
      return res.status(400).json({ error: `Unknown metric: ${metricType}` });
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
    }, req.user.companyId);
    logger.info(`Admin ${req.user.email} edited ${metricType} for ${userId} on ${date}: ${originalValue} → ${Number(value)}`);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ── Targets CRUD ──────────────────────────────────────────────────────────────

function targetsKey(companyId) {
  return { PK: companyId ? `CONFIG#TARGETS#${companyId}` : 'CONFIG#TARGETS', SK: 'current' };
}

router.get('/targets', async (req, res, next) => {
  try {
    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: targetsKey(req.user.companyId),
    }).promise();
    const storedTargets = result.Item?.targets ?? TARGET_DEFAULTS;
    // Extract pointsWeights from stored targets so frontend can show current values
    const pointsWeights = {};
    Object.entries(storedTargets).forEach(([k, v]) => {
      if (v && v.pointsWeight != null) pointsWeights[k] = v.pointsWeight;
    });
    res.json({
      success: true,
      data: storedTargets,
      pointsWeights: Object.keys(pointsWeights).length ? pointsWeights : null,
      isCustom: !!result.Item,
    });
  } catch (error) {
    next(error);
  }
});

router.put('/targets', rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { targets } = req.body;
    if (!targets || typeof targets !== 'object') {
      return res.status(400).json({ error: 'targets object required' });
    }
    for (const [key, val] of Object.entries(targets)) {
      if (!METRIC_KEYS.includes(key)) return res.status(400).json({ error: `Unknown metric: ${key}` });
      if (typeof val.target !== 'number' || val.target <= 0 || !['day', 'month'].includes(val.targetPeriod)) {
        return res.status(400).json({ error: `Invalid target config for ${key}` });
      }
      if (val.pointsWeight !== undefined && (typeof val.pointsWeight !== 'number' || val.pointsWeight <= 0)) {
        return res.status(400).json({ error: `pointsWeight for ${key} must be a positive number` });
      }
    }
    const mergedTargets = { ...TARGET_DEFAULTS, ...targets };
    const key = targetsKey(req.user.companyId);
    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Item: { ...key, targets: mergedTargets, updatedBy: req.user.id, updatedAt: new Date().toISOString() },
    }).promise();
    await logAudit(req.user.id, 'update_targets', 'config', 'success', req.ip, { targets }, req.user.companyId);
    logger.info(`Admin ${req.user.email} updated metric targets`);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/targets', rateLimit(20, 60_000), async (req, res, next) => {
  try {
    await dynamodb.delete({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: targetsKey(req.user.companyId),
    }).promise();
    await logAudit(req.user.id, 'reset_targets', 'config', 'success', req.ip, {}, req.user.companyId);
    res.json({ success: true, message: 'Targets reset to defaults' });
  } catch (error) {
    next(error);
  }
});

// ── Points rebuild — recalculate stored TOTAL records from raw metric data ─────

router.post('/points-rebuild', adminMiddleware, rateLimit(5, 60_000), async (req, res, next) => {
  try {
    const { companyId } = req.user;

    // Fetch current target config to get any custom pointsWeights
    const cfgResult = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: targetsKey(companyId),
    }).promise();
    const targetCfg = cfgResult.Item?.targets ?? TARGET_DEFAULTS;

    // Scan all metric entries for this company
    const scanParams = {
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      FilterExpression: 'attribute_exists(metric_type) AND attribute_exists(userId)',
    };
    if (companyId) {
      scanParams.FilterExpression += ' AND companyId = :cid';
      scanParams.ExpressionAttributeValues = { ':cid': companyId };
    }
    const allMetrics = [];
    let lastKey;
    do {
      const result = await dynamodb.scan({ ...scanParams, ...(lastKey && { ExclusiveStartKey: lastKey }) }).promise();
      allMetrics.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Accumulate RAW per-metric-type totals per user first, then run each user's totals
    // through calcPoints() once — the same function metrics.js's /leaderboard and
    // points.js's /award now use, so all three points surfaces agree on one formula.
    // (Summing raw values before rounding, rather than rounding per metric entry,
    // exactly preserves this endpoint's own prior sum-then-round behavior.)
    const customWeights = buildCustomWeights(targetCfg);

    const userMetricTotals = {};
    allMetrics.forEach((item) => {
      if (!item.userId || !item.metric_type) return;
      if (item.verificationStatus === 'rejected') return;
      if (!METRIC_CONFIG[item.metric_type]) return;
      if (!userMetricTotals[item.userId]) userMetricTotals[item.userId] = emptyTotals();
      userMetricTotals[item.userId][item.metric_type] += item.value || 0;
    });

    const userTotals = {};
    Object.entries(userMetricTotals).forEach(([userId, totals]) => {
      userTotals[userId] = calcPoints(totals, customWeights);
    });

    const BADGES_TABLE = process.env.DYNAMODB_TABLE_BADGES || 'vt-badges';

    // Delete existing TOTAL records
    const existing = await dynamodb.scan({
      TableName: BADGES_TABLE,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'TOTAL' },
    }).promise();
    await Promise.all(
      (existing.Items ?? []).map((item) =>
        dynamodb.delete({ TableName: BADGES_TABLE, Key: { PK: item.PK, SK: 'TOTAL' } }).promise()
      )
    );

    // Write recalculated TOTAL records
    await Promise.all(
      Object.entries(userTotals).map(([userId, total]) =>
        dynamodb.put({
          TableName: BADGES_TABLE,
          Item: { PK: `POINTS#${userId}`, SK: 'TOTAL', userId, total, rebuiltAt: new Date().toISOString() },
        }).promise()
      )
    );

    await logAudit(req.user.id, 'points_rebuild', 'all', 'success', req.ip, { employees: Object.keys(userTotals).length }, req.user.companyId);
    logger.info(`Admin ${req.user.email} rebuilt points for ${Object.keys(userTotals).length} employees`);
    res.json({ success: true, employeesUpdated: Object.keys(userTotals).length });
  } catch (error) {
    logger.error('points-rebuild error', error);
    next(error);
  }
});

// ── CRM Auto-Assign Config ────────────────────────────────────────────────────

function autoAssignKey(companyId) {
  return { PK: `CONFIG#AUTOASSIGN#${companyId}`, SK: 'current' };
}

router.get('/crm/auto-assign', async (req, res, next) => {
  try {
    const r = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: autoAssignKey(req.user.companyId),
    }).promise();
    res.json({ success: true, data: r.Item ?? { enabled: false } });
  } catch (err) { next(err); }
});

router.put('/crm/auto-assign', rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { enabled, capacity, overflow, pools } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) required' });
    }
    if (capacity !== undefined && (typeof capacity !== 'number' || capacity < 1 || capacity > 50)) {
      return res.status(400).json({ error: 'capacity must be 1–50' });
    }
    if (overflow !== undefined && !['assign', 'unassigned'].includes(overflow)) {
      return res.status(400).json({ error: 'overflow must be assign or unassigned' });
    }
    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Item: {
        ...autoAssignKey(req.user.companyId),
        enabled,
        capacity: capacity ?? 5,
        overflow: overflow ?? 'assign',
        pools: pools ?? {},
        updatedBy: req.user.id,
        updatedAt: new Date().toISOString(),
      },
    }).promise();
    await logAudit(req.user.id, 'crm_auto_assign_update', `enabled:${enabled}`, 'success', req.ip, { capacity, overflow }, req.user.companyId);
    logger.info(`Admin ${req.user.email} updated CRM auto-assign: enabled=${enabled}, capacity=${capacity ?? 5}`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/admin/employees/:id/metrics ─────────────────────────────────────
// Per-employee metrics history for performance export

router.get('/employees/:id/metrics', async (req, res, next) => {
  try {
    const { id } = req.params;
    const daysBack = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const employee = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id },
    }).promise();
    if (!employee.Item) return res.status(404).json({ error: 'Employee not found' });

    if (req.user.role !== 'superadmin' && employee.Item.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await dynamodb.query({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      KeyConditionExpression: 'PK = :uid AND SK >= :start',
      ExpressionAttributeValues: { ':uid': id, ':start': startDate },
    }).promise();

    const byDate = {};
    (result.Items ?? []).forEach((item) => {
      if (!item.metric_type || !METRIC_KEYS.includes(item.metric_type)) return;
      const d = item.date || item.SK?.split('#')[0] || '';
      if (!byDate[d]) byDate[d] = {};
      byDate[d][item.metric_type] = (byDate[d][item.metric_type] || 0) + (item.value || 0);
    });

    const { password, totpSecret, backupCodes, ...safeEmployee } = employee.Item;

    res.json({
      success: true,
      employee: safeEmployee,
      data: byDate,
      totalRecords: result.Items?.length ?? 0,
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/admin/employees/bulk-status ─────────────────────────────────────
// Bulk activate/deactivate employees

router.post('/employees/bulk-status', rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or inactive' });
    }

    const selfIdx = ids.indexOf(req.user.id);
    if (selfIdx !== -1 && status === 'inactive') {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const now = new Date().toISOString();
    const results = await Promise.allSettled(
      ids.map((id) =>
        dynamodb.update({
          TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
          Key: { id },
          UpdateExpression: 'SET #status = :s, updatedAt = :at, updatedBy = :by',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':s': status, ':at': now, ':by': req.user.id },
        }).promise()
      )
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;

    await logAudit(req.user.id, 'bulk_status_update', `${ids.length}_employees`, 'success', req.ip, {
      status, succeeded, failed,
    }, req.user.companyId);

    res.json({ success: true, succeeded, failed, total: ids.length });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/admin/employees/bulk ─────────────────────────────────────────
// Bulk delete employees + cascade their metrics

router.delete('/employees/bulk', rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    if (ids.includes(req.user.id)) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    let totalMetricsDeleted = 0;
    const deleted = [];
    const errors = [];

    for (const id of ids) {
      try {
        const emp = await dynamodb.get({
          TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
          Key: { id },
        }).promise();

        if (!emp.Item) { errors.push({ id, error: 'Not found' }); continue; }

        // Cascade delete metrics
        let lastKey;
        let metricsDeleted = 0;
        do {
          const metricsResult = await dynamodb.query({
            TableName: process.env.DYNAMODB_TABLE_METRICS,
            KeyConditionExpression: 'PK = :uid',
            ExpressionAttributeValues: { ':uid': id },
            ProjectionExpression: 'PK, SK',
            ...(lastKey && { ExclusiveStartKey: lastKey }),
          }).promise();
          for (let i = 0; i < (metricsResult.Items ?? []).length; i += 25) {
            const chunk = metricsResult.Items.slice(i, i + 25);
            await dynamodb.batchWrite({
              RequestItems: {
                [process.env.DYNAMODB_TABLE_METRICS]: chunk.map((item) => ({
                  DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
                })),
              },
            }).promise();
            metricsDeleted += chunk.length;
          }
          lastKey = metricsResult.LastEvaluatedKey;
        } while (lastKey);

        await dynamodb.delete({
          TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
          Key: { id },
        }).promise();

        totalMetricsDeleted += metricsDeleted;
        deleted.push(id);
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }

    await logAudit(req.user.id, 'bulk_delete_employees', `${deleted.length}_employees`, 'success', req.ip, {
      deleted, totalMetricsDeleted,
    }, req.user.companyId);

    res.json({ success: true, deleted: deleted.length, errors, totalMetricsDeleted });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
