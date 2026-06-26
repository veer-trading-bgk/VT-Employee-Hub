// AWS Lambda entrypoint. Wraps the existing Express app (src/app.js) with
// serverless-http so it can run behind API Gateway without any route changes.
const serverless = require('serverless-http');
const { loadSecrets } = require('./config/secrets');
const app = require('./app');

const handler = serverless(app, {
  binary: ['image/*', 'video/*', 'audio/*', 'application/octet-stream', 'application/pdf'],
});

exports.handler = async (event, context) => {
  // loadSecrets() is a no-op after the first cold start (cached in module scope)
  await loadSecrets();
  return handler(event, context);
};
