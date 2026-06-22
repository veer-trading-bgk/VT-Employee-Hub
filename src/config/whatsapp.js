const axios = require('axios');
const logger = require('./logger');

const BASE_URL = 'https://graph.facebook.com/v19.0';

async function sendTextMessage(to, body) {
  const phoneId = process.env.META_PHONE_NUMBER_ID;
  const token = process.env.META_WHATSAPP_TOKEN;
  if (!phoneId || !token) {
    logger.warn('WhatsApp env vars not set — skipping send');
    return null;
  }
  // Normalise to E.164 without leading +
  const phone = String(to).replace(/\D/g, '');
  try {
    const res = await axios.post(
      `${BASE_URL}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'text',
        text: { preview_url: false, body },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return res.data?.messages?.[0]?.id ?? null;
  } catch (err) {
    logger.error('WhatsApp sendTextMessage failed', err?.response?.data ?? err.message);
    throw err;
  }
}

async function sendTemplateMessage(to, templateName, languageCode = 'en', components = []) {
  const phoneId = process.env.META_PHONE_NUMBER_ID;
  const token = process.env.META_WHATSAPP_TOKEN;
  if (!phoneId || !token) return null;
  const phone = String(to).replace(/\D/g, '');
  try {
    const res = await axios.post(
      `${BASE_URL}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: { name: templateName, language: { code: languageCode }, components },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return res.data?.messages?.[0]?.id ?? null;
  } catch (err) {
    logger.error('WhatsApp sendTemplateMessage failed', err?.response?.data ?? err.message);
    throw err;
  }
}

module.exports = { sendTextMessage, sendTemplateMessage };
