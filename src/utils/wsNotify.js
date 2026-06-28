const { getConnectionsByCompany } = require('./wsConnections');
const { deleteConnection } = require('./wsConnections');
const { getWsApiClient } = require('../config/wsApiClient');
const logger = require('../config/logger');

// Broadcast a JSON payload to every WebSocket connection belonging to the
// given company.  Always fire-and-forget — never throws, never blocks a
// caller's response.
//
// Stale connections (API GW returns 410 Gone) are silently deleted so they
// don't accumulate.  All other post errors are logged and swallowed.
//
// Guard: if WS_ENDPOINT is not set (local dev, CI) the function is a no-op so
// routes don't need environment-specific branches.
async function notifyCompany(companyId, payload) {
  if (!companyId || !process.env.WS_ENDPOINT) {
    logger.warn(`wsNotify: skipped — companyId=${companyId} WS_ENDPOINT_set=${!!process.env.WS_ENDPOINT}`);
    return;
  }

  const connections = await getConnectionsByCompany(companyId);
  logger.info(`wsNotify: companyId=${companyId} event=${payload.event} connections=${connections.length} endpoint=${process.env.WS_ENDPOINT}`);
  if (!connections.length) return;

  const client = getWsApiClient();
  const data = JSON.stringify(payload);

  await Promise.allSettled(
    connections.map(async ({ connectionId }) => {
      try {
        await client.postToConnection({ ConnectionId: connectionId, Data: data }).promise();
        logger.info(`wsNotify: pushed to conn=${connectionId}`);
      } catch (err) {
        if (err.statusCode === 410) {
          logger.info(`wsNotify: stale conn=${connectionId} removed`);
          deleteConnection(connectionId).catch(() => {});
        } else {
          logger.warn(`wsNotify: postToConnection failed conn=${connectionId} status=${err.statusCode}`, err.message);
        }
      }
    })
  );
}

module.exports = { notifyCompany };
