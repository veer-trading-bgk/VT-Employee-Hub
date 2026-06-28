// WebSocket Lambda entry point — handles $connect, $disconnect, $default.
// This handler does NOT use serverless-http or Express; API Gateway WebSocket
// events are not HTTP requests and cannot pass through that wrapper.
const jwt = require('jsonwebtoken');
const { loadSecrets } = require('./config/secrets');
const { saveConnection, deleteConnection } = require('./utils/wsConnections');
const logger = require('./config/logger');

// loadSecrets() is idempotent after the first cold start (module-scope cache).
let secretsLoaded = false;
async function ensureSecrets() {
  if (secretsLoaded) return;
  await loadSecrets();
  secretsLoaded = true;
}

exports.handler = async (event) => {
  await ensureSecrets();

  const { routeKey, connectionId } = event.requestContext ?? {};

  // ── $connect ──────────────────────────────────────────────────────────────
  if (routeKey === '$connect') {
    const rawToken = event.queryStringParameters?.token;
    const token = rawToken ? decodeURIComponent(rawToken) : undefined;

    console.log('[WS $connect] token present:', !!token);
    console.log('[WS $connect] JWT_SECRET length:', process.env.JWT_SECRET?.length ?? 0);

    if (!token) {
      return { statusCode: 401, body: 'Missing token' };
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.log('[WS $connect] jwt error name:', err.name);
      return { statusCode: 401, body: 'Invalid token' };
    }

    // Reject temp tokens (2FA not yet completed)
    if (decoded.temp === true) {
      return { statusCode: 401, body: 'Complete 2FA verification first' };
    }

    try {
      await saveConnection(
        connectionId,
        decoded.id,
        decoded.companyId ?? null,
        decoded.role ?? 'unknown'
      );
      logger.info(`WS $connect: user=${decoded.id} role=${decoded.role} conn=${connectionId}`);
    } catch (err) {
      logger.error('WS $connect: saveConnection failed', err);
      return { statusCode: 500, body: 'Internal error' };
    }

    return { statusCode: 200, body: 'Connected' };
  }

  // ── $disconnect ───────────────────────────────────────────────────────────
  if (routeKey === '$disconnect') {
    try {
      await deleteConnection(connectionId);
      logger.info(`WS $disconnect: conn=${connectionId}`);
    } catch (err) {
      logger.warn('WS $disconnect: deleteConnection failed', err.message);
    }
    return { statusCode: 200, body: 'Disconnected' };
  }

  // ── $default — no-op; reserved for future client→server messages ──────────
  return { statusCode: 200, body: 'OK' };
};
