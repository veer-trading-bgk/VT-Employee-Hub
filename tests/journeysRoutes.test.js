'use strict';

/**
 * Route tests for Journey Platform admin CRUD (Task 6):
 * definitions CRUD + instances list/detail. Direct-handler invocation for
 * happy paths; real checkRole middleware from the route stack for auth gates
 * (same technique as aiRoutes.test.js / instagramReadRoutes.test.js).
 */

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-wa-media';
process.env.PUBLIC_ASSETS_BUCKET = process.env.PUBLIC_ASSETS_BUCKET || 'apforce-public-assets-test';
process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), scan: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/config/s3', () => ({
  s3Client: { getSignedUrl: jest.fn(() => 'https://s3.example.com/presigned-put') },
  MEDIA_BUCKET: 'test-wa-media',
  PUBLIC_ASSETS_BUCKET: 'apforce-public-assets-test',
}));
jest.mock('../src/services/AutomationEngine', () => ({
  resumeOnWebhook: jest.fn(),
  fireTrigger: jest.fn(),
  runWorkflowDirect: jest.fn(),
}));
jest.mock('../src/utils/featureFlags', () => ({
  isEnabled: jest.fn().mockResolvedValue(true),
  getFlags: jest.fn(),
  DEFAULTS: { journeys_platform: false },
  _clearCache: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const { s3Client } = require('../src/config/s3');
const AutomationEngine = require('../src/services/AutomationEngine');
const { isEnabled } = require('../src/utils/featureFlags');
const {
  journeyDefPK,
  journeyDefSK,
  journeyPK,
  journeyMetaSK,
  journeyRecordSK,
  journeysByCompanyGsiPK,
  GSI,
} = require('../src/core/entityKeys');
const journeysRouter = require('../src/routes/journeys');

const CID = 'comp_test';
const ADMIN = { companyId: CID, id: 'emp_admin', role: 'admin', name: 'Admin' };
const MANAGER = { companyId: CID, id: 'emp_mgr', role: 'manager', name: 'Manager' };
const TELECALLER = { companyId: CID, id: 'emp_tc', role: 'telecaller', name: 'TC' };
const DEF_ID = 'journeydef_01TESTDEF000000000000000';
const JOURNEY_ID = 'journey_01TESTINSTANCE00000000000';

const resolved = (value) => ({ promise: () => Promise.resolve(value) });

function getRouteLayer(router, path, method) {
  return router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
}
function getRouteHandler(router, path, method) {
  const layer = getRouteLayer(router, path, method);
  return layer ? layer.route.stack[layer.route.stack.length - 1].handle : null;
}
function getRouteStack(router, path, method) {
  const layer = getRouteLayer(router, path, method);
  return layer ? layer.route.stack.map((s) => s.handle) : [];
}
function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  isEnabled.mockResolvedValue(true);
  dynamodb.put.mockReturnValue(resolved({}));
  dynamodb.get.mockReturnValue(resolved({}));
  dynamodb.update.mockReturnValue(resolved({}));
  dynamodb.query.mockReturnValue(resolved({ Items: [] }));
});

describe('POST /api/journeys/definitions', () => {
  const handler = getRouteHandler(journeysRouter, '/definitions', 'post');

  test('creates a definition with generateJourneyDefId, newMeta version, active:true', async () => {
    const res = mockRes();
    const next = jest.fn();
    await handler({
      user: ADMIN,
      body: {
        name: 'Hospital Booking',
        industryPack: 'healthcare',
        screens: [{ id: 's1', title: 'Patient', fields: [{ id: 'name', label: 'Name', type: 'text' }] }],
        linkedWorkflowId: 'wf_1',
      },
    }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(dynamodb.put).toHaveBeenCalledTimes(1);
    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.PK).toBe(journeyDefPK(CID));
    expect(item.SK).toMatch(/^DEF#journeydef_/);
    expect(item.SK).toBe(journeyDefSK(item.id));
    expect(item).toEqual(expect.objectContaining({
      name: 'Hospital Booking',
      industryPack: 'healthcare',
      active: true,
      version: 1,
      companyId: CID,
      linkedWorkflowId: 'wf_1',
    }));
    expect(item.createdAt).toBeTruthy();
    expect(item.createdBy).toBe('emp_admin');
  });

  test('zod validation failure → ZodError to next (400 via errorHandler)', async () => {
    const res = mockRes();
    const next = jest.fn();
    await handler({ user: ADMIN, body: { industryPack: 'healthcare' } }, res, next);
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  test('rejects unknown body fields (strict schema)', async () => {
    const res = mockRes();
    const next = jest.fn();
    await handler({
      user: ADMIN,
      body: { name: 'X', industryPack: 'generic', unexpected: true },
    }, res, next);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('brandingConfig accepts optional bannerImageUrl (absolute URL)', async () => {
    const res = mockRes();
    const next = jest.fn();
    await handler({
      user: ADMIN,
      body: {
        name: 'With banner',
        brandingConfig: {
          primaryColor: '#0ea5e9',
          bannerImageUrl: 'https://cdn.example.com/banners/clinic.jpg',
        },
      },
    }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(dynamodb.put.mock.calls[0][0].Item.brandingConfig).toEqual({
      primaryColor: '#0ea5e9',
      bannerImageUrl: 'https://cdn.example.com/banners/clinic.jpg',
    });
  });

  test('brandingConfig rejects non-URL bannerImageUrl', async () => {
    const res = mockRes();
    const next = jest.fn();
    await handler({
      user: ADMIN,
      body: {
        name: 'Bad banner',
        brandingConfig: { bannerImageUrl: 'not-a-url' },
      },
    }, res, next);
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  test('number field accepts unitPrice including 0; text field rejects unitPrice', async () => {
    const res = mockRes();
    const next = jest.fn();
    await handler({
      user: ADMIN,
      body: {
        name: 'Event Booking',
        screens: [{
          id: 's1',
          title: 'Tickets',
          fields: [
            { id: 'qty', label: 'Tickets', type: 'number', unitPrice: 500 },
            { id: 'free', label: 'Comps', type: 'number', unitPrice: 0 },
          ],
        }],
      },
    }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    const fields = dynamodb.put.mock.calls[0][0].Item.screens[0].fields;
    expect(fields[0].unitPrice).toBe(500);
    expect(fields[1].unitPrice).toBe(0);

    jest.clearAllMocks();
    const res2 = mockRes();
    const next2 = jest.fn();
    await handler({
      user: ADMIN,
      body: {
        name: 'Bad price',
        screens: [{
          id: 's1',
          title: 'X',
          fields: [{ id: 'name', label: 'Name', type: 'text', unitPrice: 10 }],
        }],
      },
    }, res2, next2);
    expect(next2.mock.calls[0][0].name).toBe('ZodError');
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('brandingConfig rejects unknown keys (strict)', async () => {
    const res = mockRes();
    const next = jest.fn();
    await handler({
      user: ADMIN,
      body: {
        name: 'Strict branding',
        brandingConfig: { primaryColor: '#fff', logoSecret: 'x' },
      },
    }, res, next);
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });
});

describe('GET /api/journeys/definitions', () => {
  const handler = getRouteHandler(journeysRouter, '/definitions', 'get');

  test('queries company partition with begins_with DEF# — never Scan', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [
        { id: 'a', SK: 'DEF#a', createdAt: '2026-01-02T00:00:00.000Z', name: 'Newer' },
        { id: 'b', SK: 'DEF#b', createdAt: '2026-01-01T00:00:00.000Z', name: 'Older' },
      ],
    }));
    const res = mockRes();
    await handler({ user: MANAGER }, res, jest.fn());

    expect(dynamodb.scan).not.toHaveBeenCalled();
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': journeyDefPK(CID),
        ':sk': 'DEF#',
      },
    }));
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      definitions: [
        expect.objectContaining({ id: 'a', name: 'Newer' }),
        expect.objectContaining({ id: 'b', name: 'Older' }),
      ],
    });
  });
});

describe('GET /api/journeys/definitions/:id', () => {
  const handler = getRouteHandler(journeysRouter, '/definitions/:id', 'get');

  test('returns definition on GetItem hit', async () => {
    const item = { id: DEF_ID, name: 'Def', PK: journeyDefPK(CID), SK: journeyDefSK(DEF_ID) };
    dynamodb.get.mockReturnValue(resolved({ Item: item }));
    const res = mockRes();
    await handler({ user: ADMIN, params: { id: DEF_ID } }, res, jest.fn());
    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: journeyDefPK(CID), SK: journeyDefSK(DEF_ID) },
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true, definition: item });
  });

  test('404 when missing', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: ADMIN, params: { id: DEF_ID } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('PUT /api/journeys/definitions/:id', () => {
  const handler = getRouteHandler(journeysRouter, '/definitions/:id', 'put');

  test('updates via updateMeta and returns success', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { id: DEF_ID, version: 1, name: 'Old', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'emp_admin' },
    }));
    const res = mockRes();
    await handler({
      user: ADMIN,
      params: { id: DEF_ID },
      body: { name: 'Renamed' },
    }, res, jest.fn());

    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: journeyDefPK(CID), SK: journeyDefSK(DEF_ID) },
      ExpressionAttributeValues: expect.objectContaining({
        ':n': 'Renamed',
        ':nv': 2,
      }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('zod validation failure on empty body', async () => {
    const next = jest.fn();
    await handler({ user: ADMIN, params: { id: DEF_ID }, body: {} }, mockRes(), next);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('404 when definition missing', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: ADMIN, params: { id: DEF_ID }, body: { name: 'X' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/journeys/definitions/:id', () => {
  const handler = getRouteHandler(journeysRouter, '/definitions/:id', 'delete');

  test('soft-deletes to active:false — never hard-deletes', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { id: DEF_ID, version: 3, active: true },
    }));
    const res = mockRes();
    await handler({ user: ADMIN, params: { id: DEF_ID } }, res, jest.fn());

    expect(dynamodb.delete).not.toHaveBeenCalled();
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: journeyDefPK(CID), SK: journeyDefSK(DEF_ID) },
      UpdateExpression: expect.stringContaining('active = :f'),
      ExpressionAttributeValues: expect.objectContaining({
        ':f': false,
        ':nv': 4,
      }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('GET /api/journeys/instances', () => {
  const handler = getRouteHandler(journeysRouter, '/instances', 'get');

  const META_A = {
    PK: journeyPK(CID, 'journey_a'), SK: 'META', id: 'journey_a',
    status: 'opened', journeyDefId: DEF_ID, createdAt: '2026-06-02T00:00:00.000Z',
  };
  const META_B = {
    PK: journeyPK(CID, 'journey_b'), SK: 'META', id: 'journey_b',
    status: 'completed', journeyDefId: 'journeydef_other', createdAt: '2026-06-01T00:00:00.000Z',
  };

  test('queries JourneysByCompany GSI — never Scan', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [META_A, META_B] }));
    const res = mockRes();
    await handler({ user: ADMIN, query: {} }, res, jest.fn());

    expect(dynamodb.scan).not.toHaveBeenCalled();
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      IndexName: GSI.JOURNEYS_BY_COMPANY,
      KeyConditionExpression: 'journeysByCompanyGsiPK = :pk',
      ExpressionAttributeValues: { ':pk': journeysByCompanyGsiPK(CID) },
    }));
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      instances: [META_A, META_B],
    });
  });

  test('filters by status in-memory after GSI Query', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [META_A, META_B] }));
    const res = mockRes();
    await handler({ user: ADMIN, query: { status: 'opened' } }, res, jest.fn());
    expect(res.json.mock.calls[0][0].instances).toEqual([META_A]);
  });

  test('filters by journeyDefId in-memory after GSI Query', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [META_A, META_B] }));
    const res = mockRes();
    await handler({ user: ADMIN, query: { journeyDefId: DEF_ID } }, res, jest.fn());
    expect(res.json.mock.calls[0][0].instances).toEqual([META_A]);
  });
});

