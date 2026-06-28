'use strict';

const {
  ulid,
  PREFIX,
  generateContactId,
  generateConversationId,
  generateLeadId,
  generateAccountId,
  generateTaskId,
  generateDocumentId,
  generateCampaignId,
  generateWorkflowId,
  generateEventId,
  getPrefix,
  extractTimestamp,
} = require('../src/core/id');

const { newMeta, updateMeta, softDeleteMeta, restoreMeta } = require('../src/core/systemMeta');

const CROCKFORD_RE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

// ─── src/core/id.js ──────────────────────────────────────────────────────────

describe('src/core/id.js', () => {
  // ── ulid() ─────────────────────────────────────────────────────────────────

  describe('ulid()', () => {
    test('returns a 26-character string', () => {
      const id = ulid();
      expect(typeof id).toBe('string');
      expect(id).toHaveLength(26);
    });

    test('uses only Crockford base32 characters (uppercase)', () => {
      for (let i = 0; i < 30; i++) {
        expect(ulid()).toMatch(CROCKFORD_RE);
      }
    });

    test('generates 500 unique values', () => {
      const ids = new Set();
      for (let i = 0; i < 500; i++) ids.add(ulid());
      expect(ids.size).toBe(500);
    });

    test('encodes a timestamp within the Date.now() window', () => {
      const before = Date.now();
      const id     = ulid();
      const after  = Date.now();
      const ts     = extractTimestamp(id);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after + 1);
    });

    test('IDs generated in sequence are lexicographically non-decreasing', async () => {
      // Force two different milliseconds so the timestamp portion differs.
      const a = ulid();
      await new Promise(r => setTimeout(r, 2));
      const b = ulid();
      expect(a < b).toBe(true);
    });
  });

  // ── PREFIX constants ────────────────────────────────────────────────────────

  describe('PREFIX constants', () => {
    test('object is frozen', () => {
      expect(Object.isFrozen(PREFIX)).toBe(true);
    });

    test('every prefix ends with an underscore', () => {
      for (const key of Object.keys(PREFIX)) {
        expect(PREFIX[key]).toMatch(/_$/);
      }
    });

    test('contains all expected entity types', () => {
      expect(PREFIX).toMatchObject({
        CONTACT:      'contact_',
        CONVERSATION: 'conv_',
        LEAD:         'lead_',
        ACCOUNT:      'account_',
        TASK:         'task_',
        DOCUMENT:     'doc_',
        CAMPAIGN:     'campaign_',
        WORKFLOW:     'wf_',
        EVENT:        'evt_',
      });
    });
  });

  // ── entity ID generators ────────────────────────────────────────────────────

  describe('entity ID generators', () => {
    const generators = [
      { fn: generateContactId,      prefix: PREFIX.CONTACT,      name: 'generateContactId'      },
      { fn: generateConversationId, prefix: PREFIX.CONVERSATION, name: 'generateConversationId' },
      { fn: generateLeadId,         prefix: PREFIX.LEAD,         name: 'generateLeadId'         },
      { fn: generateAccountId,      prefix: PREFIX.ACCOUNT,      name: 'generateAccountId'      },
      { fn: generateTaskId,         prefix: PREFIX.TASK,         name: 'generateTaskId'         },
      { fn: generateDocumentId,     prefix: PREFIX.DOCUMENT,     name: 'generateDocumentId'     },
      { fn: generateCampaignId,     prefix: PREFIX.CAMPAIGN,     name: 'generateCampaignId'     },
      { fn: generateWorkflowId,     prefix: PREFIX.WORKFLOW,     name: 'generateWorkflowId'     },
      { fn: generateEventId,        prefix: PREFIX.EVENT,        name: 'generateEventId'        },
    ];

    test.each(generators)(
      '$name starts with its prefix',
      ({ fn, prefix }) => {
        expect(fn()).toMatch(new RegExp(`^${prefix.replace('_', '\\_')}`));
      }
    );

    test.each(generators)(
      '$name appends exactly a 26-char Crockford base32 ULID',
      ({ fn, prefix }) => {
        const id  = fn();
        const raw = id.slice(prefix.length);
        expect(raw).toHaveLength(26);
        expect(raw).toMatch(CROCKFORD_RE);
      }
    );

    test('all 9 generators produce globally unique values across 100 calls each', () => {
      const all = new Set();
      for (const { fn } of generators) {
        for (let i = 0; i < 100; i++) all.add(fn());
      }
      expect(all.size).toBe(generators.length * 100);
    });
  });

  // ── getPrefix() ─────────────────────────────────────────────────────────────

  describe('getPrefix()', () => {
    test('returns the prefix from a contact ID', () => {
      expect(getPrefix(generateContactId())).toBe('contact_');
    });

    test('returns the prefix from a conv ID', () => {
      expect(getPrefix(generateConversationId())).toBe('conv_');
    });

    test('returns the prefix from a lead ID', () => {
      expect(getPrefix(generateLeadId())).toBe('lead_');
    });

    test('returns the prefix from an evt ID', () => {
      expect(getPrefix(generateEventId())).toBe('evt_');
    });

    test('returns null for non-string input', () => {
      expect(getPrefix(null)).toBeNull();
      expect(getPrefix(42)).toBeNull();
      expect(getPrefix(undefined)).toBeNull();
      expect(getPrefix({})).toBeNull();
    });

    test('returns null when there is no underscore', () => {
      expect(getPrefix('NOUNDERSCORE')).toBeNull();
    });
  });

  // ── extractTimestamp() ──────────────────────────────────────────────────────

  describe('extractTimestamp()', () => {
    test('decodes timestamp within expected range from a prefixed ID', () => {
      const before = Date.now();
      const id     = generateContactId();
      const after  = Date.now();
      const ts     = extractTimestamp(id);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after + 1);
    });

    test('works on raw ULIDs (no prefix)', () => {
      const before = Date.now();
      const raw    = ulid();
      const after  = Date.now();
      const ts     = extractTimestamp(raw);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after + 1);
    });

    test('returns null for non-string input', () => {
      expect(extractTimestamp(null)).toBeNull();
      expect(extractTimestamp(123)).toBeNull();
      expect(extractTimestamp(undefined)).toBeNull();
    });

    test('returns null when ULID part is too short', () => {
      expect(extractTimestamp('contact_SHORT')).toBeNull();
    });

    test('returns null for invalid base32 characters (I, L, O, U are not in the alphabet)', () => {
      expect(extractTimestamp('contact_IIIIIIIIIIXXXXXXXXXXXXXXX')).toBeNull();
    });
  });

  // ── ID safety ───────────────────────────────────────────────────────────────

  describe('ID safety: no business data embedded', () => {
    test('IDs contain no email-like patterns', () => {
      for (let i = 0; i < 50; i++) {
        expect(generateContactId()).not.toMatch(/@/);
        expect(generateLeadId()).not.toMatch(/@/);
        expect(generateConversationId()).not.toMatch(/@/);
      }
    });

    test('IDs contain no run of 10+ consecutive digits (phone number pattern)', () => {
      // ULID random parts are base32 — a run of 10+ raw digits would be extremely
      // improbable and indicative of embedded business data.
      for (let i = 0; i < 200; i++) {
        expect(generateContactId()).not.toMatch(/\d{10,}/);
        expect(generateLeadId()).not.toMatch(/\d{10,}/);
      }
    });
  });
});

