'use strict';

/**
 * Contract tests for the builder-managed Flow routes
 * (POST /flows/builder, PUT /flows/builder/:flowId,
 *  POST /flows/builder/:flowId/publish, GET /flows/builder/:flowId/preview).
 *
 * Same direct-handler-invocation technique as whatsappFlows.test.js.
 * FlowManagementService is mocked — its own Meta-call behavior (wabaId gate,
 * in-body validation-error parsing) is covered by flowManagementService.test.js;
 * these tests cover the route-layer contracts:
 *  • create-on-Meta-first sequencing (no local row until Meta issues flow_id)
 *  • CONFIG#FLOW# extension shape (status/statusHistory/source/flowJson)
 *  • source guard — register-by-ID rows (including pre-builder rows with no
 *    source attribute) are never editable/publishable via builder routes
 *  • Meta validation errors persisted to statusHistory AND returned
 */

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(), get: jest.fn(), query: jest.fn(), update: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(),
}));
jest.mock('../src/services/FlowManagementService', () => ({
  createFlow: jest.fn(),
  uploadFlowJson: jest.fn(),
  publishFlow: jest.fn(),
  getPreviewUrl: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const dynamodb = require('../src/config/dynamodb');
const FlowManagementService = require('../src/services/FlowManagementService');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const ADMIN = { companyId: 'acme', id: 'emp_1', name: 'Test Admin' };
const CREATE_BODY = { name: 'Webinar Reg', bodyText: 'Register below', ctaLabel: 'Register' };
const FLOW_JSON = { version: '7.0', screens: [{ id: 'S1' }] };

describe('POST /api/whatsapp/flows/builder', () => {
  beforeEach(() => jest.clearAllMocks());

  test('create-on-Meta-first: local row is NOT written when Meta creation fails', async () => {
    const metaErr = Object.assign(new Error('WABA not connected'), { status: 400, code: 'WABA_NOT_CONNECTED' });
    FlowManagementService.createFlow.mockRejectedValue(metaErr);
    const handler = getRouteHandler(whatsappRouter, '/flows/builder', 'post');

    const res = mockRes();
    await handler({ body: CREATE_BODY, user: ADMIN }, res, jest.fn());

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'WABA not connected', code: 'WABA_NOT_CONNECTED' }));
  });

  test('create-on-Meta-first: on success, Meta create is invoked BEFORE the local write, and the row uses Meta\'s flow_id', async () => {
    FlowManagementService.createFlow.mockResolvedValue({ flowId: 'meta_flow_9' });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/flows/builder', 'post');

    const res = mockRes();
    await handler({ body: { ...CREATE_BODY, categories: ['SIGN_UP'], screenId: 'WELCOME' }, user: ADMIN }, res, jest.fn());

    expect(FlowManagementService.createFlow.mock.invocationCallOrder[0])
      .toBeLessThan(dynamodb.put.mock.invocationCallOrder[0]);
    expect(FlowManagementService.createFlow).toHaveBeenCalledWith('acme', { name: 'Webinar Reg', categories: ['SIGN_UP'] });

    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item).toMatchObject({
      PK: 'CONFIG#FLOW#acme',
      SK: 'FLOW#meta_flow_9',
      flowId: 'meta_flow_9',
      name: 'Webinar Reg',
      bodyText: 'Register below',
      ctaLabel: 'Register',
      screenId: 'WELCOME',
      context: 'manual',
      source: 'builder',
      status: 'DRAFT',
      flowJson: null,
    });
    expect(putArgs.Item.statusHistory).toEqual([expect.objectContaining({ status: 'DRAFT', reason: null })]);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test.each([
    ['name', { bodyText: 'x', ctaLabel: 'x' }],
    ['bodyText', { name: 'x', ctaLabel: 'x' }],
    ['ctaLabel', { name: 'x', bodyText: 'x' }],
  ])('rejects a missing %s with 400 before any Meta call or write', async (_field, body) => {
    const handler = getRouteHandler(whatsappRouter, '/flows/builder', 'post');
    const res = mockRes();
    await handler({ body, user: ADMIN }, res, jest.fn());

    expect(FlowManagementService.createFlow).not.toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects malformed categories with 400 before any Meta call', async () => {
    const handler = getRouteHandler(whatsappRouter, '/flows/builder', 'post');
    for (const categories of ['SIGN_UP', [42], ['']]) {
      const res = mockRes();
      await handler({ body: { ...CREATE_BODY, categories }, user: ADMIN }, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(FlowManagementService.createFlow).not.toHaveBeenCalled();
  });

  test('non-string scalar inputs get a 400, not a TypeError 500', async () => {
    const handler = getRouteHandler(whatsappRouter, '/flows/builder', 'post');
    const bads = [
      { ...CREATE_BODY, name: 42 },
      { ...CREATE_BODY, bodyText: true },
      { ...CREATE_BODY, ctaLabel: { nested: 'object' } },
      { ...CREATE_BODY, screenId: 123 },
    ];
    for (const body of bads) {
      const res = mockRes();
      const next = jest.fn();
      await handler({ body, user: ADMIN }, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled(); // never escalates to the 500 handler
    }
    expect(FlowManagementService.createFlow).not.toHaveBeenCalled();
  });
});

describe('cross-feature protection: register-by-ID POST /flows vs builder rows', () => {
  beforeEach(() => jest.clearAllMocks());

  test('registering a flowId that collides with a builder row returns 409 instead of silently clobbering it', async () => {
    const condErr = Object.assign(new Error('conditional failed'), { code: 'ConditionalCheckFailedException' });
    dynamodb.put.mockReturnValue({ promise: () => Promise.reject(condErr) });
    const handler = getRouteHandler(whatsappRouter, '/flows', 'post');

    const res = mockRes();
    const next = jest.fn();
    await handler({
      body: { flowId: 'builder_owned', name: 'x', bodyText: 'x', ctaLabel: 'x' },
      user: ADMIN,
    }, res, next);

    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.ConditionExpression).toBe('attribute_not_exists(SK) OR attribute_not_exists(#src)');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });

  test('fresh registration and legacy manual-row overwrite still succeed (condition passes)', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/flows', 'post');

    const res = mockRes();
    await handler({
      body: { flowId: 'fresh_1', name: 'x', bodyText: 'x', ctaLabel: 'x' },
      user: ADMIN,
    }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('cross-feature protection: sendRegisteredFlow DRAFT gate', () => {
  beforeEach(() => jest.clearAllMocks());

  const sendFlow = () => getRouteHandler(whatsappRouter, '/inbox/:leadId/send-flow', 'post');

  test('a builder DRAFT flow is not sendable — 400, sendInteractive never called', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { flowId: 'f1', source: 'builder', status: 'DRAFT', bodyText: 'x', ctaLabel: 'Go' } }),
    });
    const WASendSvc = require('../src/services/WhatsAppSendService');

    const res = mockRes();
    await sendFlow()({ params: { leadId: 'lead_1' }, body: { flowId: 'f1' }, user: ADMIN }, res, jest.fn());

    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('draft') }));
  });

  test('a builder PUBLISHED flow sends normally', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { flowId: 'f1', source: 'builder', status: 'PUBLISHED', bodyText: 'x', ctaLabel: 'Go', screenId: null } }),
    });
    const WASendSvc = require('../src/services/WhatsAppSendService');
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w1', timestamp: 't1' });

    const res = mockRes();
    await sendFlow()({ params: { leadId: 'lead_1' }, body: { flowId: 'f1' }, user: ADMIN }, res, jest.fn());

    expect(WASendSvc.sendInteractive).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('manual register-by-ID rows (no source/status attributes) send exactly as before', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { flowId: 'f2', bodyText: 'x', ctaLabel: 'Go', screenId: null } }),
    });
    const WASendSvc = require('../src/services/WhatsAppSendService');
    WASendSvc.sendInteractive.mockResolvedValue({ wamid: 'w2', timestamp: 't2' });

    const res = mockRes();
    await sendFlow()({ params: { leadId: 'lead_1' }, body: { flowId: 'f2' }, user: ADMIN }, res, jest.fn());

    expect(WASendSvc.sendInteractive).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('PUT /api/whatsapp/flows/builder/:flowId', () => {
  beforeEach(() => jest.clearAllMocks());

  const put = () => getRouteHandler(whatsappRouter, '/flows/builder/:flowId', 'put');

  function mockExistingFlow(item) {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve(item ? { Item: item } : {}) });
  }

  test('404s when the flow is not registered for this company', async () => {
    mockExistingFlow(null);
    const res = mockRes();
    await put()({ params: { flowId: 'nope' }, body: { flowJson: FLOW_JSON }, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(FlowManagementService.uploadFlowJson).not.toHaveBeenCalled();
  });

  test.each([
    ['explicit manual source', { source: 'manual' }],
    ['pre-builder row with no source attribute', {}],
  ])('rejects a register-by-ID row (%s) with 400', async (_label, sourceAttrs) => {
    mockExistingFlow({ flowId: 'f1', status: 'DRAFT', ...sourceAttrs });
    const res = mockRes();
    await put()({ params: { flowId: 'f1' }, body: { flowJson: FLOW_JSON }, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(FlowManagementService.uploadFlowJson).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('rejects editing a PUBLISHED flow with 400 (immutable on Meta)', async () => {
    mockExistingFlow({ flowId: 'f1', source: 'builder', status: 'PUBLISHED' });
    const res = mockRes();
    await put()({ params: { flowId: 'f1' }, body: { flowJson: FLOW_JSON }, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(FlowManagementService.uploadFlowJson).not.toHaveBeenCalled();
  });

  test('Meta validation errors are stored on a capped statusHistory entry AND returned with success:false', async () => {
    mockExistingFlow({ flowId: 'f1', source: 'builder', status: 'DRAFT', updatedAt: 'T0', statusHistory: [] });
    const validationErrors = Array.from({ length: 14 }, (_, i) => ({ error: 'INVALID_PROPERTY', message: `bad ${i}`, line_start: i }));
    FlowManagementService.uploadFlowJson.mockResolvedValue({ success: false, validationErrors });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });

    const res = mockRes();
    await put()({ params: { flowId: 'f1' }, body: { flowJson: FLOW_JSON }, user: ADMIN }, res, jest.fn());

    const [updateArgs] = dynamodb.update.mock.calls[0];
    expect(updateArgs.Key).toEqual({ PK: 'CONFIG#FLOW#acme', SK: 'FLOW#f1' });
    expect(updateArgs.ExpressionAttributeValues[':fj']).toEqual(FLOW_JSON);
    const newHistory = updateArgs.ExpressionAttributeValues[':nh'];
    expect(newHistory).toHaveLength(1);
    expect(newHistory[0].reason).toContain('14 validation error');
    expect(newHistory[0].validationErrors).toHaveLength(10); // capped at MAX_STORED_VALIDATION_ERRORS
    // full uncapped list still returned to the caller
    expect(res.json).toHaveBeenCalledWith({ success: false, validationErrors });
  });

  test('clean upload appends NO history entry (TMPL transitions-only precedent) and returns success:true', async () => {
    mockExistingFlow({ flowId: 'f1', source: 'builder', status: 'DRAFT', updatedAt: 'T0', statusHistory: [{ status: 'DRAFT', ts: 'T0', reason: null }] });
    FlowManagementService.uploadFlowJson.mockResolvedValue({ success: true, validationErrors: [] });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });

    const res = mockRes();
    await put()({ params: { flowId: 'f1' }, body: { flowJson: FLOW_JSON }, user: ADMIN }, res, jest.fn());

    const newHistory = dynamodb.update.mock.calls[0][0].ExpressionAttributeValues[':nh'];
    expect(newHistory).toEqual([{ status: 'DRAFT', ts: 'T0', reason: null }]); // unchanged, nothing appended
    expect(res.json).toHaveBeenCalledWith({ success: true, validationErrors: [] });
  });

  test('statusHistory is capped at 20 entries even across repeated failing uploads', async () => {
    const fullHistory = Array.from({ length: 20 }, (_, i) => ({ status: 'DRAFT', ts: `T${i}`, reason: 'old' }));
    mockExistingFlow({ flowId: 'f1', source: 'builder', status: 'DRAFT', updatedAt: 'T0', statusHistory: fullHistory });
    FlowManagementService.uploadFlowJson.mockResolvedValue({ success: false, validationErrors: [{ error: 'X' }] });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });

    await put()({ params: { flowId: 'f1' }, body: { flowJson: FLOW_JSON }, user: ADMIN }, mockRes(), jest.fn());

    const newHistory = dynamodb.update.mock.calls[0][0].ExpressionAttributeValues[':nh'];
    expect(newHistory).toHaveLength(20); // oldest dropped, newest appended
    expect(newHistory[0].ts).toBe('T1');
    expect(newHistory[19].validationErrors).toEqual([{ error: 'X' }]);
  });

  test('update is version-conditioned (attribute_exists + not-published + updatedAt match) and a lost race returns 409', async () => {
    mockExistingFlow({ flowId: 'f1', source: 'builder', status: 'DRAFT', updatedAt: 'T0' });
    FlowManagementService.uploadFlowJson.mockResolvedValue({ success: true, validationErrors: [] });
    const condErr = Object.assign(new Error('conditional failed'), { code: 'ConditionalCheckFailedException' });
    dynamodb.update.mockReturnValue({ promise: () => Promise.reject(condErr) });

    const res = mockRes();
    const next = jest.fn();
    await put()({ params: { flowId: 'f1' }, body: { flowJson: FLOW_JSON }, user: ADMIN }, res, next);

    const [updateArgs] = dynamodb.update.mock.calls[0];
    expect(updateArgs.ConditionExpression).toContain('attribute_exists(PK)');
    expect(updateArgs.ConditionExpression).toContain('updatedAt = :expectedUa');
    expect(updateArgs.ExpressionAttributeValues[':expectedUa']).toBe('T0');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled(); // handled, not a 500
  });

  test('rejects a missing/non-object flowJson with 400 before any lookup', async () => {
    const res = mockRes();
    await put()({ params: { flowId: 'f1' }, body: {}, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.get).not.toHaveBeenCalled();
  });

  test('size guard measures UTF-8 bytes, not UTF-16 chars — multibyte-script JSON under the char count still 400s', async () => {
    // ~120k Kannada chars ≈ 360KB UTF-8 — passes a naive .length<300000 check, must still be rejected
    const kannada = 'ಕನ್ನಡಪಠ್ಯ'.repeat(15000);
    const res = mockRes();
    await put()({ params: { flowId: 'f1' }, body: { flowJson: { version: '7.0', text: kannada } }, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('bytes') }));
    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(FlowManagementService.uploadFlowJson).not.toHaveBeenCalled();
  });

  test('rejects flowJson nested deeper than 30 levels (DynamoDB 32-level limit) BEFORE the Meta upload', async () => {
    let deep = { end: true };
    for (let i = 0; i < 35; i++) deep = { child: deep };
    const res = mockRes();
    await put()({ params: { flowId: 'f1' }, body: { flowJson: deep }, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(FlowManagementService.uploadFlowJson).not.toHaveBeenCalled();
  });
});

describe('POST /api/whatsapp/flows/builder/:flowId/publish', () => {
  beforeEach(() => jest.clearAllMocks());

  const publish = () => getRouteHandler(whatsappRouter, '/flows/builder/:flowId/publish', 'post');

  test('publishes on Meta then flips status to PUBLISHED via a conditioned update with a history entry', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { flowId: 'f1', source: 'builder', status: 'DRAFT', updatedAt: 'T0', statusHistory: [] } }) });
    FlowManagementService.publishFlow.mockResolvedValue({ success: true });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });

    const res = mockRes();
    await publish()({ params: { flowId: 'f1' }, user: ADMIN }, res, jest.fn());

    expect(FlowManagementService.publishFlow).toHaveBeenCalledWith('acme', 'f1');
    const [updateArgs] = dynamodb.update.mock.calls[0];
    expect(updateArgs.ExpressionAttributeValues[':s']).toBe('PUBLISHED');
    expect(updateArgs.ExpressionAttributeValues[':nh'].at(-1)).toMatchObject({ status: 'PUBLISHED', reason: null });
    expect(updateArgs.ConditionExpression).toContain('attribute_exists(PK)');
    expect(updateArgs.ExpressionAttributeValues[':expectedUa']).toBe('T0');
    expect(res.json).toHaveBeenCalledWith({ success: true, status: 'PUBLISHED' });
  });

  test('Meta 200-with-success:false does NOT flip the local row — 502, no DDB update (no false-PUBLISHED brick)', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { flowId: 'f1', source: 'builder', status: 'DRAFT', updatedAt: 'T0' } }) });
    FlowManagementService.publishFlow.mockResolvedValue({ success: false });

    const res = mockRes();
    await publish()({ params: { flowId: 'f1' }, user: ADMIN }, res, jest.fn());

    expect(dynamodb.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('still a draft') }));
  });

  test('400s on an already-PUBLISHED flow without calling Meta', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { flowId: 'f1', source: 'builder', status: 'PUBLISHED' } }) });
    const res = mockRes();
    await publish()({ params: { flowId: 'f1' }, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(FlowManagementService.publishFlow).not.toHaveBeenCalled();
  });

  test('400s on a register-by-ID row without calling Meta', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { flowId: 'f1', status: 'DRAFT' } }) });
    const res = mockRes();
    await publish()({ params: { flowId: 'f1' }, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(FlowManagementService.publishFlow).not.toHaveBeenCalled();
  });

  test('404s and never publishes when the flow is unknown', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const res = mockRes();
    await publish()({ params: { flowId: 'nope' }, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(FlowManagementService.publishFlow).not.toHaveBeenCalled();
  });
});

describe('GET /api/whatsapp/flows/builder/:flowId/preview', () => {
  beforeEach(() => jest.clearAllMocks());

  const preview = () => getRouteHandler(whatsappRouter, '/flows/builder/:flowId/preview', 'get');

  test('404s for a flow not registered to this company (tenant scoping) without calling Meta', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const res = mockRes();
    await preview()({ params: { flowId: 'other_co_flow' }, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(FlowManagementService.getPreviewUrl).not.toHaveBeenCalled();
  });

  test('proxies the Meta preview URL for a registered flow', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { flowId: 'f1', source: 'builder' } }) });
    FlowManagementService.getPreviewUrl.mockResolvedValue({ previewUrl: 'https://business.facebook.com/preview?t=1', expiresAt: '2026-07-23' });

    const res = mockRes();
    await preview()({ params: { flowId: 'f1' }, user: ADMIN }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true, previewUrl: 'https://business.facebook.com/preview?t=1', expiresAt: '2026-07-23' });
  });
});
