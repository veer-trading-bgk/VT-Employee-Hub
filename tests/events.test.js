'use strict';

// ── Top-level mocks — defined once, never re-created between tests ────────────

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(() => ({ promise: () => Promise.resolve() })),
}));

jest.mock('../src/config/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  alert: jest.fn(),
}));

// ── Module references — stable across the entire file ────────────────────────

const dynamodb = require('../src/config/dynamodb');
const logger   = require('../src/config/logger');

const { E, ENTITY }                               = require('../src/events/catalog');
const { onEvent, getHandlers,
        clearHandlers, clearAllHandlers }         = require('../src/events/handlers');
const { writeTlRecord, writeTlRecords,
        tlPK, tlSK }                              = require('../src/events/timeline');
const { publishEvent }                            = require('../src/events/publisher');

// ── Helper — flush setImmediate callbacks before asserting ────────────────────

function flushImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

function basePayload(overrides = {}) {
  return {
    companyId:  'cmp-test',
    entityType: 'LEAD',
    entityId:   'lead-123',
    contactId:  'ctc-456',
    actorId:    'emp-789',
    actorName:  'Ravi Kumar',
    channel:    'whatsapp',
    summary:    'Stage moved to interested',
    metadata:   { fromStage: 'new_lead', toStage: 'interested' },
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    eventId:   'evt-abc123',
    eventType: 'lead_created',
    timestamp: '2026-01-15T10:00:00.000Z',
    companyId: 'cmp-1',
    contactId: 'ctc-1',
    actorId:   'emp-1',
    actorName: 'Test User',
    channel:   'whatsapp',
    summary:   'Lead created',
    metadata:  { source: 'crm' },
    ...overrides,
  };
}

// ── catalog ───────────────────────────────────────────────────────────────────

