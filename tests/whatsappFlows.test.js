'use strict';

/**
 * Contract tests for WhatsApp Flows support: CONFIG#FLOW CRUD, the send-flow
 * route (reuses WhatsAppSendService.sendInteractive() unmodified — ADR-012),
 * and inbound flow_response (nfm_reply) parsing in the webhook. Same
 * direct-handler-invocation technique as whatsappNotes.test.js: no HTTP, no
 * auth token, dynamodb/WhatsAppSendService mocked.
 */

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(),
  get: jest.fn(),
  query: jest.fn(),
  delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const dynamodb = require('../src/config/dynamodb');
const WASendSvc = require('../src/services/WhatsAppSendService');
const whatsappRouter = require('../src/routes/whatsapp');
const crmRouter = require('../src/routes/crm');
const formsRouter = require('../src/routes/forms');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('GET /api/whatsapp/flows', () => {
  beforeEach(() => jest.clearAllMocks());

  test('route is registered and lists CONFIG#FLOW items for the caller\'s company', async () => {
    const handler = getRouteHandler(whatsappRouter, '/flows', 'get');
    expect(handler).toBeInstanceOf(Function);

    dynamodb.query.mockReturnValue({
      promise: () => Promise.resolve({ Items: [{ flowId: '123', name: 'KYC Form' }] }),
    });
    const req = { user: { companyId: 'acme' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    const [queryArgs] = dynamodb.query.mock.calls[0];
    expect(queryArgs.ExpressionAttributeValues[':pk']).toBe('CONFIG#FLOW#acme');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, flows: [{ flowId: '123', name: 'KYC Form' }] }));
  });
});

describe('POST /api/whatsapp/flows', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a flow record keyed CONFIG#FLOW#{companyId}/FLOW#{flowId}', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/flows', 'post');

    const req = {
      body: { flowId: '999888777', name: 'KYC Form', bodyText: 'Please complete this form', ctaLabel: 'Start' },
      user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledTimes(1);
    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item.PK).toBe('CONFIG#FLOW#acme');
    expect(putArgs.Item.SK).toBe('FLOW#999888777');
    expect(putArgs.Item.context).toBe('manual');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test.each([
    ['flowId', { name: 'x', bodyText: 'x', ctaLabel: 'x' }],
    ['name', { flowId: '1', bodyText: 'x', ctaLabel: 'x' }],
    ['bodyText', { flowId: '1', name: 'x', ctaLabel: 'x' }],
    ['ctaLabel', { flowId: '1', name: 'x', bodyText: 'x' }],
  ])('rejects a missing %s with 400 and never writes', async (_field, body) => {
    const handler = getRouteHandler(whatsappRouter, '/flows', 'post');
    const req = { body, user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a ctaLabel over 20 characters (Meta flow_cta limit)', async () => {
    const handler = getRouteHandler(whatsappRouter, '/flows', 'post');
    const req = {
      body: { flowId: '1', name: 'x', bodyText: 'x', ctaLabel: 'This label is way too long' },
      user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('DELETE /api/whatsapp/flows/:flowId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes the correct company-scoped key', async () => {
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/flows/:flowId', 'delete');
    const req = { params: { flowId: '999888777' }, user: { companyId: 'acme' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: 'CONFIG#FLOW#acme', SK: 'FLOW#999888777' },
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('POST /api/whatsapp/inbox/:leadId/send-flow', () => {
  beforeEach(() => jest.clearAllMocks());

  test('404s when the flowId is not registered for this company', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/send-flow', 'post');
    const req = { params: { leadId: 'lead_1' }, body: { flowId: '404' }, user: { companyId: 'acme' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400s when flowId is missing from the request body', async () => {
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/send-flow', 'post');
    const req = { params: { leadId: 'lead_1' }, body: {}, user: { companyId: 'acme' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('sends via sendInteractive() unmodified, with a correctly-shaped flow payload', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: { flowId: '999888777', bodyText: 'Please complete this form', ctaLabel: 'Start', screenId: 'WELCOME' },
      }),
    });
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.abc', timestamp: '2026-07-03T10:00:00.000Z' });

    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/send-flow', 'post');
    const req = {
      params: { leadId: 'lead_1' },
      body: { flowId: '999888777' },
      user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(WASendSvc.sendInteractive).toHaveBeenCalledTimes(1);
    const [companyId, target, interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(companyId).toBe('acme');
    expect(target).toEqual({ leadId: 'lead_1' });
    expect(interactive.type).toBe('flow');
    expect(interactive.body.text).toBe('Please complete this form');
    expect(interactive.action.name).toBe('flow');
    expect(interactive.action.parameters.flow_id).toBe('999888777');
    expect(interactive.action.parameters.flow_cta).toBe('Start');
    expect(interactive.action.parameters.flow_action).toBe('navigate');
    expect(interactive.action.parameters.flow_action_payload).toEqual({ screen: 'WELCOME' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, messageId: 'wamid.abc' }));
  });

  test('omits flow_action_payload when no screenId was registered', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: { flowId: '1', bodyText: 'x', ctaLabel: 'Start', screenId: null },
      }),
    });
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w', timestamp: 't' });

    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/send-flow', 'post');
    const req = { params: { leadId: 'lead_1' }, body: { flowId: '1' }, user: { companyId: 'acme' } };
    await handler(req, mockRes(), jest.fn());

    const [, , interactive] = WASendSvc.sendInteractive.mock.calls[0];
    expect(interactive.action.parameters.flow_action_payload).toBeUndefined();
  });

  // Foundation for flowId correlation on the reply — see
  // whatsappFlowIdCorrelation.test.js for the consume side (nfm_reply webhook).
  test('writes a PENDINGFLOW# marker for correlation after a successful send, TTL ~48h out', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: { flowId: '999888777', bodyText: 'Please complete this form', ctaLabel: 'Start', screenId: null },
      }),
    });
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'wamid.abc', timestamp: '2026-07-03T10:00:00.000Z', pk: 'LEAD#acme#lead_1' });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/send-flow', 'post');
    const req = { params: { leadId: 'lead_1' }, body: { flowId: '999888777' }, user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent' } };
    await handler(req, mockRes(), jest.fn());

    const markerCall = dynamodb.put.mock.calls.find(([a]) => a.Item?.SK === 'PENDINGFLOW#999888777');
    expect(markerCall).toBeDefined();
    const [markerArgs] = markerCall;
    expect(markerArgs.Item.PK).toBe('LEAD#acme#lead_1');
    expect(markerArgs.Item.flowId).toBe('999888777');
    expect(typeof markerArgs.Item.sentAt).toBe('string');
    const nowSec = Math.floor(Date.now() / 1000);
    expect(markerArgs.Item.ttl).toBeGreaterThan(nowSec + 47 * 3600);
    expect(markerArgs.Item.ttl).toBeLessThan(nowSec + 49 * 3600);
  });

  test('marker write failure is caught and logged — never fails the send itself', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: { flowId: '1', bodyText: 'x', ctaLabel: 'Start', screenId: null },
      }),
    });
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w', timestamp: 't', pk: 'LEAD#acme#lead_1' });
    dynamodb.put.mockReturnValue({ promise: () => Promise.reject(new Error('ProvisionedThroughputExceededException')) });

    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/send-flow', 'post');
    const req = { params: { leadId: 'lead_1' }, body: { flowId: '1' }, user: { companyId: 'acme' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, messageId: 'w' }));
  });
});

