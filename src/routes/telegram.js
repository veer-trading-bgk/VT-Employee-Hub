const express = require('express');
const bcrypt = require('bcryptjs');
const { Telegraf } = require('telegraf');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const { addMetricSchema } = require('../utils/validation');

const router = express.Router();

const METRIC_LABELS = {
  kyc: 'KYC completions',
  demat: 'Demat accounts',
  mf: 'MF sales',
  insurance: 'Insurance premium',
  revenue: 'Daily revenue'
};

const HELP_TEXT = [
  '🤖 *VT Employee Bot - Commands*',
  '',
  '/link <email> <password> - Link your Telegram to your account',
  '/add_kyc <count> - Log KYC completions',
  '/add_demat <count> - Log Demat accounts opened',
  '/add_mf <count> - Log MF sales',
  '/add_insurance <amount> - Log insurance premium collected',
  '/add_revenue <amount> - Log daily revenue',
  '/my_summary - View today\'s logged metrics',
  '/help - Show this message'
].join('\n');

// Find the employee linked to this Telegram chat
const findEmployeeByChatId = async (chatId) => {
  const result = await dynamodb.scan({
    TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
    FilterExpression: 'telegramChatId = :chatId',
    ExpressionAttributeValues: { ':chatId': String(chatId) }
  }).promise();

  return result.Items && result.Items[0];
};

const findEmployeeByEmail = async (email) => {
  const result = await dynamodb.query({
    TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
    IndexName: 'emailIndex',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email }
  }).promise();

  return result.Items && result.Items[0];
};

// Shared metric-logging logic (mirrors POST /api/metrics/add)
const recordMetric = async (ctx, employee, metricType, rawValue) => {
  const value = Number(rawValue);
  const parsed = addMetricSchema.safeParse({ metric_type: metricType, value });

  if (!parsed.success) {
    return ctx.reply(`❌ Invalid value: ${parsed.error.issues[0].message}`);
  }

  const metricDate = new Date().toISOString().split('T')[0];
  const userId = employee.id;

  if (value > 100 && metricType === 'kyc') {
    await logAudit(userId, 'suspicious_metric_entry', metricType, 'flagged', 'telegram', { value });
    await ctx.telegram.sendMessage(
      process.env.TELEGRAM_ADMIN_CHAT_ID,
      `⚠️ Suspicious Metric Entry\n\nUser: ${employee.email}\nMetric: ${metricType}\nValue: ${value}\nSource: Telegram\n\nPlease verify this entry.`
    );
  }

  await dynamodb.put({
    TableName: process.env.DYNAMODB_TABLE_METRICS,
    Item: {
      PK: userId,
      SK: `${metricDate}#${metricType}`,
      metricId: `${userId}#${metricDate}#${metricType}`,
      userId,
      metric_type: metricType,
      value,
      date: metricDate,
      enteredAt: new Date().toISOString(),
      enteredFrom: 'telegram',
      verified: false
    }
  }).promise();

  await logAudit(userId, 'metric_added', `${metricType}=${value}`, 'success', 'telegram');
  logger.info(`Metric added via Telegram: ${metricType}=${value} for ${employee.email}`);

  return ctx.reply(`✅ ${METRIC_LABELS[metricType]} recorded: ${value}`);
};

let bot;

