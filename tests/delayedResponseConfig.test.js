'use strict';

/**
 * Contract tests for CONFIG#DELAYED_RESPONSE (Item 3's "Config: delay time,
 * message content, enabled toggle") — same direct-handler-invocation
 * technique as whatsappWelcomeButtons.test.js, mirroring CONFIG#WELCOME's own
 * GET/PUT shape exactly.
 */

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(),
  get: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const dynamodb = require('../src/config/dynamodb');
const whatsappRouter = require('../src/routes/whatsapp');
const { delayedResponseConfigSchema } = require('../src/utils/validation');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('delayedResponseConfigSchema', () => {
  test('accepts a valid config', () => {
    expect(delayedResponseConfigSchema.safeParse({
      enabled: true, delayAmount: 10, delayUnit: 'minutes', messageText: 'Still there?',
    }).success).toBe(true);
  });

  test('defaults enabled to false and delayAmount to 5 minutes when omitted', () => {
    const r = delayedResponseConfigSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data).toEqual(expect.objectContaining({ enabled: false, delayAmount: 5, delayUnit: 'minutes' }));
  });

  test('rejects a delayAmount of 0 or over 1440', () => {
    expect(delayedResponseConfigSchema.safeParse({ delayAmount: 0 }).success).toBe(false);
    expect(delayedResponseConfigSchema.safeParse({ delayAmount: 1441 }).success).toBe(false);
  });

  test('rejects an unknown delayUnit', () => {
    expect(delayedResponseConfigSchema.safeParse({ delayUnit: 'days' }).success).toBe(false);
  });
});

describe('PUT /api/whatsapp/delayed-response-config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects invalid config with 400 and never writes', async () => {
    const handler = getRouteHandler(whatsappRouter, '/delayed-response-config', 'put');
    const req = { body: { delayAmount: 0 }, user: { companyId: 'acme' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('saves a valid config', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/delayed-response-config', 'put');
    const req = {
      body: { enabled: true, delayAmount: 15, delayUnit: 'minutes', messageText: 'Sorry for the delay, {{name}}!' },
      user: { companyId: 'acme' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledTimes(1);
    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item.PK).toBe('CONFIG#DELAYED_RESPONSE#acme');
    expect(putArgs.Item.SK).toBe('CURRENT');
    expect(putArgs.Item.enabled).toBe(true);
    expect(putArgs.Item.delayAmount).toBe(15);
    expect(putArgs.Item.messageText).toBe('Sorry for the delay, {{name}}!');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('GET /api/whatsapp/delayed-response-config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns disabled defaults when no config exists yet', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/delayed-response-config', 'get');
    const req = { user: { companyId: 'acme' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      config: expect.objectContaining({ enabled: false, delayAmount: 5, delayUnit: 'minutes', messageText: '' }),
    }));
  });

  test('returns a stored config as-is', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { enabled: true, delayAmount: 20, delayUnit: 'minutes', messageText: 'hi' } }) });
    const handler = getRouteHandler(whatsappRouter, '/delayed-response-config', 'get');
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      config: expect.objectContaining({ enabled: true, delayAmount: 20 }),
    }));
  });

  // Same 2026-07-09 incident as hours-config/ooo-config (see
  // workingHoursConfig.test.js) — delayedResponseConfigSchema is also
  // .strict() and this route had the same raw-Item GET leak. No company had
  // hit it live yet (no CONFIG#DELAYED_RESPONSE# record existed for the
  // reporting company at diagnosis time), so this is a synthetic
  // second-save shape, not a reproduction of a live incident.
  test('GET strips DynamoDB storage metadata from a previously-saved config', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: {
          PK: 'CONFIG#DELAYED_RESPONSE#acme', SK: 'CURRENT', companyId: 'acme', updatedAt: '2026-07-08T00:00:00.000Z',
          enabled: true, delayAmount: 10, delayUnit: 'minutes', messageText: 'Sorry for the delay',
        },
      }),
    });
    const handler = getRouteHandler(whatsappRouter, '/delayed-response-config', 'get');
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());
    const { config } = res.json.mock.calls[0][0];
    expect(config).not.toHaveProperty('PK');
    expect(config).not.toHaveProperty('SK');
    expect(config).not.toHaveProperty('companyId');
    expect(config).not.toHaveProperty('updatedAt');
    expect(delayedResponseConfigSchema.safeParse(config).success).toBe(true);
  });

  test('full round trip: toggle a previously-saved config off, save succeeds, refresh confirms still off', async () => {
    const storedItem = {
      PK: 'CONFIG#DELAYED_RESPONSE#acme', SK: 'CURRENT', companyId: 'acme', updatedAt: '2026-07-08T00:00:00.000Z',
      enabled: true, delayAmount: 10, delayUnit: 'minutes', messageText: 'Sorry for the delay',
    };
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: storedItem }) });
    const getHandler = getRouteHandler(whatsappRouter, '/delayed-response-config', 'get');
    const getRes = mockRes();
    await getHandler({ user: { companyId: 'acme' } }, getRes, jest.fn());
    const fetchedConfig = getRes.json.mock.calls[0][0].config;

    const toggledOff = { ...fetchedConfig, enabled: false };

    let putItem = null;
    dynamodb.put.mockImplementation((args) => { putItem = args.Item; return { promise: () => Promise.resolve({}) }; });
    const putHandler = getRouteHandler(whatsappRouter, '/delayed-response-config', 'put');
    const putRes = mockRes();
    await putHandler({ body: toggledOff, user: { companyId: 'acme' } }, putRes, jest.fn());
    expect(putRes.status).not.toHaveBeenCalledWith(400);
    expect(putRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(putItem.enabled).toBe(false);

    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: putItem }) });
    const refreshRes = mockRes();
    await getHandler({ user: { companyId: 'acme' } }, refreshRes, jest.fn());
    expect(refreshRes.json.mock.calls[0][0].config.enabled).toBe(false);
  });
});
