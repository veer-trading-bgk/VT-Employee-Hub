const logger = require('../config/logger');

/**
 * Send a push notification via Expo's push API.
 * token: an Expo push token (ExponentPushToken[...] or ExpoPushToken[...])
 */
async function sendPushNotification(token, title, body, data = {}) {
  if (!token || !token.startsWith('Expo')) return;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default', data }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      logger.warn('Push notification failed', { token: token.slice(0, 20), err });
    }
  } catch (error) {
    logger.error('sendPushNotification error', error);
  }
}

module.exports = { sendPushNotification };
