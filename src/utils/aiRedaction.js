'use strict';

// Fields that must never reach an LLM prompt, regardless of useCase — regulated IDs
// and credentials, not general customer PII (name/phone/email stay available by
// default since features like reply personalization functionally need them).
const SENSITIVE_FIELDS = [
  'panNumber',
  'aadhaarNumber',
  'password',
  'totpSecret',
  'backupCodes',
  'homeAddress',
  'baseSalary',
  'accessToken',
  'refreshToken',
];

const PAN_PATTERN      = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const AADHAAR_PATTERN  = /\b\d{12}\b/g;

/**
 * Strips every SENSITIVE_FIELDS key from `context`, recursively through nested
 * objects and arrays. Returns a new value — never mutates the input, since the
 * same context object may still be used by the caller after this call.
 *
 * @param {*} context
 * @param {string[]} [allowFields] — per-useCase opt-out for specific field names,
 *   applied at any depth. The caller (AIService) is responsible for logging the
 *   justification for any allowFields use; this function only applies the exemption.
 */
function redactContext(context, allowFields = []) {
  const denylist = new Set(SENSITIVE_FIELDS.filter((f) => !allowFields.includes(f)));
  return stripFields(context, denylist);
}

function stripFields(value, denylist) {
  if (Array.isArray(value)) {
    return value.map((v) => stripFields(v, denylist));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (denylist.has(key)) continue;
      out[key] = stripFields(val, denylist);
    }
    return out;
  }
  return value;
}

/**
 * Unconditional, no-opt-out defense-in-depth pass over the fully-assembled prompt
 * text — catches a PAN/Aadhaar value that leaked in through a freeform field
 * redactContext()'s field denylist wouldn't have seen (e.g. a customer's ID number
 * pasted into a lead's notes field rather than a named sensitive field).
 */
function scrubSensitivePatterns(text) {
  if (!text) return text;
  return text.replace(PAN_PATTERN, '[REDACTED]').replace(AADHAAR_PATTERN, '[REDACTED]');
}

module.exports = { redactContext, scrubSensitivePatterns, SENSITIVE_FIELDS };