describe('catalog', () => {
  test('E constants are non-empty strings', () => {
    expect(Object.values(E).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });

  test('ENTITY constants are non-empty strings', () => {
    expect(Object.values(ENTITY).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });

  test('E values are lowercase_snake_case', () => {
    expect(Object.values(E).every((v) => /^[a-z][a-z0-9_]*$/.test(v))).toBe(true);
  });

  test('ENTITY values are UPPER_CASE', () => {
    expect(Object.values(ENTITY).every((v) => /^[A-Z][A-Z0-9_]*$/.test(v))).toBe(true);
  });

  test('known constants exist with exact values', () => {
    expect(E.LEAD_CREATED).toBe('lead_created');
    expect(E.STAGE_CHANGED).toBe('stage_changed');
    expect(E.MESSAGE_RECEIVED).toBe('message_received');
    expect(ENTITY.CONTACT).toBe('CONTACT');
    expect(ENTITY.CONV).toBe('CONV');
    expect(ENTITY.LEAD).toBe('LEAD');
  });
});

// ── handlers ──────────────────────────────────────────────────────────────────

describe('handlers', () => {
  afterEach(() => clearAllHandlers()); // reset registry between tests without module reload

  test('getHandlers returns [] when no handler registered', () => {
    expect(getHandlers('no_such_event')).toEqual([]);
  });

  test('onEvent registers a handler retrieved by getHandlers', () => {
    const fn = jest.fn();
    onEvent('lead_created', fn);
    expect(getHandlers('lead_created')).toContain(fn);
  });

  test('multiple handlers for the same event are all returned', () => {
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    onEvent('stage_changed', fn1);
    onEvent('stage_changed', fn2);
    expect(getHandlers('stage_changed')).toEqual([fn1, fn2]);
  });

  test('clearHandlers removes all handlers for that type', () => {
    onEvent('note_added', jest.fn());
    clearHandlers('note_added');
    expect(getHandlers('note_added')).toEqual([]);
  });

  test('clearAllHandlers removes all handlers across all types', () => {
    onEvent('lead_created', jest.fn());
    onEvent('stage_changed', jest.fn());
    clearAllHandlers();
    expect(getHandlers('lead_created')).toEqual([]);
    expect(getHandlers('stage_changed')).toEqual([]);
  });

  test('onEvent throws TypeError when handler is not a function', () => {
    expect(() => onEvent('lead_created', 'not-a-fn')).toThrow(TypeError);
  });

  test('handlers for different event types do not interfere', () => {
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    onEvent('lead_created', fn1);
    onEvent('stage_changed', fn2);
    expect(getHandlers('lead_created')).toEqual([fn1]);
    expect(getHandlers('stage_changed')).toEqual([fn2]);
  });
});

// ── timeline — key builders ────────────────────────────────────────────────────

describe('timeline — tlPK / tlSK', () => {
  test('tlPK produces expected pattern', () => {
    expect(tlPK('cmp-1', 'LEAD', 'lead-abc')).toBe('TL#cmp-1#LEAD#lead-abc');
  });

  test('tlSK produces expected pattern', () => {
    expect(tlSK('2026-01-15T10:00:00.000Z', 'lead_created', 'evt-xyz'))
      .toBe('2026-01-15T10:00:00.000Z#lead_created#evt-xyz');
  });

  test('tlSK sorts chronologically (lexicographic = date order)', () => {
    const skEarly = tlSK('2026-01-01T00:00:00.000Z', 'lead_created', 'evt-a');
    const skLate  = tlSK('2026-06-15T12:30:00.000Z', 'stage_changed', 'evt-b');
    expect(skEarly < skLate).toBe(true);
  });
});

// ── timeline — writeTlRecord ───────────────────────────────────────────────────

describe('timeline — writeTlRecord', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'test-metrics-table';
  });

  afterEach(() => {
    delete process.env.DYNAMODB_TABLE_METRICS;
  });

  test('puts item with correct PK/SK to DynamoDB', async () => {
    await writeTlRecord('cmp-1', 'LEAD', 'lead-123', makeEvent());

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      TableName: 'test-metrics-table',
      Item: expect.objectContaining({
        PK:         'TL#cmp-1#LEAD#lead-123',
        SK:         '2026-01-15T10:00:00.000Z#lead_created#evt-abc123',
        eventId:    'evt-abc123',
        eventType:  'lead_created',
        companyId:  'cmp-1',
        entityType: 'LEAD',
        entityId:   'lead-123',
      }),
      ConditionExpression: 'attribute_not_exists(SK)',
    }));
  });

  test('silently ignores ConditionalCheckFailedException (duplicate event)', async () => {
    const dupErr = Object.assign(new Error('Condition failed'), {
      code: 'ConditionalCheckFailedException',
    });
    dynamodb.put.mockReturnValueOnce({ promise: () => Promise.reject(dupErr) });

    await expect(writeTlRecord('cmp-1', 'LEAD', 'lead-123', makeEvent()))
      .resolves.toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('logs warning on unexpected DynamoDB error (does not throw)', async () => {
    const dbErr = Object.assign(new Error('Throughput exceeded'), {
      code: 'ProvisionedThroughputExceededException',
    });
    dynamodb.put.mockReturnValueOnce({ promise: () => Promise.reject(dbErr) });

    await expect(writeTlRecord('cmp-1', 'LEAD', 'lead-123', makeEvent()))
      .resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[timeline]'));
  });

  test('skips write when TABLE env var is not set', async () => {
    delete process.env.DYNAMODB_TABLE_METRICS; // read at call time — no module reload needed

    await writeTlRecord('cmp-1', 'LEAD', 'lead-123', makeEvent());

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not set'));
  });

  test('stores all canonical event fields on the item', async () => {
    const event = makeEvent({ actorId: 'emp-x', actorName: 'Alice', channel: 'system' });
    await writeTlRecord('cmp-1', 'CONTACT', 'ctc-999', event);

    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.actorId).toBe('emp-x');
    expect(item.actorName).toBe('Alice');
    expect(item.channel).toBe('system');
    expect(item.contactId).toBe('ctc-1');
    expect(item.metadata).toEqual({ source: 'crm' });
  });

  test('null-safe: optional fields default to null when event omits them', async () => {
    const event = makeEvent({ contactId: undefined, actorId: undefined, channel: undefined });
    await writeTlRecord('cmp-1', 'LEAD', 'lead-1', event);

    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.contactId).toBeNull();
    expect(item.actorId).toBeNull();
    expect(item.channel).toBeNull();
  });
});

