'use strict';

/**
 * Sandbox E2E bootstrap — Event Booking payment validation.
 * 1) Ensures ticket_quantity has unitPrice (required for Pay & Register).
 * 2) Extends wait timeout + adds confirmation WhatsApp after create_journey_record.
 * 3) Mints JOURNEY# + AUTO_EXEC# + AUTO_WAIT# and prints the capability URL.
 *
 * Usage: node scripts/sandbox_e2e_bootstrap.js
 * Does not charge — only prepares DynamoDB + URL for a real Checkout session.
 */

const crypto = require('crypto');
const AWS = require('aws-sdk');
const { generateJourneyId } = require('../src/core/id');
const {
  journeyPK,
  journeyMetaSK,
  journeyDefPK,
  journeyDefSK,
  journeysByCompanyGsiPK,
} = require('../src/core/entityKeys');
const { newMeta, updateMeta } = require('../src/core/systemMeta');

const db = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const TABLE = 'business_metrics';
const CID = 'company_1784905246660';
const DEF_ID = 'journeydef_01KZ1032F0FJW0MKN7DGA3MG21';
const WF_ID = 'f663f11d-63e4-47c2-ac20-dd1418f04c70';
const WAIT_NODE = 'node-1785666787500-gllm';
const OPEN_NODE = 'node-1785666736879-8v49';
const RECORD_NODE = 'node-1785666844046-eq0n';
const CANCEL_NODE = 'node-1785666856816-jhe1';
const COMPLETE_NODE = 'node-sandbox-complete-journey';
const CONFIRM_NODE = 'node-sandbox-send-confirmation';
const FRONTEND = 'https://dashboard.viirtrading.com';
const TEST_PHONE = process.env.SANDBOX_PHONE || '9901251785';

async function ensureDefinitionPriced() {
  const Key = { PK: journeyDefPK(CID), SK: journeyDefSK(DEF_ID) };
  const { Item } = await db.get({ TableName: TABLE, Key }).promise();
  if (!Item) throw new Error('Event Booking definition missing');
  const screens = JSON.parse(JSON.stringify(Item.screens || []));
  let changed = false;
  for (const s of screens) {
    for (const f of s.fields || []) {
      if (f.id === 'ticket_quantity' && typeof f.unitPrice !== 'number') {
        f.unitPrice = 500; // ₹500 / ticket — sandbox priced path
        changed = true;
      }
    }
  }
  if (!changed) {
    console.log('definition: ticket_quantity already priced');
    return Item;
  }
  const patch = updateMeta(Item, 'system');
  await db.update({
    TableName: TABLE,
    Key,
    UpdateExpression: 'SET screens = :s, updatedAt = :ua, updatedBy = :ub, #v = :nv',
    ExpressionAttributeNames: { '#v': 'version' },
    ExpressionAttributeValues: {
      ':s': screens,
      ':ua': patch.updatedAt,
      ':ub': patch.updatedBy,
      ':nv': patch.version,
    },
  }).promise();
  console.log('definition: set ticket_quantity.unitPrice=500');
  return { ...Item, screens };
}