describe('inbound flow_response (nfm_reply) parsing', () => {
  test('isFlowResponse is true only for interactive/nfm_reply, not text/media/other interactive subtypes', () => {
    expect(whatsappRouter.isFlowResponse({ type: 'text' })).toBe(false);
    expect(whatsappRouter.isFlowResponse({ type: 'image' })).toBe(false);
    expect(whatsappRouter.isFlowResponse({ type: 'interactive', interactive: { type: 'button_reply' } })).toBe(false);
    expect(whatsappRouter.isFlowResponse({ type: 'interactive', interactive: { type: 'list_reply' } })).toBe(false);
    expect(whatsappRouter.isFlowResponse({ type: 'interactive', interactive: { type: 'nfm_reply' } })).toBe(true);
  });

  test('parseFlowResponse turns response_json into a readable per-field summary, not raw JSON', () => {
    const msg = {
      interactive: {
        nfm_reply: {
          name: 'KYC Form',
          body: 'Sent',
          response_json: JSON.stringify({ full_name: 'Priya Sharma', pan_number: 'ABCDE1234F' }),
        },
      },
    };
    const result = whatsappRouter.parseFlowResponse(msg);
    expect(result.flowName).toBe('KYC Form');
    expect(result.fields).toEqual([
      { key: 'full_name', label: 'Full Name', value: 'Priya Sharma' },
      { key: 'pan_number', label: 'Pan Number', value: 'ABCDE1234F' },
    ]);
    expect(result.summary).toBe('Full Name: Priya Sharma\nPan Number: ABCDE1234F');
    expect(result.summary).not.toMatch(/[{}[\]]/); // never raw JSON
  });

  test('falls back to nfm_reply.body when response_json is malformed, without throwing', () => {
    const msg = { interactive: { nfm_reply: { name: 'X', body: 'Flow completed', response_json: '{not valid json' } } };
    const result = whatsappRouter.parseFlowResponse(msg);
    expect(result.fields).toEqual([]);
    expect(result.summary).toBe('Flow completed');
  });

  test('falls back to a generic placeholder when both response_json and body are absent', () => {
    const msg = { interactive: { nfm_reply: {} } };
    const result = whatsappRouter.parseFlowResponse(msg);
    expect(result.summary).toBe('[Flow response]');
  });
});

describe('CONFIG#FORM (forms.js) is untouched by the Flow work', () => {
  test('forms.js still has no /flows routes — separate systems, no cross-wiring', () => {
    const hasFlowsRoute = formsRouter.stack.some((l) => l.route && l.route.path?.includes('flow'));
    expect(hasFlowsRoute).toBe(false);
  });

  test('crm.js has no /flows routes either — flows live only in whatsapp.js', () => {
    const hasFlowsRoute = crmRouter.stack.some((l) => l.route && l.route.path?.includes('flow'));
    expect(hasFlowsRoute).toBe(false);
  });
});
