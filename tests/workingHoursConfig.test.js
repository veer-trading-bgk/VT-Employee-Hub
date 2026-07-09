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

  // 2026-07-09 Phase 2 of the welcome-message {{1}} incident audit
  // (docs/phase3/TECHNICAL_DEBT.md, Q4): OOO shares resolveWelcomeVariables()
  // with the welcome message, so it shares the same save-time validation gap.
  test('rejects messageText containing an unsupported {{1}} token', () => {
    const r = oooConfigSchema.safeParse({ enabled: true, messageText: "We're closed, {{1}}." });
    expect(r.success).toBe(false);
    expect(r.error.issues.some((i) => i.path.join('.') === 'messageText' && /Unknown variable \{\{1\}\}/.test(i.message))).toBe(true);
  });

  test('accepts messageText using all 3 supported tokens, including the new {{source}}', () => {
    expect(oooConfigSchema.safeParse({
      enabled: true, messageText: "Hi {{name}}, we're closed — reached via {{source}}, ring {{phone}} tomorrow.",
    }).success).toBe(true);
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

  // 2026-07-09 incident: GET returned the raw DynamoDB Item (PK/SK/companyId/
  // updatedAt included) for any company that had already saved once. The
  // frontend round-tripped that into its next PUT, and .strict() rejected the
  // unrecognized keys — so a second save (e.g. toggling back off) 400'd. Same
  // bug class as the 2026-07-07 aiAdmin.js incident documented in
  // validation.js's stripStorageMetadata() comment, just never swept here.
  test('GET strips DynamoDB storage metadata from a previously-saved config', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: {
          PK: 'CONFIG#HOURS#acme', SK: 'CURRENT', companyId: 'acme', updatedAt: '2026-07-08T16:30:30.897Z',
          enabled: true, timezone: 'Asia/Kolkata',
          schedule: {
            monday: { closed: false, open: '09:00', close: '18:00' },
            tuesday: { closed: false, open: '09:00', close: '18:00' },
            wednesday: { closed: false, open: '09:00', close: '18:00' },
            thursday: { closed: false, open: '09:00', close: '18:00' },
            friday: { closed: false, open: '09:00', close: '18:00' },
            saturday: { closed: false, open: '09:00', close: '18:00' },
            sunday: { closed: false, open: '09:00', close: '18:00' },
          },
        },
      }),
    });
    const handler = getRouteHandler(whatsappRouter, '/hours-config', 'get');
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());
    const { config } = res.json.mock.calls[0][0];
    expect(config).not.toHaveProperty('PK');
    expect(config).not.toHaveProperty('SK');
    expect(config).not.toHaveProperty('companyId');
    expect(config).not.toHaveProperty('updatedAt');
    expect(config.enabled).toBe(true);
    // Round-trippable: re-submitting the GET response as-is to PUT must not 400.
    expect(workingHoursConfigSchema.safeParse(config).success).toBe(true);
  });

  test('full round trip: toggle a previously-saved config off, save succeeds, refresh confirms still off', async () => {
    const storedItem = {
      PK: 'CONFIG#HOURS#acme', SK: 'CURRENT', companyId: 'acme', updatedAt: '2026-07-08T16:30:30.897Z',
      enabled: true, timezone: 'Asia/Kolkata',
      schedule: {
        monday: { closed: false, open: '09:00', close: '18:00' },
        tuesday: { closed: false, open: '09:00', close: '18:00' },
        wednesday: { closed: false, open: '09:00', close: '18:00' },
        thursday: { closed: false, open: '09:00', close: '18:00' },
        friday: { closed: false, open: '09:00', close: '18:00' },
        saturday: { closed: false, open: '09:00', close: '18:00' },
        sunday: { closed: false, open: '09:00', close: '18:00' },
      },
    };
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: storedItem }) });
    const getHandler = getRouteHandler(whatsappRouter, '/hours-config', 'get');
    const getRes = mockRes();
    await getHandler({ user: { companyId: 'acme' } }, getRes, jest.fn());
    const fetchedConfig = getRes.json.mock.calls[0][0].config;

    // Frontend toggles the master switch off and clicks Save (same payload
    // shape regardless of which Save button — see WorkingHoursPanel.tsx).
    const toggledOff = { ...fetchedConfig, enabled: false };

    let putItem = null;
    dynamodb.put.mockImplementation((args) => { putItem = args.Item; return { promise: () => Promise.resolve({}) }; });
    const putHandler = getRouteHandler(whatsappRouter, '/hours-config', 'put');
    const putRes = mockRes();
    await putHandler({ body: toggledOff, user: { companyId: 'acme' } }, putRes, jest.fn());
    expect(putRes.status).not.toHaveBeenCalledWith(400);
    expect(putRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(putItem.enabled).toBe(false);

    // Refresh: GET again against what was actually persisted.
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: putItem }) });
    const refreshRes = mockRes();
    await getHandler({ user: { companyId: 'acme' } }, refreshRes, jest.fn());
    expect(refreshRes.json.mock.calls[0][0].config.enabled).toBe(false);
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

  // Same 2026-07-09 incident as hours-config above — oooConfigSchema is also
  // .strict() and GET had the same raw-Item leak.
  test('GET strips DynamoDB storage metadata from a previously-saved config', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({
        Item: {
          PK: 'CONFIG#OOO#acme', SK: 'CURRENT', companyId: 'acme', updatedAt: '2026-07-08T16:30:31.053Z',
          enabled: true, messageText: 'we are currently closed',
        },
      }),
    });
    const handler = getRouteHandler(whatsappRouter, '/ooo-config', 'get');
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());
    const { config } = res.json.mock.calls[0][0];
    expect(config).not.toHaveProperty('PK');
    expect(config).not.toHaveProperty('SK');
    expect(config).not.toHaveProperty('companyId');
    expect(config).not.toHaveProperty('updatedAt');
    expect(oooConfigSchema.safeParse(config).success).toBe(true);
  });

  test('full round trip: toggle a previously-saved config off, save succeeds, refresh confirms still off', async () => {
    const storedItem = {
      PK: 'CONFIG#OOO#acme', SK: 'CURRENT', companyId: 'acme', updatedAt: '2026-07-08T16:30:31.053Z',
      enabled: true, messageText: 'we are currently closed',
    };
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: storedItem }) });
    const getHandler = getRouteHandler(whatsappRouter, '/ooo-config', 'get');
    const getRes = mockRes();
    await getHandler({ user: { companyId: 'acme' } }, getRes, jest.fn());
    const fetchedConfig = getRes.json.mock.calls[0][0].config;

    const toggledOff = { ...fetchedConfig, enabled: false };

    let putItem = null;
    dynamodb.put.mockImplementation((args) => { putItem = args.Item; return { promise: () => Promise.resolve({}) }; });
    const putHandler = getRouteHandler(whatsappRouter, '/ooo-config', 'put');
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
