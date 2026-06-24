/**
 * One-off: create APForce internal company profile + link superadmin to it.
 */
const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient({ region: 'ap-south-1' });

const COMPANY_ID   = 'apforce_internal';
const ADMIN_EMAIL  = 'support@apforce.in';
const EMP_TABLE    = 'employees';

(async () => {
  // 1. Create company profile
  await ddb.put({
    TableName: EMP_TABLE,
    Item: {
      id: `COMPANY#${COMPANY_ID}`,
      type: 'COMPANY_PROFILE',
      companyId: COMPANY_ID,
      companyName: 'APForce',
      broker: 'APForce Platform',
      city: 'India',
      adminEmail: ADMIN_EMAIL,
      plan: 'enterprise',
      planStatus: 'active',
      trialEndsAt: null,
      createdAt: new Date().toISOString(),
    },
  }).promise();
  console.log('✓ Company profile created: COMPANY#apforce_internal');

  // 2. Find the superadmin by email and update companyId
  const result = await ddb.query({
    TableName: EMP_TABLE,
    IndexName: 'emailIndex',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': ADMIN_EMAIL },
  }).promise();

  const superadmin = result.Items?.[0];
  if (!superadmin) { console.error('Superadmin not found'); process.exit(1); }

  await ddb.update({
    TableName: EMP_TABLE,
    Key: { id: superadmin.id },
    UpdateExpression: 'SET companyId = :cid, updatedAt = :at',
    ExpressionAttributeValues: { ':cid': COMPANY_ID, ':at': new Date().toISOString() },
  }).promise();

  console.log(`✓ Superadmin (${superadmin.id}) linked to companyId: ${COMPANY_ID}`);
  console.log('\nDone. Superadmin now has their own CRM + WhatsApp workspace.');
})().catch(err => { console.error(err.message); process.exit(1); });