describe('GET /api/journeys/instances/:id', () => {
  const handler = getRouteHandler(journeysRouter, '/instances/:id', 'get');

  test('404 when META missing', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: ADMIN, params: { id: JOURNEY_ID } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns instance META plus RECORD when present', async () => {
    const meta = { id: JOURNEY_ID, status: 'completed', SK: journeyMetaSK() };
    const record = { SK: journeyRecordSK(), data: { slot: '10:00' } };
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === journeyMetaSK()) return resolved({ Item: meta });
      if (params.Key.SK === journeyRecordSK()) return resolved({ Item: record });
      return resolved({});
    });
    const res = mockRes();
    await handler({ user: ADMIN, params: { id: JOURNEY_ID } }, res, jest.fn());

    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: journeyPK(CID, JOURNEY_ID), SK: journeyMetaSK() },
    }));
    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: journeyPK(CID, JOURNEY_ID), SK: journeyRecordSK() },
    }));
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      instance: meta,
      record,
    });
  });
});

describe('Journey routes — role gates (forms.js precedent)', () => {
  test('POST /definitions — manager is 403-blocked by checkRole', async () => {
    const roleGate = getRouteStack(journeysRouter, '/definitions', 'post')[0];
    const res = mockRes();
    const next = jest.fn();
    await roleGate({ user: MANAGER }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('POST /definitions — telecaller is 403-blocked', async () => {
    const roleGate = getRouteStack(journeysRouter, '/definitions', 'post')[0];
    const res = mockRes();
    await roleGate({ user: TELECALLER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('GET /definitions — manager passes checkRole', async () => {
    const roleGate = getRouteStack(journeysRouter, '/definitions', 'get')[0];
    const res = mockRes();
    const next = jest.fn();
    await roleGate({ user: MANAGER }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('GET /definitions — telecaller is 403-blocked', async () => {
    const roleGate = getRouteStack(journeysRouter, '/definitions', 'get')[0];
    const res = mockRes();
    await roleGate({ user: TELECALLER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('DELETE /definitions/:id — manager is 403-blocked (admin write)', async () => {
    const roleGate = getRouteStack(journeysRouter, '/definitions/:id', 'delete')[0];
    const res = mockRes();
    await roleGate({ user: MANAGER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ── Task 7 — public capability-URL GET / submit ─────────────────────────────
const crypto = require('crypto');
const RAW_TOKEN = 'a'.repeat(48); // crypto.randomBytes(24).toString('hex') length
const TOKEN_HASH = crypto.createHash('sha256').update(RAW_TOKEN).digest('hex');
const handlePublicGet = journeysRouter.publicGet[journeysRouter.publicGet.length - 1];
const handlePublicSubmit = journeysRouter.publicSubmit[journeysRouter.publicSubmit.length - 1];

function futureExpiry(ms = 3_600_000) {
  return new Date(Date.now() + ms).toISOString();
}
function pastExpiry() {
  return new Date(Date.now() - 60_000).toISOString();
}
function openInstance(overrides = {}) {
  return {
    PK: journeyPK(CID, JOURNEY_ID),
    SK: journeyMetaSK(),
    id: JOURNEY_ID,
    companyId: CID,
    journeyDefId: DEF_ID,
    status: 'opened',
    tokenHash: TOKEN_HASH,
    tokenExpiresAt: futureExpiry(),
    leadPK: `LEAD#${CID}#lead_secret`,
    leadId: 'lead_secret',
    contactId: 'ct_secret',
    executionId: 'exec_secret',
    version: 1,
    ...overrides,
  };
}
function publicParams(overrides = {}) {
  return {
    companyId: CID,
    journeyInstanceId: JOURNEY_ID,
    token: RAW_TOKEN,
    ...overrides,
  };
}

describe('validateJourneyToken (Task 7 helper)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('valid token + unexpired instance → ok with instance', async () => {
    const item = openInstance();
    dynamodb.get.mockReturnValue(resolved({ Item: item }));
    const result = await journeysRouter.validateJourneyToken(CID, JOURNEY_ID, RAW_TOKEN);
    expect(result).toEqual({ ok: true, instance: item });
  });

  test('wrong token → ok:false', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance() }));
    const result = await journeysRouter.validateJourneyToken(CID, JOURNEY_ID, 'b'.repeat(48));
    expect(result).toEqual({ ok: false });
  });

  test('expired tokenExpiresAt → ok:false', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance({ tokenExpiresAt: pastExpiry() }) }));
    const result = await journeysRouter.validateJourneyToken(CID, JOURNEY_ID, RAW_TOKEN);
    expect(result).toEqual({ ok: false });
  });

  test('mismatched journeyInstanceId (META missing) → ok:false', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const result = await journeysRouter.validateJourneyToken(CID, 'journey_missing', RAW_TOKEN);
    expect(result).toEqual({ ok: false });
  });

  test('length-mismatch stored hash does not throw (guards timingSafeEqual)', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: openInstance({ tokenHash: 'short' }), // unequal length vs sha256 hex
    }));
    await expect(
      journeysRouter.validateJourneyToken(CID, JOURNEY_ID, RAW_TOKEN),
    ).resolves.toEqual({ ok: false });
  });
});

describe('GET /api/journeys/:companyId/:journeyInstanceId/:token (public)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('valid token → sanitized whitelist shape; excludes internal fields', async () => {
    const instance = openInstance();
    const def = {
      id: DEF_ID, name: 'Hospital Booking',
      screens: [{ id: 's1', title: 'Patient', fields: [] }],
      brandingConfig: { primaryColor: '#123' },
      tokenHash: 'should-not-leak',
    };
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === journeyMetaSK()) return resolved({ Item: instance });
      if (params.Key.SK === journeyDefSK(DEF_ID)) return resolved({ Item: def });
      return resolved({});
    });

    const res = mockRes();
    await handlePublicGet({ params: publicParams() }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({
      success: true,
      instance: { journeyInstanceId: JOURNEY_ID, status: 'opened' },
      definition: {
        name: 'Hospital Booking',
        screens: def.screens,
        brandingConfig: { primaryColor: '#123' },
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('tokenHash');
    expect(serialized).not.toContain('leadPK');
    expect(serialized).not.toContain('lead_secret');
    expect(serialized).not.toContain('leadId');
    expect(serialized).not.toContain('contactId');
    expect(serialized).not.toContain('ct_secret');
    expect(serialized).not.toContain('executionId');
    expect(serialized).not.toContain('exec_secret');
  });

  test('public brandingConfig includes bannerImageUrl and strips unknown branding keys', async () => {
    const instance = openInstance();
    const def = {
      id: DEF_ID,
      name: 'Bannered',
      screens: [],
      brandingConfig: {
        primaryColor: '#0ea5e9',
        bannerImageUrl: 'https://cdn.example.com/hero.jpg',
        internalNote: 'should-not-leak',
      },
    };
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === journeyMetaSK()) return resolved({ Item: instance });
      if (params.Key.SK === journeyDefSK(DEF_ID)) return resolved({ Item: def });
      return resolved({});
    });

    const res = mockRes();
    await handlePublicGet({ params: publicParams() }, res, jest.fn());
    expect(res.json.mock.calls[0][0].definition.brandingConfig).toEqual({
      primaryColor: '#0ea5e9',
      bannerImageUrl: 'https://cdn.example.com/hero.jpg',
    });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('internalNote');
  });

  test('invalid token → 404 Not found', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance() }));
    const res = mockRes();
    await handlePublicGet({ params: publicParams({ token: 'wrong' }) }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  test('finished instance with valid token → 200 + status (not 404)', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === journeyMetaSK()) {
        return resolved({ Item: openInstance({ status: 'completed' }) });
      }
      return resolved({ Item: { name: 'Done', screens: [], brandingConfig: null } });
    });
    const res = mockRes();
    await handlePublicGet({ params: publicParams() }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].instance.status).toBe('completed');
  });
});