// ── timeline — writeTlRecords fan-out ─────────────────────────────────────────

describe('timeline — writeTlRecords fan-out', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'test-metrics-table';
  });

  afterEach(() => {
    delete process.env.DYNAMODB_TABLE_METRICS;
  });

  test('writes to all target entities in parallel', async () => {
    const event = makeEvent({ eventType: 'stage_changed' });
    const targets = [
      { entityType: 'LEAD',    entityId: 'lead-1'    },
      { entityType: 'CONTACT', entityId: 'contact-1' },
    ];

    await writeTlRecords(event, targets);

    expect(dynamodb.put).toHaveBeenCalledTimes(2);
    const pks = dynamodb.put.mock.calls.map((c) => c[0].Item.PK);
    expect(pks).toContain('TL#cmp-1#LEAD#lead-1');
    expect(pks).toContain('TL#cmp-1#CONTACT#contact-1');
  });

  test('resolves even when one target write fails (Promise.allSettled)', async () => {
    dynamodb.put
      .mockReturnValueOnce({ promise: () => Promise.reject(new Error('fail')) })
      .mockReturnValueOnce({ promise: () => Promise.resolve() });

    await expect(writeTlRecords(makeEvent(), [
      { entityType: 'LEAD',    entityId: 'l1' },
      { entityType: 'CONTACT', entityId: 'c1' },
    ])).resolves.toBeUndefined();
  });

  test('is a no-op when targets array is empty', async () => {
    await writeTlRecords(makeEvent(), []);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('is a no-op when targets is null/undefined', async () => {
    await writeTlRecords(makeEvent(), null);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });
});

// ── publishEvent — guard clauses ──────────────────────────────────────────────

