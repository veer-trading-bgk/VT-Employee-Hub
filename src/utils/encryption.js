const crypto = require('crypto');

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate one with: node -e "require(\'crypto\').randomBytes(32).toString(\'hex\')"');
  }
  return key;
}

const encrypt = (text, key = getKey()) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
};

const decrypt = (encryptedText, key = getKey()) => {
  const [ivHex, encrypted] = encryptedText.split(':');
  if (!ivHex || !encrypted) throw new Error('Invalid encrypted format');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'hex'), Buffer.from(ivHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

const maskToken = (token) => {
  if (!token || token.length < 10) return token;
  return `${token.substring(0, 3)}${'x'.repeat(token.length - 6)}${token.substring(token.length - 3)}`;
};

module.exports = { encrypt, decrypt, maskToken };
