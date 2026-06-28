'use strict';

/**
 * Production smoke tests.
 *
 * Verify that every core module loads cleanly and exports its expected
 * public surface. These tests run without any AWS credentials or network
 * access — they act as a deployment gate that catches missing exports,
 * broken requires, or runtime errors introduced at module load time.
 */

// ─── Module-level mocks (hoisted before any require) ─────────────────────────

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), delete: jest.fn(),
  query: jest.fn(), scan: jest.fn(), transactWrite: jest.fn(),
  batchGet: jest.fn(), batchWrite: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// ─── Core layer ───────────────────────────────────────────────────────────────

describe('Core — id.js', () => {
  const id = require('../src/core/id');

  test('exports all ID generators', () => {
    expect(typeof id.generateContactId).toBe('function');
    expect(typeof id.generateConversationId).toBe('function');
    expect(typeof id.generateLeadId).toBe('function');
    expect(typeof id.generateEventId).toBe('function');
  });

  test('generateContactId returns a prefixed ULID', () => {
    expect(id.generateContactId()).toMatch(/^contact_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('generateConversationId returns a prefixed ULID', () => {
    expect(id.generateConversationId()).toMatch(/^conv_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('successive IDs are unique', () => {
    const a = id.generateContactId();
    const b = id.generateContactId();
    expect(a).not.toBe(b);
  });
});

describe('Core — entityKeys.js', () => {
  const keys = require('../src/core/entityKeys');

  test('exports all key builders', () => {
    expect(typeof keys.contactPK).toBe('function');
    expect(typeof keys.conversationPK).toBe('function');
    expect(typeof keys.leadPK).toBe('function');
    expect(typeof keys.tlPK).toBe('function');
  });

  test('contactPK is scoped by companyId', () => {
    const pk = keys.contactPK('comp_a', 'contact_1');
    expect(pk).toContain('comp_a');
    expect(pk).toContain('contact_1');
  });

  test('GSI constants are defined', () => {
    expect(keys.GSI.CONTACT_COMPANY).toBeDefined();
    expect(keys.GSI.CONV_BY_COMPANY).toBeDefined();
    expect(keys.GSI.LEAD_BY_COMPANY).toBeDefined();
  });
});

describe('Core — systemMeta.js', () => {
  const { newMeta, updateMeta, softDeleteMeta } = require('../src/core/systemMeta');

  test('newMeta returns version 1 with ISO timestamps', () => {
    const meta = newMeta('system');
    expect(meta.version).toBe(1);
    expect(new Date(meta.createdAt).getTime()).not.toBeNaN();
    expect(meta.createdBy).toBe('system');
  });

  test('updateMeta increments version', () => {
    const meta = newMeta('system');
    const updated = updateMeta(meta, 'emp_1');
    expect(updated.version).toBe(2);
    expect(updated.updatedBy).toBe('emp_1');
  });

  test('softDeleteMeta adds deletedAt', () => {
    const meta = newMeta('system');
    const deleted = softDeleteMeta(meta, 'admin');
    expect(deleted.deletedAt).toBeDefined();
    expect(deleted.deletedBy).toBe('admin');
  });
});

// ─── Utilities ────────────────────────────────────────────────────────────────

describe('Utils — phoneNormalize.js', () => {
  const { normalizeE164 } = require('../src/utils/phoneNormalize');

  test('normalizes Indian 10-digit to E.164', () => {
    expect(normalizeE164('9901251785')).toBe('+919901251785');
  });

  test('passes through valid E.164', () => {
    expect(normalizeE164('+919901251785')).toBe('+919901251785');
  });

  test('returns null for clearly invalid input', () => {
    expect(normalizeE164('invalid')).toBeNull();
  });
});

describe('Utils — featureFlags.js', () => {
  const featureFlags = require('../src/utils/featureFlags');

  test('exports DEFAULTS, getFlags, isEnabled, _clearCache', () => {
    expect(typeof featureFlags.getFlags).toBe('function');
    expect(typeof featureFlags.isEnabled).toBe('function');
    expect(typeof featureFlags._clearCache).toBe('function');
    expect(typeof featureFlags.DEFAULTS).toBe('object');
  });

  test('DEFAULTS has only boolean values', () => {
    for (const val of Object.values(featureFlags.DEFAULTS)) {
      expect(typeof val).toBe('boolean');
    }
  });
});

describe('Utils — operationalMetrics.js', () => {
  const { emitMetric } = require('../src/utils/operationalMetrics');

  test('exports emitMetric as a function', () => {
    expect(typeof emitMetric).toBe('function');
  });

  test('emitMetric does not throw for valid inputs', () => {
    expect(() => emitMetric('Smoke', 'TestMetric', 1, 'Count', { env: 'test' })).not.toThrow();
  });

  test('emitMetric does not throw for minimal inputs', () => {
    expect(() => emitMetric('Smoke', 'Minimal', 0)).not.toThrow();
  });
});

// ─── Services ─────────────────────────────────────────────────────────────────

describe('Services — ConversationService constants', () => {
  const { STATUS, CONVERSATION_TYPE, HANDOFF_STATE, VALID_CHANNELS } =
    require('../src/services/ConversationService');

  test('STATUS has open and resolved', () => {
    expect(STATUS.OPEN).toBe('open');
    expect(STATUS.RESOLVED).toBe('resolved');
  });

  test('CONVERSATION_TYPE.CUSTOMER is the default', () => {
    expect(CONVERSATION_TYPE.CUSTOMER).toBe('customer');
  });

  test('HANDOFF_STATE.HUMAN is the default', () => {
    expect(HANDOFF_STATE.HUMAN).toBe('human');
  });

  test('VALID_CHANNELS includes whatsapp', () => {
    expect(VALID_CHANNELS).toContain('whatsapp');
  });
});

describe('Services — LeadService', () => {
  const LeadService = require('../src/services/LeadService');

  test('exports linkContactToLead', () => {
    expect(typeof LeadService.linkContactToLead).toBe('function');
  });
});
