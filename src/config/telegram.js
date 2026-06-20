// Telegram bot - optional for now
const bot = {
  sendMessage: async (chatId, message) => {
    console.log(`[Telegram Alert] ${message}`);
    return Promise.resolve();
  }
};

module.exports = bot;