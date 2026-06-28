'use strict';

const crypto = require('crypto');

// Crockford's base32 alphabet — omits I, L, O, U to reduce visual ambiguity.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Encode a 48-bit millisecond Unix timestamp into 10 Crockford base32 chars.
// Uses modulo/floor (not bitwise) because Date.now() exceeds the 32-bit signed range
// and bitwise operators in JS silently truncate to 32 bits.
function encodeTime(ms) {
  const chars = new Array(10);
  let t = ms;
  for (let i = 9; i >= 0; i--) {
    chars[i] = B32[t % 32];
    t = Math.floor(t / 32);
  }
  return chars.join('');
}

// Encode 10 random bytes (80 bits) into 16 Crockford base32 chars.
// Two passes of 5 bytes → 8 chars each (5 bits per char × 8 = 40 bits = 5 bytes).
function encodeRandom(buf) {
  const chars = new Array(16);
  for (let c = 0; c < 2; c++) {
    const o = c * 8;
    const s = c * 5;
    chars[o]     = B32[(buf[s]   & 0xF8) >> 3];
    chars[o + 1] = B32[((buf[s]   & 0x07) << 2) | (buf[s+1] >> 6)];
    chars[o + 2] = B32[(buf[s+1] & 0x3E) >> 1];
    chars[o + 3] = B32[((buf[s+1] & 0x01) << 4) | (buf[s+2] >> 4)];
    chars[o + 4] = B32[((buf[s+2] & 0x0F) << 1) | (buf[s+3] >> 7)];
    chars[o + 5] = B32[(buf[s+3] & 0x7C) >> 2];
    chars[o + 6] = B32[((buf[s+3] & 0x03) << 3) | (buf[s+4] >> 5)];
    chars[o + 7] = B32[buf[s+4] & 0x1F];
  }
  return chars.join('');
}

// Generate a raw ULID: 10-char timestamp + 16-char random = 26 chars.
// Lexicographically sortable by creation time. URL-safe. Globally unique.
function ulid() {
  return encodeTime(Date.now()) + encodeRandom(crypto.randomBytes(10));
}

// Entity ID prefixes — one constant per entity type.
// Every new entity ID MUST use one of these generators — never generate inline.
const PREFIX = Object.freeze({
  CONTACT:      'contact_',
  CONVERSATION: 'conv_',
  LEAD:         'lead_',
  ACCOUNT:      'account_',   // Phase 2
  TASK:         'task_',      // Phase 2
  DOCUMENT:     'doc_',       // Phase 2
  CAMPAIGN:     'campaign_',
  WORKFLOW:     'wf_',        // Phase 3
  EVENT:        'evt_',       // Timeline events
});

// Entity ID generators — each returns `${prefix}${ulid()}`.
const generateContactId      = () => PREFIX.CONTACT      + ulid();
const generateConversationId = () => PREFIX.CONVERSATION + ulid();
const generateLeadId         = () => PREFIX.LEAD         + ulid();
const generateAccountId      = () => PREFIX.ACCOUNT      + ulid();
const generateTaskId         = () => PREFIX.TASK         + ulid();
const generateDocumentId     = () => PREFIX.DOCUMENT     + ulid();
const generateCampaignId     = () => PREFIX.CAMPAIGN     + ulid();
const generateWorkflowId     = () => PREFIX.WORKFLOW     + ulid();
const generateEventId        = () => PREFIX.EVENT        + ulid();

// Extract the prefix from a prefixed ID, e.g. 'contact_' from 'contact_01J...'.
// Returns null for non-string input or IDs with no underscore.
function getPrefix(id) {
  if (typeof id !== 'string') return null;
  const idx = id.indexOf('_');
  return idx === -1 ? null : id.slice(0, idx + 1);
}

// Decode the embedded Unix timestamp (ms) from a prefixed or raw ULID.
// Useful for debugging ("when was this entity created?") without a DB round-trip.
// Returns null if the input is not a valid prefixed ID or raw ULID.
function extractTimestamp(id) {
  if (typeof id !== 'string') return null;
  const underscore = id.indexOf('_');
  const raw = underscore === -1 ? id : id.slice(underscore + 1);
  if (raw.length < 10) return null;
  const timeStr = raw.slice(0, 10).toUpperCase();
  let ms = 0;
  for (const ch of timeStr) {
    const v = B32.indexOf(ch);
    if (v === -1) return null;
    ms = ms * 32 + v;
  }
  return ms;
}

module.exports = {
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
};
