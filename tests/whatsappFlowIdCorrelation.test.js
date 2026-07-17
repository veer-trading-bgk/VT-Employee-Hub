'use strict';

/**
 * Coverage for flowId correlation on the inbound nfm_reply (Flow response)
 * webhook path — foundation for the future flow_completed trigger (routing
 * itself is a separate, later step). Exercised end-to-end through the real
 * /webhook handler (same direct-handler-invocation technique as
 * whatsappListReply.test.js, whose mock/helper preamble this mirrors),
 * since the correlation logic lives inline in that handler, not in a
 * separately-exported pure function.
 */

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(),
}));
jest.mock('../src/utils/verifyMetaWebhookSignature', () => ({
  verifyMetaWebhookSignature: jest.fn(() => true),
}));
// dedupPut is deliberately NOT mocked — same reasoning as whatsappListReply.test.js:
// running it for real is what lets these tests assert against the actual MSG# SK
// dedupPut writes, which the flowId-patch UpdateExpression's Key must match exactly.
jest.mock('../src/utils/wsNotify', () => ({
  notifyCompany: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/utils/conversationResolver', () => ({
  resolveForInbox: jest.fn().mockResolvedValue(null),
  resolveForLead:  jest.fn().mockResolvedValue(null),
  syncConvStatus:  jest.fn(),
  syncMarkRead:    jest.fn(),
}));
jest.mock('../src/services/IntentDetectionService', () => ({
  classifyIfNeededForLead:  jest.fn(),
  classifyIfNeededForInbox: jest.fn(),
}));
jest.mock('../src/services/WorkingHoursService', () => ({
  shouldSendOOO: jest.fn().mockResolvedValue(false),
  sendOOO:       jest.fn(),
}));
jest.mock('../src/services/DelayedResponseService', () => ({
  scheduleIfEnabled: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/AutomationEngine', () => ({
  fireTrigger:        jest.fn().mockResolvedValue(undefined),
  resumeOnButtonReply: jest.fn().mockResolvedValue(undefined),
}));

const dynamodb = require('../src/config/dynamodb');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { sendStatus: jest.fn() };
}

