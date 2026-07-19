'use strict';

/**
 * buildTriggerForStorage()'s inbound_webhook token handling (Part B), exercised
 * through POST / and PUT /:id — same direct-handler-invocation technique used
 * throughout this codebase's route tests. buildTriggerForStorage itself isn't
 * exported, so these tests go through the routes that actually call it.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/AutomationEngine', () => ({
  fireTrigger: jest.fn(),
}));
jest.mock('../src/services/CustomerIdentityService', () => ({
  resolveOrCreate: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const automationsRouter = require('../src/routes/automations');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const CID = 'comp_test';
const USER = { companyId: CID, id: 'admin_1', name: 'Admin One' };

describe('POST / — inbound_webhook trigger token generation', () => {
  const handler = getRouteHandler(automationsRouter, '/', 'post');

  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
  });

  test('generates a fresh webhookToken on create', async () => {
    const res = mockRes();
    await handler({
      user: USER,
      body: { name: 'Webhook flow', trigger: { type: 'inbound_webhook', conditions: [] }, steps: [{ id: 's1', type: 'end', config: {} }] },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.trigger.type).toBe('inbound_webhook');
    expect(typeof item.trigger.webhookToken).toBe('string');
    expect(item.trigger.webhookToken.length).toBeGreaterThanOrEqual(32);
  });

  test('two separate creates get two different tokens', async () => {
    const res1 = mockRes();
    await handler({ user: USER, body: { name: 'A', trigger: { type: 'inbound_webhook', conditions: [] }, steps: [{ id: 's1', type: 'end', config: {} }] } }, res1, jest.fn());
    const res2 = mockRes();
    await handler({ user: USER, body: { name: 'B', trigger: { type: 'inbound_webhook', conditions: [] }, steps: [{ id: 's1', type: 'end', config: {} }] } }, res2, jest.fn());

    const token1 = dynamodb.put.mock.calls[0][0].Item.trigger.webhookToken;
    const token2 = dynamodb.put.mock.calls[1][0].Item.trigger.webhookToken;
    expect(token1).not.toBe(token2);
  });
});

describe('PUT /:id — inbound_webhook trigger token preservation/regeneration', () => {
  const handler = getRouteHandler(automationsRouter, '/:id', 'put');
  const EXISTING_TOKEN = 'existing-token-abc123';

  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
  });

  function mockExisting(trigger) {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: { id: 'wf1', companyId: CID, trigger, steps: [] },
      }),
    });
  }

  test('an unrelated edit (no regenerateToken flag) preserves the existing token', async () => {
    mockExisting({ type: 'inbound_webhook', conditions: [], webhookToken: EXISTING_TOKEN });
    const res = mockRes();

    await handler({
      params: { id: 'wf1' }, user: USER,
      body: { trigger: { type: 'inbound_webhook', conditions: [] } },
    }, res, jest.fn());

    const vals = dynamodb.update.mock.calls[0][0].ExpressionAttributeValues;
    expect(vals[':t'].webhookToken).toBe(EXISTING_TOKEN);
  });

  test('regenerateToken: true issues a new, different token', async () => {
    mockExisting({ type: 'inbound_webhook', conditions: [], webhookToken: EXISTING_TOKEN });
    const res = mockRes();

    await handler({
      params: { id: 'wf1' }, user: USER,
      body: { trigger: { type: 'inbound_webhook', conditions: [], regenerateToken: true } },
    }, res, jest.fn());

    const vals = dynamodb.update.mock.calls[0][0].ExpressionAttributeValues;
    expect(vals[':t'].webhookToken).not.toBe(EXISTING_TOKEN);
    expect(typeof vals[':t'].webhookToken).toBe('string');
  });

  test('switching from a different trigger type to inbound_webhook generates a fresh token, not undefined', async () => {
    mockExisting({ type: 'lead_created', conditions: [] });
    const res = mockRes();

    await handler({
      params: { id: 'wf1' }, user: USER,
      body: { trigger: { type: 'inbound_webhook', conditions: [] } },
    }, res, jest.fn());

    const vals = dynamodb.update.mock.calls[0][0].ExpressionAttributeValues;
    expect(typeof vals[':t'].webhookToken).toBe('string');
    expect(vals[':t'].webhookToken.length).toBeGreaterThanOrEqual(32);
  });

  test('the regenerateToken flag itself is never persisted onto the stored trigger', async () => {
    mockExisting({ type: 'inbound_webhook', conditions: [], webhookToken: EXISTING_TOKEN });
    const res = mockRes();

    await handler({
      params: { id: 'wf1' }, user: USER,
      body: { trigger: { type: 'inbound_webhook', conditions: [], regenerateToken: true } },
    }, res, jest.fn());

    const vals = dynamodb.update.mock.calls[0][0].ExpressionAttributeValues;
    expect(vals[':t']).not.toHaveProperty('regenerateToken');
  });
});

describe('POST / — flow_completed trigger config storage', () => {
  const handler = getRouteHandler(automationsRouter, '/', 'post');

  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
  });

  test('a real flowId is persisted trimmed under trigger.config', async () => {
    const res = mockRes();
    await handler({
      user: USER,
      body: {
        name: 'KYC follow-up',
        trigger: { type: 'flow_completed', conditions: [], config: { flowId: '  1564070475429845  ' } },
        steps: [{ id: 's1', type: 'end', config: {} }],
      },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.trigger.type).toBe('flow_completed');
    expect(item.trigger.config).toEqual({ flowId: '1564070475429845' });
  });

  test('blank/absent flowId persists NO config at all (the "any Flow" catch-all) — not a validation error', async () => {
    for (const config of [undefined, {}, { flowId: '' }, { flowId: '   ' }]) {
      jest.clearAllMocks();
      dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
      const res = mockRes();
      await handler({
        user: USER,
        body: {
          name: 'Any-flow catch-all',
          trigger: { type: 'flow_completed', conditions: [], ...(config !== undefined && { config }) },
          steps: [{ id: 's1', type: 'end', config: {} }],
        },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      const item = dynamodb.put.mock.calls[0][0].Item;
      expect(item.trigger.type).toBe('flow_completed');
      expect(item.trigger.config).toBeUndefined();
    }
  });
});

describe('POST / — comment_received trigger config storage (comment-to-DM v2, ADR-021)', () => {
  const handler = getRouteHandler(automationsRouter, '/', 'post');

  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
  });

  function post(config) {
    const res = mockRes();
    return handler({
      user: USER,
      body: {
        name: 'Comment → DM',
        trigger: { type: 'comment_received', conditions: [], config },
        steps: [{ id: 's1', type: 'end', config: {} }],
      },
    }, res, jest.fn()).then(() => res);
  }

  test('a valid config persists sanitized keywords + trimmed mediaId', async () => {
    const res = await post({ matchMode: 'contains', keywords: [' link ', '', 'guide'], mediaId: '  17900000000000000  ', caseSensitive: false });

    expect(res.status).toHaveBeenCalledWith(201);
    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.trigger.type).toBe('comment_received');
    expect(item.trigger.config).toEqual({ matchMode: 'contains', keywords: ['link', 'guide'], caseSensitive: false, mediaId: '17900000000000000' });
  });

  test('rejects with 400 when mediaId is missing — specific post/Reel targeting is required (not "all posts")', async () => {
    const res = await post({ matchMode: 'contains', keywords: ['link'] });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('mediaId is required') }));
  });

  test('rejects with 400 when keywords are empty — the shared keyword rule still applies', async () => {
    const res = await post({ matchMode: 'contains', keywords: [], mediaId: 'media_1' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('keywords must contain at least one') }));
  });

  test('rejects with 400 on an invalid matchMode', async () => {
    const res = await post({ matchMode: 'regex', keywords: ['link'], mediaId: 'media_1' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('matchMode must be') }));
  });
});
