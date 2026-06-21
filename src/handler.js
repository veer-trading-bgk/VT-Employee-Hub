// AWS Lambda entrypoint. Wraps the existing Express app (src/app.js) with
// serverless-http so it can run behind API Gateway without any route changes.
const serverless = require('serverless-http');
const { loadSecrets } = require('./config/secrets');
const app = require('./app');

const handler = serverless(app);

exports.handler = async (event, context) => {
  // loadSecrets() is a no-op after the first cold start (cached in module scope)
  await loadSecrets();
  // debug: log raw headers for OPTIONS so we can see what API GW forwards
  if (event.httpMethod === 'OPTIONS') {
    // eslint-disable-next-line no-console
    console.log('[OPTIONS-EVENT]', JSON.stringify({
      method: event.httpMethod,
      path: event.path,
      headers: event.headers,
    }));
  }
  const result = await handler(event, context);
  if (event.httpMethod === 'OPTIONS') {
    // eslint-disable-next-line no-console
    console.log('[OPTIONS-RESPONSE]', JSON.stringify({
      statusCode: result.statusCode,
      headers: result.headers,
    }));
  }
  return result;
};