describe('POST /api/journeys/.../submit (public)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));
  });

  test('valid submit writes RECORD and transitions opened → in_progress', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance() }));
    const res = mockRes();
    await handlePublicSubmit({
      params: publicParams(),
      headers: { 'content-length': '50' },
      body: { slot: '10:00', name: 'Pat' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: journeyPK(CID, JOURNEY_ID),
        SK: journeyRecordSK(),
        data: { slot: '10:00', name: 'Pat' },
      }),
    }));
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: journeyPK(CID, JOURNEY_ID), SK: journeyMetaSK() },
      ExpressionAttributeValues: expect.objectContaining({ ':st': 'in_progress' }),
    }));
    expect(AutomationEngine.resumeOnWebhook).not.toHaveBeenCalled();
    expect(AutomationEngine.fireTrigger).not.toHaveBeenCalled();
    expect(AutomationEngine.runWorkflowDirect).not.toHaveBeenCalled();
  });

  test('invalid token → 404', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance() }));
    const res = mockRes();
    await handlePublicSubmit({
      params: publicParams({ token: 'nope' }),
      headers: {},
      body: { a: 1 },
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('oversized body → 413 before lookup', async () => {
    const res = mockRes();
    await handlePublicSubmit({
      params: publicParams(),
      headers: { 'content-length': '999999' },
      body: {},
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(413);
    expect(dynamodb.get).not.toHaveBeenCalled();
  });

  test('finished instance → 409', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance({ status: 'cancelled' }) }));
    const res = mockRes();
    await handlePublicSubmit({
      params: publicParams(),
      headers: { 'content-length': '10' },
      body: { x: 1 },
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('never calls AutomationEngine / resumeOnWebhook', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance({ status: 'in_progress' }) }));
    await handlePublicSubmit({
      params: publicParams(),
      headers: {},
      body: { ok: true },
    }, mockRes(), jest.fn());
    expect(AutomationEngine.resumeOnWebhook).not.toHaveBeenCalled();
    expect(Object.keys(AutomationEngine).every((k) =>
      AutomationEngine[k].mock.calls.length === 0)).toBe(true);
  });
});

