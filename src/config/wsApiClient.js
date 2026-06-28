const AWS = require('aws-sdk');

// Singleton ApiGatewayManagementApi client — mirrors the credential pattern in
// src/config/dynamodb.js (never pass static keys inside Lambda; rely on the
// execution role's injected credentials instead).
const region = process.env.AWS_REGION || 'ap-south-1';

let _client = null;

function getWsApiClient() {
  if (_client) return _client;

  const endpoint = process.env.WS_ENDPOINT;
  const config = { apiVersion: '2018-11-29', endpoint, region };

  const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (!isLambda && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  }

  _client = new AWS.ApiGatewayManagementApi(config);
  return _client;
}

// Reset the singleton — used by tests to swap in a mock client or a different
// endpoint between test cases without reloading the module.
function resetWsApiClient() {
  _client = null;
}

module.exports = { getWsApiClient, resetWsApiClient };
