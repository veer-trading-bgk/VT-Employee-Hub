'use strict';

/**
 * Route tests for Journey Platform admin CRUD (Task 6):
 * definitions CRUD + instances list/detail. Direct-handler invocation for
 * happy paths; real checkRole middleware from the route stack for auth gates
 * (same technique as aiRoutes.test.js / instagramReadRoutes.test.js).
 */

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), scan: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
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
