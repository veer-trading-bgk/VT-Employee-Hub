const dynamodb = require('../config/dynamodb');
const bot = require('../config/telegram');
const logger = require('../config/logger');

const logAudit = async (userId, action, target, result, ip, details = {}) => {
  try {
    const timestamp = new Date().toISOString();
    
    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      Item: {
        PK: `audit#${Date.now()}`,
        SK: `user#${userId}`,
        userId,
        action,
        target,
        result,
        ip,
        timestamp,
        details
      }
    }).promise();

    logger.info(`Audit log: ${action} by ${userId} - ${result}`);

    // Alert on sensitive actions
    if (['delete_employee', 'change_incentive', 'export_data'].includes(action)) {
      const message = `🔐 Admin Action Alert\n\nAction: ${action}\nTarget: ${target}\nResult: ${result}\nIP: ${ip}\nTime: ${timestamp}`;
      
      bot.sendMessage(process.env.TELEGRAM_ADMIN_CHAT_ID, message).catch(err => {
        logger.error('Failed to send Telegram alert', err);
      });
    }

    return true;
  } catch (error) {
    logger.error('Failed to log audit', error);
    throw error;
  }
};

const getAuditLogs = async (userId = null, hoursBack = 24) => {
  try {
    const startPK = `audit#${Date.now() - hoursBack * 60 * 60 * 1000}`;

    const params = {
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      FilterExpression: userId
        ? 'PK > :pk AND SK = :sk'
        : 'PK > :pk',
      ExpressionAttributeValues: userId
        ? { ':pk': startPK, ':sk': `user#${userId}` }
        : { ':pk': startPK },
      Limit: 100,
    };

    const result = await dynamodb.scan(params).promise();
    return result.Items || [];
  } catch (error) {
    logger.error('Failed to fetch audit logs', error);
    throw error;
  }
};

module.exports = { logAudit, getAuditLogs };