// ─── src/core/systemMeta.js ───────────────────────────────────────────────────

describe('src/core/systemMeta.js', () => {
  // ── newMeta() ───────────────────────────────────────────────────────────────

  describe('newMeta()', () => {
    test('returns all required fields', () => {
      const meta = newMeta();
      expect(meta).toMatchObject({
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        createdBy: expect.any(String),
        updatedBy: expect.any(String),
        version:   1,
      });
    });

    test('defaults actorId to "system"', () => {
      const meta = newMeta();
      expect(meta.createdBy).toBe('system');
      expect(meta.updatedBy).toBe('system');
    });

    test('uses the provided actorId', () => {
      const meta = newMeta('emp_abc123');
      expect(meta.createdBy).toBe('emp_abc123');
      expect(meta.updatedBy).toBe('emp_abc123');
    });

    test('treats falsy actorId as "system"', () => {
      expect(newMeta(null).createdBy).toBe('system');
      expect(newMeta('').createdBy).toBe('system');
    });

    test('version is exactly 1', () => {
      expect(newMeta().version).toBe(1);
    });

    test('createdAt and updatedAt are equal', () => {
      const meta = newMeta();
      expect(meta.createdAt).toBe(meta.updatedAt);
    });

    test('timestamps are valid ISO 8601', () => {
      const meta = newMeta();
      expect(new Date(meta.createdAt).toISOString()).toBe(meta.createdAt);
      expect(new Date(meta.updatedAt).toISOString()).toBe(meta.updatedAt);
    });

    test('does NOT include deletedAt or deletedBy', () => {
      const meta = newMeta();
      expect(meta).not.toHaveProperty('deletedAt');
      expect(meta).not.toHaveProperty('deletedBy');
    });
  });

  // ── updateMeta() ────────────────────────────────────────────────────────────

  describe('updateMeta()', () => {
    test('increments version by 1', () => {
      expect(updateMeta({ version: 1 }).version).toBe(2);
    });

    test('increments from any version', () => {
      expect(updateMeta({ version: 7 }).version).toBe(8);
      expect(updateMeta({ version: 0 }).version).toBe(1);
    });

    test('treats missing version as 0', () => {
      expect(updateMeta({}).version).toBe(1);
      expect(updateMeta(null).version).toBe(1);
    });

    test('sets updatedAt to a valid ISO timestamp', () => {
      const patch = updateMeta({ version: 1 });
      expect(new Date(patch.updatedAt).toISOString()).toBe(patch.updatedAt);
    });

    test('uses the provided actorId', () => {
      const patch = updateMeta({ version: 1 }, 'emp_xyz');
      expect(patch.updatedBy).toBe('emp_xyz');
    });

    test('defaults updatedBy to "system"', () => {
      const patch = updateMeta({ version: 1 });
      expect(patch.updatedBy).toBe('system');
    });

    test('does NOT include createdAt or createdBy (immutable)', () => {
      const patch = updateMeta({ version: 1 });
      expect(patch).not.toHaveProperty('createdAt');
      expect(patch).not.toHaveProperty('createdBy');
    });

    test('does NOT include deletedAt or deletedBy', () => {
      const patch = updateMeta({ version: 1 });
      expect(patch).not.toHaveProperty('deletedAt');
      expect(patch).not.toHaveProperty('deletedBy');
    });
  });

  // ── softDeleteMeta() ────────────────────────────────────────────────────────

  describe('softDeleteMeta()', () => {
    test('includes deletedAt and deletedBy', () => {
      const patch = softDeleteMeta({ version: 1 }, 'emp_admin');
      expect(patch).toHaveProperty('deletedAt');
      expect(patch.deletedBy).toBe('emp_admin');
    });

    test('deletedAt equals updatedAt (same timestamp)', () => {
      const patch = softDeleteMeta({ version: 1 });
      expect(patch.deletedAt).toBe(patch.updatedAt);
    });

    test('increments version', () => {
      const patch = softDeleteMeta({ version: 3 });
      expect(patch.version).toBe(4);
    });

    test('defaults actor to "system"', () => {
      const patch = softDeleteMeta({ version: 1 });
      expect(patch.deletedBy).toBe('system');
      expect(patch.updatedBy).toBe('system');
    });

    test('deletedAt is a valid ISO timestamp', () => {
      const patch = softDeleteMeta({ version: 1 });
      expect(new Date(patch.deletedAt).toISOString()).toBe(patch.deletedAt);
    });

    test('does NOT include createdAt or createdBy', () => {
      const patch = softDeleteMeta({ version: 1 });
      expect(patch).not.toHaveProperty('createdAt');
      expect(patch).not.toHaveProperty('createdBy');
    });
  });

  // ── restoreMeta() ───────────────────────────────────────────────────────────

  describe('restoreMeta()', () => {
    test('includes _removeAttrs signal for DynamoDB REMOVE expression', () => {
      const patch = restoreMeta({ version: 2 });
      expect(patch._removeAttrs).toEqual(['deletedAt', 'deletedBy']);
    });

    test('increments version', () => {
      expect(restoreMeta({ version: 2 }).version).toBe(3);
    });

    test('sets updatedAt and updatedBy', () => {
      const patch = restoreMeta({ version: 1 }, 'emp_manager');
      expect(patch.updatedBy).toBe('emp_manager');
      expect(new Date(patch.updatedAt).toISOString()).toBe(patch.updatedAt);
    });

    test('does NOT include deletedAt or deletedBy as regular fields', () => {
      const patch = restoreMeta({ version: 1 });
      expect(patch).not.toHaveProperty('deletedAt');
      expect(patch).not.toHaveProperty('deletedBy');
    });
  });

  // ── version monotonicity ────────────────────────────────────────────────────

  describe('version monotonicity across full lifecycle', () => {
    test('newMeta → updateMeta → updateMeta → softDeleteMeta → restoreMeta', () => {
      const created = newMeta('emp_a');
      expect(created.version).toBe(1);

      const patch1 = updateMeta(created, 'emp_b');
      expect(patch1.version).toBe(2);

      const after1 = { ...created, ...patch1 };
      const patch2 = updateMeta(after1, 'emp_c');
      expect(patch2.version).toBe(3);

      const after2 = { ...after1, ...patch2 };
      const deleted = softDeleteMeta(after2, 'emp_admin');
      expect(deleted.version).toBe(4);

      const after3 = { ...after2, ...deleted };
      const restored = restoreMeta(after3, 'emp_admin');
      expect(restored.version).toBe(5);
    });
  });
});
