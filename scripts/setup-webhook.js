// Registers the bot's webhook URL with Telegram. Run this from a machine/
// network that can actually reach api.telegram.org (this dev sandbox cannot -
// see README note). The URL must be public HTTPS; Telegram rejects
// http:// and localhost addresses outright.
require('dotenv').config();
const { Telegraf } = require('telegraf');

const webhookUrl = process.argv[2];
if (!webhookUrl) {
  console.error('Usage: node scripts/setup-webhook.js https://your-public-domain.com/api/telegram/webhook');
  process.exit(1);
}
if (!webhookUrl.startsWith('https://')) {
  console.error('Telegram requires an https:// URL for webhooks (localhost/http will be rejected).');
  process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

(async () => {
  await bot.telegram.setWebhook(webhookUrl);
  const info = await bot.telegram.getWebhookInfo();
  console.log('Webhook set:', info);
})().catch((err) => {
  console.error('Failed to set webhook:', err);
  process.exit(1);
});