if (process.env.TELEGRAM_BOT_TOKEN) {
  bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  // Telegraf calls `bot.getMe()` on the first update it ever processes, to
  // cache `botInfo` (used to strip @mentions from commands in group chats).
  // That's an outbound call to api.telegram.org - unnecessary extra latency
  // on every cold start, and fatal if that network path is ever flaky/down
  // (this value never changes for a given bot, so there's nothing to gain by
  // fetching it live). Pre-seed it with the bot's real identity instead, so
  // Telegraf's internal `this.botInfo ?? (this.botInfo = await getMe())`
  // check short-circuits and skips the network call entirely.
  bot.botInfo = {
    id: 8823511433,
    is_bot: true,
    first_name: 'VT Employee Hub',
    username: 'vt_employee_hub_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false
  };

  // Require a linked employee account before allowing metric commands
  const requireEmployee = async (ctx, next) => {
    const employee = await findEmployeeByChatId(ctx.chat.id);
    if (!employee) {
      await ctx.reply('⚠️ Your Telegram account isn\'t linked yet. Use:\n/link <email> <password>');
      return;
    }
    ctx.employee = employee;
    return next();
  };

  bot.use((ctx, next) => {
    // Log update type only — never log message text (may contain passwords from /link)
    const updateType = Object.keys(ctx.update).filter((k) => k !== 'update_id').join(',') || 'unknown';
    logger.info(`Telegram update: id=${ctx.update.update_id} type=${updateType} chat=${ctx.chat?.id ?? 'n/a'}`);
    return next();
  });

  bot.command('help', (ctx) => {
    logger.info('Matched /help command');
    return ctx.replyWithMarkdown(HELP_TEXT);
  });
  bot.start((ctx) => ctx.replyWithMarkdown(`Welcome to VT Employee Bot!\n\n${HELP_TEXT}`));

  bot.command('link', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [email, password] = args;

    if (!email || !password) {
      return ctx.reply('Usage: /link <email> <password>');
    }

    try {
      const employee = await findEmployeeByEmail(email);
      if (!employee) {
        return ctx.reply('❌ No account found with that email.');
      }

      const isValid = await bcrypt.compare(password, employee.password);
      if (!isValid) {
        await logAudit(employee.id, 'failed_telegram_link', email, 'invalid_password', 'telegram');
        return ctx.reply('❌ Invalid credentials.');
      }

      await dynamodb.update({
        TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
        Key: { id: employee.id },
        UpdateExpression: 'SET telegramChatId = :chatId, telegramLinkedAt = :linkedAt',
        ExpressionAttributeValues: {
          ':chatId': String(ctx.chat.id),
          ':linkedAt': new Date().toISOString()
        }
      }).promise();

      await logAudit(employee.id, 'telegram_linked', email, 'success', 'telegram');
      logger.info(`Telegram linked for ${email}`);

      return ctx.reply(`✅ Linked! Welcome, ${employee.name}.\n\n${HELP_TEXT}`);
    } catch (error) {
      logger.error('Telegram /link failed', error);
      return ctx.reply('❌ Something went wrong. Please try again.');
    }
  });

  const metricCommand = (command, metricType) => {
    bot.command(command, requireEmployee, async (ctx) => {
      const value = ctx.message.text.split(' ')[1];
      if (value === undefined) {
        return ctx.reply(`Usage: /${command} <${metricType === 'insurance' || metricType === 'revenue' ? 'amount' : 'count'}>`);
      }
      try {
        await recordMetric(ctx, ctx.employee, metricType, value);
      } catch (error) {
        logger.error(`Telegram /${command} failed`, error);
        await ctx.reply('❌ Failed to record metric. Please try again.');
      }
    });
  };

  metricCommand('add_kyc', 'kyc');
  metricCommand('add_demat', 'demat');
  metricCommand('add_mf', 'mf');
  metricCommand('add_insurance', 'insurance');
  metricCommand('add_revenue', 'revenue');

  bot.command('my_summary', requireEmployee, async (ctx) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const result = await dynamodb.query({
        TableName: process.env.DYNAMODB_TABLE_METRICS,
        KeyConditionExpression: 'PK = :uid AND begins_with(SK, :today)',
        ExpressionAttributeValues: {
          ':uid': ctx.employee.id,
          ':today': today
        }
      }).promise();

      if (!result.Items || result.Items.length === 0) {
        return ctx.reply(`📊 No metrics logged today (${today}) yet.`);
      }

      const lines = result.Items.map(
        (item) => `• ${METRIC_LABELS[item.metric_type] || item.metric_type}: ${item.value}`
      );

      await logAudit(ctx.employee.id, 'view_own_metrics_telegram', 'my_summary', 'success', 'telegram');

      return ctx.replyWithMarkdown(`📊 *Today's Summary (${today})*\n\n${lines.join('\n')}`);
    } catch (error) {
      logger.error('Telegram /my_summary failed', error);
      return ctx.reply('❌ Failed to fetch summary. Please try again.');
    }
  });

  bot.catch((err, ctx) => {
    logger.error(`Telegram bot error for update ${ctx.update.update_id}`, err);
  });

  // Telegram delivers updates here via webhook
  const webhookHandler = bot.webhookCallback('/webhook');
  router.use((req, res, next) => {
    logger.info(`Telegram webhook request: method=${req.method} url=${req.url}`);
    return webhookHandler(req, res, next);
  });
} else {
  logger.warn('TELEGRAM_BOT_TOKEN not set - Telegram webhook route disabled');
}

module.exports = router;
module.exports.bot = bot;
