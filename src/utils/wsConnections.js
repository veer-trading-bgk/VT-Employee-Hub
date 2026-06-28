const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

// API Gateway WebSocket connections max out at 2 hours (total lifetime).
// TTL matches so DynamoDB auto-cleans orphaned records even when $disconnect
// never fires (e.g. browser tab killed, network cut).
const TTL_SECONDS = 2 * 60 * 60;

function table() {
  return process.env.WS_CONNECTIONS_TABLE || 'ws_connections';
}

// Store a new connection.  companyId is null for superadmin users — stored as
// the literal string 'SUPERADMIN' so the GSI can still index it.
async function saveConnection(connectionId, userId, companyId, role) {
  const ttl = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  await dynamodb.put({
    TableName: table(),
    Item: {
      connectionId,
      userId,
      companyId: companyId || 'SUPERADMIN',
      role: role || 'unknown',
      connectedAt: new Date().toISOString(),
      ttl,
    },
  }).promise();
}

async function deleteConnection(connectionId) {
  await dynamodb.delete({
    TableName: table(),
    Key: { connectionId },
  }).promise();
}

// Returns [{connectionId, userId, role}] for all active connections belonging
// to this company.  Uses the companyIdIndex GSI — O(connections-per-company).
async function getConnectionsByCompany(companyId) {
  try {
    const result = await dynamodb.query({
      TableName: table(),
      IndexName: 'companyIdIndex',
      KeyConditionExpression: 'companyId = :cid',
      ExpressionAttributeValues: { ':cid': companyId },
      ProjectionExpression: 'connectionId, userId, #r',
      ExpressionAttributeNames: { '#r': 'role' },
    }).promise();
    logger.info(`wsConnections.getConnectionsByCompany: table=${table()} companyId=${companyId} found=${result.Items?.length ?? 0}`);
    return result.Items ?? [];
  } catch (err) {
    logger.warn(`wsConnections.getConnectionsByCompany failed: table=${table()} companyId=${companyId} error=${err.message} code=${err.code}`);
    return [];
  }
}

module.exports = { saveConnection, deleteConnection, getConnectionsByCompany };
