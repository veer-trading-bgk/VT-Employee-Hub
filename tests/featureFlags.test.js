'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/config/dynamodb', () => ({ get: jest.fn() }));

const dynamodb     = require('../src/config/dynamodb');
const featureFlags = require('../src/utils/featureFlags');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockGet(globalFlags = null, companyFlags = null) {
  dynamodb.get.mockImplementation(({ Key }) => ({
    promise: () => Promise.resolve({
      Item: Key.PK === 'CONFIG#FLAGS#global'
        ? (globalFlags !== null ? { flags: globalFlags } : undefined)
        : (companyFlags !== null ? { flags: companyFlags } : undefined),
    }),
  }));
}

const CID = 'comp_test';

beforeEach(() => {
  jest.clearAllMocks();
  featureFlags._clearCache();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  mockGet(); // default: both return no Item
});

afterEach(() => { delete process.env.DYNAMODB_TABLE_METRICS; });

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────

describe('DEFAULTS', () => {
  test('all Phase 1 flags default to false', () => {
    for (const val of Object.values(featureFlags.DEFAULTS)) {
      expect(val).toBe(false);
    }
  });

  test('DEFAULTS is frozen (immutable)', () => {
    expect(Object.isFrozen(featureFlags.DEFAULTS)).toBe(true);
  });

  test('DEFAULTS contains the expected flag names', () => {
    const expected = [
      'contact_hub', 'ai_classification', 'workflow_builder',
      'multi_pipeline', 'broadcast_campaigns', 'conversation_v2_ui',
      'lead_timeline', 'bot_handoff',
    ];
    for (const name of expected) {
      expect(featureFlags.DEFAULTS).toHaveProperty(name);
    }
  });
});

// ─── getFlags ─────────────────────────────────────────────────────────────────

describe('getFlags()', () => {
  test('returns all DEFAULTS when DDB has no flag items', async () => {
    const flags = await featureFlags.getFlags(CID);
    expect(flags).toMatchObject(featureFlags.DEFAULTS);
  });

  test('global flags override DEFAULTS', async () => {
    mockGet({ contact_hub: true }, null);
    const flags = await featureFlags.getFlags(CID);
    expect(flags.contact_hub).toBe(true);
  });

  test('company flags override global flags', async () => {
    mockGet({ contact_hub: true }, { contact_hub: false });
    const flags = await featureFlags.getFlags(CID);
    expect(flags.contact_hub).toBe(false);
  });

  test('company flags can enable a flag that global leaves disabled', async () => {
    mockGet({ contact_hub: false }, { contact_hub: true });
    const flags = await featureFlags.getFlags(CID);
    expect(flags.contact_hub).toBe(true);
  });

  test('multiple flags merge correctly — only overridden keys change', async () => {
    mockGet({ ai_classification: true }, { workflow_builder: true });
    const flags = await featureFlags.getFlags(CID);
    expect(flags.ai_classification).toBe(true);   // from global
    expect(flags.workflow_builder).toBe(true);     // from company
    expect(flags.contact_hub).toBe(false);         // still default
  });

  test('caches result — second call with same companyId does not hit DDB again', async () => {
    await featureFlags.getFlags(CID);
    await featureFlags.getFlags(CID);
    // First call triggers 2 DDB GETs (global + company); second is a cache hit
    expect(dynamodb.get).toHaveBeenCalledTimes(2);
  });

  test('_clearCache() forces DDB re-read on next call', async () => {
    await featureFlags.getFlags(CID);
    featureFlags._clearCache();
    await featureFlags.getFlags(CID);
    // Each getFlags call makes 2 DDB GETs; cache clear means 2 calls × 2 = 4
    expect(dynamodb.get).toHaveBeenCalledTimes(4);
  });

  test('different companyIds are cached separately', async () => {
    await featureFlags.getFlags('comp_a');
    await featureFlags.getFlags('comp_b');
    // Each company triggers 2 DDB GETs
    expect(dynamodb.get).toHaveBeenCalledTimes(4);
    // Repeat calls are cache hits
    await featureFlags.getFlags('comp_a');
    await featureFlags.getFlags('comp_b');
    expect(dynamodb.get).toHaveBeenCalledTimes(4);
  });

  test('returns DEFAULTS (not throw) when DDB errors', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('timeout')) });
    const flags = await featureFlags.getFlags(CID);
    expect(flags).toMatchObject(featureFlags.DEFAULTS);
  });

  test('never throws — always resolves', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('conn')) });
    await expect(featureFlags.getFlags(CID)).resolves.toBeDefined();
  });
});

// ─── isEnabled ────────────────────────────────────────────────────────────────

describe('isEnabled()', () => {
  test('returns false for any Phase 1 flag (all disabled by default)', async () => {
    const result = await featureFlags.isEnabled(CID, 'contact_hub');
    expect(result).toBe(false);
  });

  test('returns true when flag is enabled in DDB', async () => {
    mockGet({ ai_classification: true }, null);
    const result = await featureFlags.isEnabled(CID, 'ai_classification');
    expect(result).toBe(true);
  });

  test('returns false for an unknown flag name', async () => {
    const result = await featureFlags.isEnabled(CID, 'nonexistent_flag_xyz');
    expect(result).toBe(false);
  });

  test('works with null companyId (global-only context)', async () => {
    mockGet({ broadcast_campaigns: true }, null);
    const result = await featureFlags.isEnabled(null, 'broadcast_campaigns');
    expect(result).toBe(true);
  });

  test('never throws on DDB error — resolves to false', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('ddb error')) });
    await expect(featureFlags.isEnabled(CID, 'contact_hub')).resolves.toBe(false);
  });
});
