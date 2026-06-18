const logger = {
  info: (message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ ${message}`);
  },
  error: (message, error) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ ${message}`, error);
  },
  warn: (message) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] ⚠️ ${message}`);
  }
};

module.exports = logger;