describe('POST /api/whatsapp/webhook — nfm_reply flowId correlation', () => {
  const CID = 'comp_test';
  const PHONE_NUMBER_ID = 'phone_number_id_1';
  const PHONE10 = '9876543210';
  const LEAD_PK = `LEAD#${CID}#lead_1`;
  const LEAD_ITEM = {
    PK: LEAD_PK, SK: 'METADATA', leadId: 'lead_1', companyId: CID,
    name: 'Test Customer', phone: PHONE10, phoneNorm: PHONE10,
    stage: 'new', tags: [], assignedTo: 'emp_1', chatStatus: 'open',
  };

  function webhookBody(message) {
    return {
      entry: [{
        id: 'waba_1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            contacts: [{ wa_id: PHONE10, profile: { name: 'Test Customer' } }],
            messages: [{ from: PHONE10, id: `wamid.${Date.now()}`, timestamp: '1751500000', ...message }],
          },
        }],
      }],
    };
  }

  function nfmReplyMessage() {
    return {
      type: 'interactive',
      interactive: {
        type: 'nfm_reply',
        nfm_reply: { name: 'KYC Form', body: 'Sent', response_json: JSON.stringify({ full_name: 'Priya Sharma' }) },
      },
    };
  }

  function markerItem(flowId, sentAt) {
    return { PK: LEAD_PK, SK: `PENDINGFLOW#${flowId}`, flowId, sentAt, ttl: Math.floor(Date.now() / 1000) + 1000 };
  }

  // Set per-test; the mocked base-table (no IndexName) PENDINGFLOW# query returns these.
  let pendingFlowMarkers;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    pendingFlowMarkers = [];

    dynamodb.get.mockImplementation((params) => {
      const pk = params?.Key?.PK ?? '';
      let item;
      if (pk.startsWith('CONFIG#PHONEID#')) item = { companyId: CID };
      else if (pk.startsWith('CONFIG#WABA#')) item = { companyId: CID, phoneNumberId: PHONE_NUMBER_ID, accessToken: 'tok' };
      return { promise: () => Promise.resolve(item ? { Item: item } : {}) };
    });
    dynamodb.query.mockImplementation((params) => {
      if (params?.IndexName === 'company-phone-index') {
        return { promise: () => Promise.resolve({ Items: [LEAD_ITEM] }) };
      }
      if (params?.ExpressionAttributeValues?.[':pfx'] === 'PENDINGFLOW#') {
        return { promise: () => Promise.resolve({ Items: pendingFlowMarkers }) };
      }
      // The campaign-reply-tracking MSG# lookup (and anything else) — no interference.
      return { promise: () => Promise.resolve({ Items: [] }) };
    });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
  });

  test('exactly one pending marker → clean match, flowId stamped, no flowIdConfidence field, marker deleted', async () => {
    pendingFlowMarkers = [markerItem('flow-A', '2026-07-17T10:00:00.000Z')];
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody(nfmReplyMessage()) }, mockRes(), jest.fn());

    const patchCall = dynamodb.update.mock.calls.find(([a]) => a.Key?.PK === LEAD_PK && a.Key?.SK?.startsWith('MSG#'));
    expect(patchCall).toBeDefined();
    const [patchArgs] = patchCall;
    expect(patchArgs.ExpressionAttributeValues[':fid']).toBe('flow-A');
    expect(patchArgs.UpdateExpression).not.toMatch(/flowIdConfidence/);
    expect(patchArgs.ExpressionAttributeValues[':conf']).toBeUndefined();

    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'PENDINGFLOW#flow-A' },
    }));
  });

  test('two markers for the same lead, different flows → most-recent wins, flowIdConfidence: "ambiguous", unmatched marker survives', async () => {
    pendingFlowMarkers = [
      markerItem('flow-OLD', '2026-07-17T08:00:00.000Z'),
      markerItem('flow-NEW', '2026-07-17T09:30:00.000Z'),
    ];
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody(nfmReplyMessage()) }, mockRes(), jest.fn());

    const patchCall = dynamodb.update.mock.calls.find(([a]) => a.Key?.PK === LEAD_PK && a.Key?.SK?.startsWith('MSG#'));
    const [patchArgs] = patchCall;
    expect(patchArgs.ExpressionAttributeValues[':fid']).toBe('flow-NEW');
    expect(patchArgs.ExpressionAttributeValues[':conf']).toBe('ambiguous');
    expect(patchArgs.UpdateExpression).toMatch(/flowIdConfidence/);

    // Only the matched (most-recent) marker is deleted — flow-OLD's survives
    // in case a later reply matches it correctly.
    expect(dynamodb.delete).toHaveBeenCalledTimes(1);
    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'PENDINGFLOW#flow-NEW' },
    }));
    expect(dynamodb.delete).not.toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'PENDINGFLOW#flow-OLD' },
    }));
  });

  test('zero pending markers → flowId: null, no flowIdConfidence, no throw', async () => {
    pendingFlowMarkers = [];
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await expect(
      handler({ body: webhookBody(nfmReplyMessage()) }, mockRes(), jest.fn()),
    ).resolves.toBeUndefined();

    const patchCall = dynamodb.update.mock.calls.find(([a]) => a.Key?.PK === LEAD_PK && a.Key?.SK?.startsWith('MSG#'));
    expect(patchCall).toBeDefined();
    const [patchArgs] = patchCall;
    expect(patchArgs.ExpressionAttributeValues[':fid']).toBeNull();
    expect(patchArgs.ExpressionAttributeValues[':conf']).toBeUndefined();
    expect(dynamodb.delete).not.toHaveBeenCalled();
  });

  test('a non-flow message (plain text) never triggers the correlation query at all', async () => {
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'hello' } }) }, mockRes(), jest.fn());

    expect(dynamodb.query).not.toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':pfx': 'PENDINGFLOW#' }),
    }));
  });
});
