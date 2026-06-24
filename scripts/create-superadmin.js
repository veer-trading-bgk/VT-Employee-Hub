const AWS = require('aws-sdk');
const bcrypt = require('bcryptjs');

const ddb = new AWS.DynamoDB.DocumentClient({ region: 'ap-south-1' });

(async () => {
  const id = `emp_superadmin_${Date.now()}`;
  const hashedPassword = await bcrypt.hash('Viir@1315', 10);

  await ddb.put({
    TableName: 'employees',
    Item: {
      id,
      email: 'support@apforce.in',
      password: hashedPassword,
      name: 'viiresh',
      role: 'superadmin',
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: 'system',
      totpEnabled: false,
      totpSecret: null,
      backupCodes: [],
    },
  }).promise();

  console.log('Superadmin created:', { id, email: 'support@apforce.in', role: 'superadmin' });
})().catch(err => { console.error(err.message); process.exit(1); });
