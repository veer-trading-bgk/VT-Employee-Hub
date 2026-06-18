const AWS = require('aws-sdk');

// Only override credentials for local dev with an IAM user's static keys.
// In Lambda, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are also auto-injected
// by the runtime (the execution role's temp creds) - but those come paired
// with AWS_SESSION_TOKEN, which is required for them to work. Explicitly
// passing just the first two here (as we used to) silently drops the
// session token and breaks every AWS call with "security token is invalid".
// Lambda's own default credential chain already handles this correctly, so
// we just leave credentials untouched when running there.
const config = { region: process.env.AWS_REGION || 'ap-south-1' };
const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
if (!isLambda && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  config.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
}
AWS.config.update(config);

const dynamodb = new AWS.DynamoDB.DocumentClient();

module.exports = dynamodb;