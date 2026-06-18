// Simulates Telegram updates being delivered to the bot, without requiring
// real network access to api.telegram.org (which is unreachable from this
// environment). Injects synthetic Update objects through the same
// bot.handleUpdate() code path Telegraf's webhook uses, and intercepts the
// outbound Telegram API calls (sendMessage, etc.) so we can print what the
// bot *would* have replied/sent.
require('dotenv').config();
const { Telegram } = require('telegraf');
const { bot } = require('../src/routes/telegram');

if (!bot) {
  console.error('Bot not initialized - check TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}

// Telegraf builds a fresh Telegram client per update (see Telegraf#handleUpdate),
// so the override must live on the prototype to intercept every instance.
const sentMessages = [];
Telegram.prototype.callApi = async function callApi(method, payload) {
  sentMessages.push({ method, payload });
  if (method === 'getMe') {
    return { id: 0, is_bot: true, first_name: 'vt_employee_hub_bot', username: 'vt_employee_hub_bot' };
  }
  return { message_id: sentMessages.length, date: Math.floor(Date.now() / 1000), chat: payload.chat_id };
};

const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const ADMIN_EMAIL = 'viireshcshettar@gmail.com';
const ADMIN_PASSWORD = 'viir@1315';

let updateId = 1000;
const makeUpdate = (text) => {
  const message = {
    message_id: updateId,
    date: Math.floor(Date.now() / 1000),
    chat: { id: Number(ADMIN_CHAT_ID), type: 'private' },
    from: { id: Number(ADMIN_CHAT_ID), is_bot: false, first_name: 'Viir' },
    text
  };

  // Real Telegram clients mark the leading "/command" as a bot_command
  // entity; Telegraf's command() middleware requires it to be present.
  if (text.startsWith('/')) {
    const commandLength = text.split(' ')[0].length;
    message.entities = [{ type: 'bot_command', offset: 0, length: commandLength }];
  }

  return { update_id: updateId++, message };
};

const send = async (label, text) => {
  sentMessages.length = 0;
  await bot.handleUpdate(makeUpdate(text));
  const replies = sentMessages
    .filter((m) => m.method === 'sendMessage')
    .map((m) => m.payload.text);

  console.log(`\n--- ${label} ---`);
  console.log(`> ${text}`);
  replies.forEach((r) => console.log(`< ${r}`));
  if (replies.length === 0) {
    console.log('< (no reply captured)');
  }
  return replies;
};

(async () => {
  console.log('=== Telegram Bot Command Simulation ===');
  console.log('(Outbound calls to api.telegram.org are intercepted - no real network used)\n');

  await send('Test 1: /help (before linking)', '/help');

  await send('Test 2: /add_kyc before linking (should be rejected)', '/add_kyc 3');

  await send('Test 3: /link with wrong password (should fail)', `/link ${ADMIN_EMAIL} wrongpassword`);

  await send('Test 4: /link with correct credentials', `/link ${ADMIN_EMAIL} ${ADMIN_PASSWORD}`);

  await send('Test 5: /add_kyc 5', '/add_kyc 5');
  await send('Test 6: /add_demat 2', '/add_demat 2');
  await send('Test 7: /add_mf 4', '/add_mf 4');
  await send('Test 8: /add_insurance 50000', '/add_insurance 50000');
  await send('Test 9: /add_revenue 18000', '/add_revenue 18000');

  await send('Test 10: /add_kyc with invalid (non-numeric) value', '/add_kyc abc');

  await send('Test 11: /my_summary', '/my_summary');

  console.log('\n=== Simulation complete ===');
  process.exit(0);
})().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
