#!/usr/bin/env node

/**
 * Admin Account Recovery Script
 *
 * Usage:
 *   node scripts/recover-admin.js <email> <newPassword>
 *
 * Example:
 *   node scripts/recover-admin.js viireshcshettar@gmail.com NewPass123!
 *
 * Requirements:
 *   - AWS credentials configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in .env or ~/.aws/credentials)
 *   - AWS region: ap-south-1
 *   - DynamoDB table: employees
 *
 * What it does:
 *   1. Validates email and password
 *   2. Finds employee by email (via emailIndex GSI)
 *   3. Hashes new password with bcrypt (rounds: 10)
 *   4. Updates DynamoDB: password field + status -> active
 *   5. Logs action for audit trail
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const AWS = require('aws-sdk');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const REGION     = 'ap-south-1';
const TABLE_NAME = 'employees';
const EMAIL_INDEX = 'emailIndex';

const dynamodb = new AWS.DynamoDB.DocumentClient({ region: REGION });

const c = {
  reset:  '\x1b[0m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
};

const log = {
  info:    (m) => console.log(`${c.blue}ℹ ${m}${c.reset}`),
  success: (m) => console.log(`${c.green}✔ ${m}${c.reset}`),
  warn:    (m) => console.log(`${c.yellow}⚠ ${m}${c.reset}`),
  error:   (m) => console.log(`${c.red}✖ ${m}${c.reset}`),
  header:  (m) => console.log(`\n${c.cyan}${m}${c.reset}\n`),
};

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  if (password.length < 8)      return { valid: false, error: 'Password must be at least 8 characters' };
  if (!/[A-Z]/.test(password))  return { valid: false, error: 'Password must contain an uppercase letter (A-Z)' };
  if (!/[0-9]/.test(password))  return { valid: false, error: 'Password must contain a number (0-9)' };
  return { valid: true };
}

async function findEmployee(email) {
  log.info(`Looking up employee: ${email}`);
  const result = await dynamodb.query({
    TableName: TABLE_NAME,
    IndexName: EMAIL_INDEX,
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email },
    Limit: 1,
  }).promise();

  if (!result.Items || result.Items.length === 0) {
    return { found: false, error: `No employee found with email: ${email}` };
  }
  return { found: true, employee: result.Items[0] };
}

async function updatePassword(employeeId, hash) {
  log.info(`Writing to DynamoDB (id: ${employeeId})…`);
  await dynamodb.update({
    TableName: TABLE_NAME,
    Key: { id: employeeId },
    // NOTE: field is "password", not "passwordHash" — matches the backend schema
    UpdateExpression: 'SET #pw = :hash, updatedAt = :now, #st = :status',
    ExpressionAttributeNames: { '#pw': 'password', '#st': 'status' },
    ExpressionAttributeValues: {
      ':hash':   hash,
      ':now':    new Date().toISOString(),
      ':status': 'active',
    },
    ReturnValues: 'ALL_NEW',
  }).promise();
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    log.header('Admin Account Recovery Script');
    console.log('Usage:  node scripts/recover-admin.js <email> <newPassword>');
    console.log('Example: node scripts/recover-admin.js admin@viirtrading.com NewPass123!\n');
    console.log('Password rules: 8+ chars, uppercase letter, number');
    process.exit(1);
  }

  log.header('🔑 Admin Account Recovery');

  if (!validateEmail(email))                        { log.error('Invalid email format');           process.exit(1); }
  const pv = validatePassword(password);
  if (!pv.valid)                                    { log.error(pv.error);                         process.exit(1); }
  log.success('Inputs validated');

  const lookup = await findEmployee(email);
  if (!lookup.found)                                { log.error(lookup.error);                     process.exit(1); }

  const emp = lookup.employee;
  log.success(`Found: ${emp.name} (${emp.id})`);
  log.info(`Current status: ${emp.status ?? 'unknown'}`);

  log.info('Hashing password…');
  const hash = await bcrypt.hash(password, 10);
  log.success('Password hashed');

  console.log(`\n${c.yellow}⚠  CONFIRMATION REQUIRED${c.reset}`);
  console.log(`  Employee : ${emp.name} <${emp.email}>`);
  console.log(`  Action   : Reset password + set status → active\n`);

  const answer = await confirm(`${c.yellow}Type "yes" to confirm: ${c.reset}`);
  if (answer.toLowerCase() !== 'yes') {
    log.warn('Recovery cancelled.');
    process.exit(0);
  }

  await updatePassword(emp.id, hash);

  log.success('Password reset successfully');
  log.success('Account status set to: active');

  log.header('✅ Recovery Complete');
  console.log(`${c.green}Employee can now login with:${c.reset}`);
  console.log(`  Email   : ${emp.email}`);
  console.log(`  Password: ${password}`);
  console.log(`\n${c.cyan}Next steps:${c.reset}`);
  console.log('  1. Share the password securely (in person or Signal)');
  console.log('  2. Employee logs in and changes their password immediately\n');
}

main().catch((err) => {
  console.error(`\n${c.red}Fatal error: ${err.message}${c.reset}`);
  process.exit(1);
});
