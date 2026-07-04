'use strict';

/**
 * Contract tests for CONFIG#HOURS + CONFIG#OOO (Item 2) — same
 * direct-handler-invocation technique as delayedResponseConfig.test.js.
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
const { workingHoursConfigSchema, oooConfigSchema } = require('../src/utils/validation');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('workingHoursConfigSchema', () => {
  test('accepts a valid full-week schedule', () => {
    const r = workingHoursConfigSchema.safeParse({
      enabled: true, timezone: 'Asia/Kolkata',
      schedule: {
        monday: { closed: false, open: '09:00', close: '18:00' },
        tuesday: { closed: false, open: '09:00', close: '18:00' },
        wednesday: { closed: false, open: '09:00', close: '18:00' },
        thursday: { closed: false, open: '09:00', close: '18:00' },
        friday: { closed: false, open: '09:00', close: '18:00' },
        saturday: { closed: true, open: '09:00', close: '18:00' },
        sunday: { closed: true, open: '09:00', close: '18:00' },
      },
    });
    expect(r.success).toBe(true);
  });

  test('defaults to disabled with a Mon-Fri 9-6 IST schedule when omitted', () => {
    const r = workingHoursConfigSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data.enabled).toBe(false);
    expect(r.data.timezone).toBe('Asia/Kolkata');
    expect(r.data.schedule.monday).toEqual({ closed: false, open: '09:00', close: '18:00' });
    expect(r.data.schedule.saturday.closed).toBe(true);
  });

  test('rejects a malformed HH:MM time', () => {
    expect(workingHoursConfigSchema.safeParse({
      schedule: { monday: { open: '9:00', close: '18:00' } },
    }).success).toBe(false);
  });
});

describe('oooConfigSchema', () => {
  test('accepts a valid config', () => {
    expect(oooConfigSchema.safeParse({ enabled: true, messageText: 'We are closed.' }).success).toBe(true);
  });

  test('defaults to disabled with empty message text', () => {
    const r = oooConfigSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ enabled: false, messageText: '' });
  });
});

describe('PUT/GET /api/whatsapp/hours-config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('PUT rejects invalid config with 400 and never writes', async () => {
    const handler = getRouteHandler(whatsappRouter, '/hours-config', 'put');
    const res = mockRes();
    await handler({ body: { schedule: { monday: { open: 'bad' } } }, user: { companyId: 'acme' } }, res, jest.fn());
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('PUT saves a valid config', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/hours-config', 'put');
    const res = mockRes();
    await handler({ body: { enabled: true, timezone: 'Asia/Kolkata' }, user: { companyId: 'acme' } }, res, jest.fn());
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: 'CONFIG#HOURS#acme', SK: 'CURRENT', enabled: true }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('GET returns disabled defaults when no config exists yet', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/hours-config', 'get');
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      config: expect.objectContaining({ enabled: false, timezone: 'Asia/Kolkata' }),
    }));
  });
});

describe('PUT/GET /api/whatsapp/ooo-config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('PUT rejects invalid config with 400 and never writes', async () => {
    const handler = getRouteHandler(whatsappRouter, '/ooo-config', 'put');
    const res = mockRes();
    await handler({ body: { enabled: 'yes' }, user: { companyId: 'acme' } }, res, jest.fn());
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('PUT saves a valid config', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/ooo-config', 'put');
    const res = mockRes();
    await handler({ body: { enabled: true, messageText: 'Closed for now, {{name}}.' }, user: { companyId: 'acme' } }, res, jest.fn());
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: 'CONFIG#OOO#acme', SK: 'CURRENT', messageText: 'Closed for now, {{name}}.' }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('GET returns disabled defaults when no config exists yet', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/ooo-config', 'get');
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      config: expect.objectContaining({ enabled: false, messageText: '' }),
    }));
  });
});
