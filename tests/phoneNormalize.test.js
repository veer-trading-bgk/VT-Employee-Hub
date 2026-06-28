'use strict';

const { normalizeE164, isE164 } = require('../src/utils/phoneNormalize');

describe('src/utils/phoneNormalize.js', () => {
  describe('normalizeE164() — Indian numbers', () => {
    test('10-digit number → +91 prefix', () => {
      expect(normalizeE164('9876543210')).toBe('+919876543210');
    });

    test('10-digit with leading spaces → +91 prefix', () => {
      expect(normalizeE164('  9876543210  ')).toBe('+919876543210');
    });

    test('11-digit with leading 0 → +91 prefix (STD dialling)', () => {
      expect(normalizeE164('09876543210')).toBe('+919876543210');
    });

    test('12-digit with 91 prefix (no +) → +91...', () => {
      expect(normalizeE164('919876543210')).toBe('+919876543210');
    });

    test('already E.164 → returned unchanged (normalised)', () => {
      expect(normalizeE164('+919876543210')).toBe('+919876543210');
    });

    test('E.164 with spaces and dashes → stripped', () => {
      expect(normalizeE164('+91 98765-43210')).toBe('+919876543210');
    });
  });

  describe('normalizeE164() — WhatsApp JID stripping', () => {
    test('919876543210@s.whatsapp.net → +919876543210', () => {
      expect(normalizeE164('919876543210@s.whatsapp.net')).toBe('+919876543210');
    });

    test('919876543210@g.us (group JID) → +919876543210', () => {
      expect(normalizeE164('919876543210@g.us')).toBe('+919876543210');
    });

    test('+919876543210@s.whatsapp.net → +919876543210', () => {
      expect(normalizeE164('+919876543210@s.whatsapp.net')).toBe('+919876543210');
    });
  });

  describe('normalizeE164() — international numbers', () => {
    test('US E.164 → returned unchanged', () => {
      expect(normalizeE164('+14155552671')).toBe('+14155552671');
    });

    test('UK E.164 → returned unchanged', () => {
      expect(normalizeE164('+441234567890')).toBe('+441234567890');
    });

    test('11-digit without +, not Indian 0-prefix → treated as country-code number', () => {
      // 11 digits not starting with 0 → assumed to include country code
      expect(normalizeE164('14155552671')).toBe('+14155552671');
    });
  });

  describe('normalizeE164() — invalid inputs', () => {
    test('null → null', () => {
      expect(normalizeE164(null)).toBeNull();
    });

    test('undefined → null', () => {
      expect(normalizeE164(undefined)).toBeNull();
    });

    test('empty string → null', () => {
      expect(normalizeE164('')).toBeNull();
    });

    test('non-string → null', () => {
      expect(normalizeE164(9876543210)).toBeNull();
    });

    test('alphabetic string → null', () => {
      expect(normalizeE164('abc')).toBeNull();
    });

    test('too short (6 digits) → null', () => {
      expect(normalizeE164('123456')).toBeNull();
    });

    test('too long (16 digits with +) → null', () => {
      expect(normalizeE164('+1234567890123456')).toBeNull();
    });

    test('E.164 too short (6 digits after +) → null', () => {
      expect(normalizeE164('+12345')).toBeNull();
    });
  });

  describe('normalizeE164() — idempotency', () => {
    test('calling twice returns the same result', () => {
      const once  = normalizeE164('9876543210');
      const twice = normalizeE164(once);
      expect(once).toBe(twice);
    });

    test('WhatsApp JID → E.164 → E.164 (idempotent)', () => {
      const jid   = '919876543210@s.whatsapp.net';
      const first = normalizeE164(jid);
      expect(normalizeE164(first)).toBe(first);
    });
  });

  describe('isE164()', () => {
    test('valid E.164 → true', () => {
      expect(isE164('+919876543210')).toBe(true);
      expect(isE164('+14155552671')).toBe(true);
    });

    test('missing + → false', () => {
      expect(isE164('919876543210')).toBe(false);
    });

    test('null → false', () => {
      expect(isE164(null)).toBe(false);
    });

    test('empty → false', () => {
      expect(isE164('')).toBe(false);
    });

    test('too short → false', () => {
      expect(isE164('+12345')).toBe(false);
    });

    test('normalizeE164 output always passes isE164', () => {
      const inputs = ['9876543210', '09876543210', '+919876543210', '919876543210'];
      for (const input of inputs) {
        const e164 = normalizeE164(input);
        expect(isE164(e164)).toBe(true);
      }
    });
  });
});