describe('publishEvent — guard clauses', () => {
  // Drain any pending setImmediate from a prior test BEFORE clearing mocks.
  // Without this, a previous test's deferred callback fires inside this test's
  // flushImmediate() and contaminates the call count.
  beforeEach(async () => {
    await flushImmediate();
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'test-metrics-table';
  });

  afterEach(() => {
    delete process.env.DYNAMODB_TABLE_METRICS;
  });

  test('returns undefined synchronously (fire-and-forget contract)', async () => {
    expect(publishEvent('lead_created', basePayload())).toBeUndefined();
    await flushImmediate(); // drain immediately so it does not bleed into next test
  });

  test('does not throw synchronously even when called with null/null', () => {
    expect(() => publishEvent(null, null)).not.toThrow();
  });

  test('logs warn and skips DDB write when eventType is missing', async () => {
    publishEvent(null, basePayload());
    await flushImmediate();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('invalid eventType'));
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('logs warn and skips DDB write when companyId is missing', async () => {
    publishEvent('lead_created', basePayload({ companyId: undefined }));
    await flushImmediate();
    expect(logger.warn).toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('logs warn and skips DDB write when entityType is missing', async () => {
    publishEvent('lead_created', basePayload({ entityType: undefined }));
    await flushImmediate();
    expect(logger.warn).toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('logs warn and skips DDB write when entityId is missing', async () => {
    publishEvent('lead_created', basePayload({ entityId: undefined }));
    await flushImmediate();
    expect(logger.warn).toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
  });
});

// ── publishEvent — happy path ─────────────────────────────────────────────────

describe('publishEvent — happy path', () => {
  beforeEach(async () => {
    await flushImmediate(); // drain prior-test callbacks before clearing mocks
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'test-metrics-table';
  });

  afterEach(() => {
    delete process.env.DYNAMODB_TABLE_METRICS;
  });

  test('writes TL# record to DynamoDB after setImmediate flush', async () => {
    publishEvent('lead_created', basePayload());
    await flushImmediate();

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      TableName: 'test-metrics-table',
      Item: expect.objectContaining({
        eventType:  'lead_created',
        companyId:  'cmp-test',
        entityType: 'LEAD',
        entityId:   'lead-123',
        contactId:  'ctc-456',
        actorId:    'emp-789',
        summary:    'Stage moved to interested',
      }),
    }));
  });

  test('event ID has evt_ prefix and 20 hex chars', async () => {
    publishEvent('lead_created', basePayload());
    await flushImmediate();

    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.eventId).toMatch(/^evt_[0-9a-f]{20}$/);
  });

  test('timestamp is a valid ISO 8601 string', async () => {
    publishEvent('stage_changed', basePayload());
    await flushImmediate();

    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(new Date(item.timestamp).toISOString()).toBe(item.timestamp);
  });

  test('fans out to additionalEntities (2 TL# writes)', async () => {
    publishEvent('stage_changed', basePayload({
      additionalEntities: [{ entityType: 'CONTACT', entityId: 'ctc-456' }],
    }));
    await flushImmediate();

    expect(dynamodb.put).toHaveBeenCalledTimes(2);
    const pks = dynamodb.put.mock.calls.map((c) => c[0].Item.PK);
    expect(pks).toContain('TL#cmp-test#LEAD#lead-123');
    expect(pks).toContain('TL#cmp-test#CONTACT#ctc-456');
  });

  test('optional fields default to null when omitted', async () => {
    publishEvent('lead_created', {
      companyId:  'cmp-test',
      entityType: 'LEAD',
      entityId:   'lead-999',
      summary:    'Created',
    });
    await flushImmediate();

    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.contactId).toBeNull();
    expect(item.actorId).toBeNull();
    expect(item.actorName).toBeNull();
    expect(item.channel).toBeNull();
    expect(item.metadata).toEqual({});
  });

  test('two sequential events have different IDs', async () => {
    publishEvent('lead_created', basePayload());
    await flushImmediate();
    const id1 = dynamodb.put.mock.calls[0][0].Item.eventId;

    jest.clearAllMocks();
    publishEvent('lead_created', basePayload());
    await flushImmediate();
    const id2 = dynamodb.put.mock.calls[0][0].Item.eventId;

    expect(id1).toMatch(/^evt_[0-9a-f]{20}$/);
    expect(id2).toMatch(/^evt_[0-9a-f]{20}$/);
    expect(id1).not.toBe(id2);
  });
});

// ── publishEvent — handler invocation ────────────────────────────────────────

describe('publishEvent — handler invocation', () => {
  beforeEach(async () => {
    await flushImmediate(); // drain prior-test callbacks before clearing mocks
    jest.clearAllMocks();
    clearAllHandlers();
    process.env.DYNAMODB_TABLE_METRICS = 'test-metrics-table';
  });

  afterEach(() => {
    clearAllHandlers();
    delete process.env.DYNAMODB_TABLE_METRICS;
  });

  test('calls registered handler after TL# write with the canonical event', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    onEvent('lead_created', handler);

    publishEvent('lead_created', basePayload());
    await flushImmediate();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'lead_created',
      companyId: 'cmp-test',
      entityId:  'lead-123',
    }));
  });

  test('a failing handler does not prevent other handlers from running', async () => {
    const bad  = jest.fn().mockRejectedValue(new Error('handler boom'));
    const good = jest.fn().mockResolvedValue(undefined);
    onEvent('stage_changed', bad);
    onEvent('stage_changed', good);

    publishEvent('stage_changed', basePayload());
    await flushImmediate();

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('handler error'));
  });

  test('handler is NOT called for a different event type', async () => {
    const handler = jest.fn();
    onEvent('note_added', handler);

    publishEvent('lead_created', basePayload());
    await flushImmediate();

    expect(handler).not.toHaveBeenCalled();
  });

  test('a DynamoDB failure in TL# write does not surface from the deferred block', async () => {
    dynamodb.put.mockReturnValueOnce({
      promise: () => Promise.reject(new Error('DDB down')),
    });

    publishEvent('lead_created', basePayload());
    await expect(flushImmediate()).resolves.toBeUndefined();
  });
});