async function ensureWorkflowConfirmation() {
  const Key = { PK: `CONFIG#AUTO#${CID}`, SK: `AUTO#${WF_ID}` };
  const { Item } = await db.get({ TableName: TABLE, Key }).promise();
  if (!Item) throw new Error('dandiya workflow missing');

  const nodes = [...(Item.nodes || [])];
  const edges = [...(Item.edges || [])];
  let changed = false;

  const wait = nodes.find((n) => n.id === WAIT_NODE);
  if (wait && wait.config?.timeoutMinutes !== 60) {
    wait.config = { ...wait.config, timeoutMinutes: 60 };
    changed = true;
  }

  if (!nodes.some((n) => n.id === COMPLETE_NODE)) {
    nodes.push({ id: COMPLETE_NODE, type: 'complete_journey', config: {}, position: { x: 480, y: 532 } });
    changed = true;
  }
  if (!nodes.some((n) => n.id === CONFIRM_NODE)) {
    nodes.push({
      id: CONFIRM_NODE,
      type: 'send_message',
      config: {
        messageText:
          '✅ *Booking confirmed*\n\nYour Dandiya tickets are confirmed. Thank you for registering!\n\n(Sandbox E2E confirmation)',
      },
      position: { x: 640, y: 532 },
    });
    changed = true;
  }

  const hasRecordToComplete = edges.some((e) => e.source === RECORD_NODE && e.target === COMPLETE_NODE);
  if (!hasRecordToComplete) {
    // Replace any prior record→? with record→complete
    for (let i = edges.length - 1; i >= 0; i--) {
      if (edges[i].source === RECORD_NODE && !edges[i].sourceHandle) edges.splice(i, 1);
    }
    edges.push({
      id: 'edge-sandbox-record-complete',
      source: RECORD_NODE,
      target: COMPLETE_NODE,
    });
    changed = true;
  }
  if (!edges.some((e) => e.source === COMPLETE_NODE && e.target === CONFIRM_NODE)) {
    edges.push({
      id: 'edge-sandbox-complete-confirm',
      source: COMPLETE_NODE,
      target: CONFIRM_NODE,
    });
    changed = true;
  }

  if (!changed) {
    console.log('workflow: confirmation path already present');
    return Item;
  }

  await db.update({
    TableName: TABLE,
    Key,
    UpdateExpression: 'SET nodes = :n, edges = :e, updatedAt = :ua',
    ExpressionAttributeValues: {
      ':n': nodes,
      ':e': edges,
      ':ua': new Date().toISOString(),
    },
  }).promise();
  console.log('workflow: timeout=60m + complete_journey + send_message confirmation');
  return Item;
}

async function mintJourney() {
  const journeyInstanceId = generateJourneyId();
  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const executionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const resumeAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const execSK = `EXEC#${startedAt}#${executionId}`;
  const meta = newMeta('system');

  await db.put({
    TableName: TABLE,
    Item: {
      PK: journeyPK(CID, journeyInstanceId),
      SK: journeyMetaSK(),
      id: journeyInstanceId,
      companyId: CID,
      journeyDefId: DEF_ID,
      status: 'opened',
      tokenHash,
      tokenExpiresAt,
      executionId,
      leadPK: null,
      leadId: null,
      contactId: null,
      journeysByCompanyGsiPK: journeysByCompanyGsiPK(CID),
      ...meta,
    },
  }).promise();

  await db.put({
    TableName: TABLE,
    Item: {
      PK: `AUTO_EXEC#${CID}`,
      SK: execSK,
      companyId: CID,
      executionId,
      workflowId: WF_ID,
      workflowName: 'dandiya event booking',
      status: 'paused',
      startedAt,
      contactName: 'Sandbox E2E',
      leadPK: null,
      contactId: null,
      triggeredBy: { type: 'sandbox_e2e', entityId: 'manual' },
      path: [
        {
          nodeId: OPEN_NODE,
          type: 'open_web_journey',
          status: 'completed',
          completedAt: startedAt,
          result: { journeyInstanceId, tokenExpiresAt },
        },
        {
          nodeId: WAIT_NODE,
          type: 'wait_for_webhook',
          status: 'waiting_webhook',
          resumeAt,
        },
      ],
      TTL: Math.floor(Date.now() / 1000) + 90 * 86400,
    },
  }).promise();

  await db.put({
    TableName: TABLE,
    Item: {
      PK: `AUTO_WAIT#${CID}`,
      SK: `WAIT#${resumeAt}#${executionId}`,
      companyId: CID,
      executionId,
      execSK,
      workflowId: WF_ID,
      nodeId: WAIT_NODE,
      waitType: 'webhook',
      journeyInstanceId,
      graph: true,
      fallbackKey: '__timeout__',
      resumeAt,
      context: {
        executionId,
        journeyInstanceId,
        phone: TEST_PHONE,
        name: 'Sandbox E2E',
        source: 'whatsapp',
        messageText: 'tickets',
        stage: 'new_lead',
        assignedTo: 'system',
        tags: [],
      },
      TTL: Math.floor(new Date(resumeAt).getTime() / 1000) + 7 * 86400,
    },
  }).promise();

  const url = `${FRONTEND}/journey/${CID}/${journeyInstanceId}/${rawToken}`;
  return { url, journeyInstanceId, rawToken, executionId, phone: TEST_PHONE };
}

(async () => {
  await ensureDefinitionPriced();
  await ensureWorkflowConfirmation();
  const minted = await mintJourney();
  console.log(JSON.stringify({ ok: true, ...minted }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