describe('Public journey routes — rate-limit composition (automations.js sibling)', () => {
  test('publicGet / publicSubmit are [rateLimit, flagGuard, handler] arrays (Task 11 adds flag guard)', () => {
    const automationsRouter = require('../src/routes/automations');
    expect(Array.isArray(journeysRouter.publicGet)).toBe(true);
    expect(Array.isArray(journeysRouter.publicSubmit)).toBe(true);
    expect(journeysRouter.publicGet).toHaveLength(3);
    expect(journeysRouter.publicSubmit).toHaveLength(3);
    expect(journeysRouter.publicGet.every((fn) => typeof fn === 'function')).toBe(true);
    expect(journeysRouter.publicSubmit.every((fn) => typeof fn === 'function')).toBe(true);
    // Automations inboundWebhook stays [rateLimit, handler] — journeys adds a flag layer.
    expect(automationsRouter.inboundWebhook).toHaveLength(2);
    expect(typeof automationsRouter.inboundWebhook[0]).toBe('function');
    expect(typeof automationsRouter.inboundWebhook[1]).toBe('function');
  });
});

describe('POST /api/journeys/webhook/:companyId/:journeyInstanceId/:token (Task 8)', () => {
  const handlePublicWebhook = journeysRouter.publicWebhook[journeysRouter.publicWebhook.length - 1];

  beforeEach(() => {
    jest.clearAllMocks();
    isEnabled.mockResolvedValue(true);
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('valid token + matching paused wait → resumeOnWebhook(req.body) → 200 with executionId', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance() }));
    AutomationEngine.resumeOnWebhook.mockResolvedValue({ status: 'resumed', executionId: 'exec-wh-1' });
    const body = { slot: '10:00', journeyRecord: { slot: '10:00' } };
    const res = mockRes();

    await handlePublicWebhook({
      params: publicParams(),
      headers: { 'content-length': '40' },
      body,
    }, res, jest.fn());

    expect(AutomationEngine.resumeOnWebhook).toHaveBeenCalledWith(CID, JOURNEY_ID, body);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, executionId: 'exec-wh-1' });
  });

  test('valid token + no matching wait → 404 (same body as invalid token)', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance() }));
    AutomationEngine.resumeOnWebhook.mockResolvedValue({ status: 'not_found' });
    const res = mockRes();

    await handlePublicWebhook({
      params: publicParams(),
      headers: {},
      body: {},
    }, res, jest.fn());

    expect(AutomationEngine.resumeOnWebhook).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  test('invalid token → 404 and resumeOnWebhook is NOT called', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance() }));
    const res = mockRes();

    await handlePublicWebhook({
      params: publicParams({ token: 'wrong-token' }),
      headers: {},
      body: { a: 1 },
    }, res, jest.fn());

    expect(AutomationEngine.resumeOnWebhook).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  test('oversized body → 413 before any DB call', async () => {
    const res = mockRes();
    await handlePublicWebhook({
      params: publicParams(),
      headers: { 'content-length': '999999' },
      body: {},
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(413);
    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(AutomationEngine.resumeOnWebhook).not.toHaveBeenCalled();
  });

  test('double-delivery: first resumed → 200, second not_found → 404', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance() }));
    AutomationEngine.resumeOnWebhook
      .mockResolvedValueOnce({ status: 'resumed', executionId: 'exec-once' })
      .mockResolvedValueOnce({ status: 'not_found' });

    const req = { params: publicParams(), headers: {}, body: { event: 'confirm' } };
    const res1 = mockRes();
    const res2 = mockRes();

    await handlePublicWebhook(req, res1, jest.fn());
    await handlePublicWebhook(req, res2, jest.fn());

    expect(AutomationEngine.resumeOnWebhook).toHaveBeenCalledTimes(2);
    expect(res1.status).toHaveBeenCalledWith(200);
    expect(res1.json).toHaveBeenCalledWith({ success: true, executionId: 'exec-once' });
    expect(res2.status).toHaveBeenCalledWith(404);
    expect(res2.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  test('publicWebhook rate-limit composition is [rateLimit, flagGuard, handler]', () => {
    expect(Array.isArray(journeysRouter.publicWebhook)).toBe(true);
    expect(journeysRouter.publicWebhook).toHaveLength(3);
    expect(journeysRouter.publicWebhook.every((fn) => typeof fn === 'function')).toBe(true);
  });
});

