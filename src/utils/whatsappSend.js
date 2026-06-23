const axios = require('axios');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const GRAPH = 'https://graph.facebook.com/v19.0';
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

async function getWabaConfig(companyId) {
  const result = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
  }).promise();
  return result.Item ?? null;
}

async function sendText(companyId, to, body) {
  const cfg = await getWabaConfig(companyId);
  if (!cfg?.accessToken || !cfg?.phoneNumberId) return null;
  const phone = String(to).replace(/\D/g, '');
  try {
    const res = await axios.post(
      `${GRAPH}/${cfg.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text', text: { preview_url: false, body } },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } }
    );
    return res.data?.messages?.[0]?.id ?? null;
  } catch (err) {
    logger.error('sendText failed', err?.response?.data ?? err.message);
    throw err;
  }
}

async function sendTemplate(companyId, to, templateName, languageCode, bodyParams) {
  const cfg = await getWabaConfig(companyId);
  if (!cfg?.accessToken || !cfg?.phoneNumberId) return null;
  const phone = String(to).replace(/\D/g, '');
  const components = bodyParams?.length
    ? [{ type: 'body', parameters: bodyParams.map((v) => ({ type: 'text', text: String(v) })) }]
    : [];
  try {
    const res = await axios.post(
      `${GRAPH}/${cfg.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: { name: templateName, language: { code: languageCode ?? 'en' }, components },
      },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } }
    );
    return res.data?.messages?.[0]?.id ?? null;
  } catch (err) {
    logger.error('sendTemplate failed', err?.response?.data ?? err.message);
    throw err;
  }
}

module.exports = { getWabaConfig, sendText, sendTemplate };
