'use strict';

/**
 * Normalise any phone representation to E.164 format (+<country><number>).
 *
 * Handles:
 *   - WhatsApp JIDs:   919876543210@s.whatsapp.net → +919876543210
 *   - Indian 10-digit: 9876543210                  → +919876543210
 *   - Indian with 0:   09876543210                 → +919876543210
 *   - Indian with 91:  919876543210                → +919876543210
 *   - E.164 already:   +919876543210               → +919876543210
 *   - International:   +447911123456               → +447911123456
 *   - With formatting: +91 98765-43210             → +919876543210
 *
 * Returns null for unparseable or out-of-range inputs.
 *
 * Phase 1 assumption: 10-digit numbers without a country prefix are Indian.
 * Multi-country lookup will be added in Phase 3 when geo-routing is introduced.
 */
function normalizeE164(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Strip WhatsApp JID suffixes (@s.whatsapp.net, @g.us, etc.)
  let s = raw.includes('@') ? raw.split('@')[0] : raw;
  s = s.trim();

  const hasPlus = s.startsWith('+');

  // Strip everything that isn't a digit
  const digits = s.replace(/\D/g, '');

  if (!digits) return null;

  // Already E.164 style: trust the + prefix, just re-validate the length.
  // E.164 mandates 7–15 digits after the country code.
  if (hasPlus) {
    return (digits.length >= 7 && digits.length <= 15) ? `+${digits}` : null;
  }

  // Indian mobile heuristics (Phase 1 default — see note above)
  if (digits.length === 10)                               return `+91${digits}`;         // 9876543210
  if (digits.length === 11 && digits.startsWith('0'))     return `+91${digits.slice(1)}`; // 09876543210
  if (digits.length === 12 && digits.startsWith('91'))    return `+${digits}`;            // 919876543210

  // International fallback: 8–15 raw digits assumed to already include country code.
  // Covers US (11), UK (12), etc. passed without a + prefix.
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;

  return null;
}

/**
 * Return true if the string is a valid E.164 phone number.
 * Used for fast validation without calling normalizeE164 twice.
 */
function isE164(s) {
  if (!s || typeof s !== 'string') return false;
  return /^\+[1-9]\d{6,14}$/.test(s);
}

module.exports = { normalizeE164, isE164 };