describe('journeys_platform feature flag kill-switch (Task 11)', () => {
  function adminFlagGuard() {
    return journeysRouter.stack.find((l) => !l.route)?.handle;
  }
  const publicFlagGuard = () => journeysRouter.publicGet[1];

  beforeEach(() => {
    jest.clearAllMocks();
    isEnabled.mockResolvedValue(false);
  });

  test('admin router guard returns 403 when flag is off', async () => {
    const guard = adminFlagGuard();
    expect(typeof guard).toBe('function');
    const res = mockRes();
    const next = jest.fn();
    await guard({ user: ADMIN }, res, next);
    expect(isEnabled).toHaveBeenCalledWith(CID, 'journeys_platform');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Journey Platform is not enabled',
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('admin router guard calls next when flag is on', async () => {
    isEnabled.mockResolvedValue(true);
    const res = mockRes();
    const next = jest.fn();
    await adminFlagGuard()({ user: ADMIN }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('public flag guard returns flat 404 when flag is off (before token validation)', async () => {
    const res = mockRes();
    const next = jest.fn();
    await publicFlagGuard()({ params: { companyId: CID } }, res, next);
    expect(isEnabled).toHaveBeenCalledWith(CID, 'journeys_platform');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(next).not.toHaveBeenCalled();
    expect(dynamodb.get).not.toHaveBeenCalled();
  });
});

describe('GET /api/journeys/banner-upload-url', () => {
  const handler = () => getRouteHandler(journeysRouter, '/banner-upload-url', 'get');

  beforeEach(() => {
    jest.clearAllMocks();
    s3Client.getSignedUrl.mockReturnValue('https://s3.example.com/presigned-put');
  });

  test('valid image/jpeg under the size limit succeeds — key is company-scoped under journey-banners/', async () => {
    const req = {
      query: { mimeType: 'image/jpeg', filename: 'banner.jpg', fileSize: String(500_000) },
      user: ADMIN,
    };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      uploadUrl: expect.any(String),
      key: expect.stringMatching(new RegExp(`^journey-banners/${CID}/.+\\.jpg$`)),
      publicUrl: expect.stringMatching(
        new RegExp(`^https://apforce-public-assets-test\\.s3\\.ap-south-1\\.amazonaws\\.com/journey-banners/${CID}/.+\\.jpg$`),
      ),
    }));
    expect(s3Client.getSignedUrl).toHaveBeenCalledWith('putObject', expect.objectContaining({
      Bucket: 'apforce-public-assets-test',
      ContentType: 'image/jpeg',
      Expires: 300,
    }));
  });

  test('image/png and image/webp are allowed', async () => {
    for (const mimeType of ['image/png', 'image/webp']) {
      const res = mockRes();
      await handler()({
        query: { mimeType, filename: 'banner.bin' },
        user: ADMIN,
      }, res, jest.fn());
      expect(res.status).not.toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    }
  });

  test('disallowed mimeType (gif) is rejected', async () => {
    const res = mockRes();
    await handler()({
      query: { mimeType: 'image/gif', filename: 'banner.gif' },
      user: ADMIN,
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(s3Client.getSignedUrl).not.toHaveBeenCalled();
  });

  test('oversized fileSize (>2MB) is rejected', async () => {
    const res = mockRes();
    await handler()({
      query: { mimeType: 'image/jpeg', filename: 'huge.jpg', fileSize: String(3 * 1024 * 1024) },
      user: ADMIN,
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(s3Client.getSignedUrl).not.toHaveBeenCalled();
  });

  test('missing mimeType/filename → 400', async () => {
    const res = mockRes();
    await handler()({ query: {}, user: ADMIN }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('key extension is derived from mimeType, not the filename', async () => {
    const res = mockRes();
    await handler()({
      query: { mimeType: 'image/webp', filename: 'photo.png' },
      user: ADMIN,
    }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.key).toMatch(/\.webp$/);
    expect(payload.publicUrl).toMatch(/\.webp$/);
  });

  test('manager is 403-blocked by checkRole — admin-only like definition writes', async () => {
    const roleGate = getRouteStack(journeysRouter, '/banner-upload-url', 'get')[0];
    const res = mockRes();
    const next = jest.fn();
    await roleGate({ user: MANAGER }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
