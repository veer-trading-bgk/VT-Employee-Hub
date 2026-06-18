// One-off script: creates the first admin user directly in DynamoDB,
// bypassing the /register route (which requires an existing admin token).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const dynamodb = require('../src/config/dynamodb');

const [, , email, password, name] = process.argv;

if (!email || !password || !name) {
  console.error('Usage: node scripts/seed-admin.js <email> <password> <name>');
  process.exit(1);
}

(async () => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const userId = `emp_${Date.now()}`;

  await dynamodb.put({
    TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
    Item: {
      id: userId,
      email,
      password: hashedPassword,
      name,
      role: 'admin',
      createdAt: new Date().toISOString(),
      createdBy: 'seed-script',
      status: 'active'
    },
    ConditionExpression: 'attribute_not_exists(id)'
  }).promise();

  console.log('Admin user created:', { id: userId, email, name, role: 'admin' });
})().catch(err => {
  console.error('Failed to seed admin user:', err);
  process.exit(1);
});
