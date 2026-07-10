'use strict';

// Shared per-contact mutation logic for CRM leads / INBOX contacts — used by
// both the existing single-contact routes (crm.js's /leads/:id/assign,
// contacts.js's /stage, tags.js's /contacts) and the new bulk endpoint
// (contacts.js's POST /bulk-update), so the actual DynamoDB logic exists in
// exactly one place (same discipline as fetchFilteredContacts, Track A2).
//
// Pure business logic — assumes the caller has already validated required
// fields/shapes; throws NotFoundError for a missing record, lets any other
// error (validation, DynamoDB) propagate for the caller to handle.

const dynamodb = require('../config/dynamodb');
const { to10Digit } = require('../utils/phone');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

class NotFoundError extends Error {}

const leadKey  = (companyId, leadId) => ({ PK: `LEAD#${companyId}#${leadId}`, SK: 'METADATA' });
const inboxKey = (companyId, phone)  => ({ PK: `INBOX#${companyId}#${to10Digit(phone)}`, SK: 'CONTACT' });

function contactKey(companyId, { leadId, phone }) {
  if (leadId) return leadKey(companyId, leadId);
  if (phone)  return inboxKey(companyId, phone);
  throw new Error('leadId or phone required');
}

// ── Assign employee to a lead ────────────────────────────────────────────────
// Unconditional SET of absolute values (assignedTo/assignedToName/chatStatus),
// never reads-then-merges — two concurrent assigns to the same lead are just
// last-write-wins on the same shape, no lost-update race is possible here by
// construction. (Confirmed 2026-07-10 while diagnosing the Contacts bulk-
// action partial-failure report — this route was never the race some of that
// report's framing assumed; see updateTags() below for where a real race does exist.)
async function assignLead(companyId, leadId, { assignedTo, assignedToName }) {
  const Key = leadKey(companyId, leadId);
  const existing = await dynamodb.get({ TableName: TABLE, Key }).promise();
  if (!existing.Item) throw new NotFoundError('Lead not found');

  await dynamodb.update({
    TableName: TABLE,
    Key,
    UpdateExpression: 'SET assignedTo = :at, assignedToName = :atn, chatStatus = :cs, updatedAt = :ua',
    ExpressionAttributeValues: {
      ':at': assignedTo,
      ':atn': assignedToName ?? null,
      ':cs': 'open',
      ':ua': new Date().toISOString(),
    },
  }).promise();

  return { assignedTo, assignedToName: assignedToName ?? null };
}

// ── Change pipeline stage for a lead or unknown contact ─────────────────────
// Same shape as assignLead — unconditional SET, no read-modify-write, no race.
async function updateStage(companyId, { leadId, phone }, stage) {
  const Key = contactKey(companyId, { leadId, phone });
  await dynamodb.update({
    TableName: TABLE,
    Key,
    UpdateExpression: 'SET stage = :s',
    ExpressionAttributeValues: { ':s': stage },
  }).promise();
  return { stage };
}

// ── Add/remove tags ───────────────────────────────────────────────────────────
// THE REAL RACE (2026-07-10 diagnosis correction): `tags` is stored as a plain
// DynamoDB List (a JS array via the document client), not a native String Set
// (SS). A List has no atomic ADD/DELETE-by-value update expression — that
// requires every existing contact/lead across every company to be migrated to
// Set-typed `tags`, real-data work with a much larger blast radius than this
// fix and gated by the hold-for-review-before-touching-real-records rule.
// Optimistic concurrency (conditional write on updatedAt, retry on conflict)
// gets the same race-free guarantee without touching storage shape: a losing
// writer's condition fails, it re-reads the now-current tags and retries its
// own add/remove against that state, bounded by MAX_RETRIES. This is what
// actually eliminates the lost-update race for two rapid tag toggles on the
// SAME contact (e.g. ContactTags.tsx in Inbox/Customer 360) — the scenario
// the original report's "race" framing was really describing, just not in
// the bulk-select flow (which always targets distinct contacts and can't
// collide with itself).
const MAX_RETRIES = 5;

async function updateTags(companyId, { leadId, phone }, { add = [], remove = [] }) {
  const Key = contactKey(companyId, { leadId, phone });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const r = await dynamodb.get({ TableName: TABLE, Key }).promise();
    const current = r.Item?.tags ?? [];
    const currentUpdatedAt = r.Item?.updatedAt ?? null;
    const updated = [
      ...current.filter((t) => !remove.includes(t)),
      ...add.filter((t) => !current.includes(t)),
    ];
    const now = new Date().toISOString();

    try {
      await dynamodb.update({
        TableName: TABLE,
        Key,
        UpdateExpression: 'SET tags = :t, updatedAt = :ua',
        ConditionExpression: currentUpdatedAt ? 'updatedAt = :expected' : 'attribute_not_exists(updatedAt)',
        ExpressionAttributeValues: {
          ':t': updated,
          ':ua': now,
          ...(currentUpdatedAt ? { ':expected': currentUpdatedAt } : {}),
        },
      }).promise();
      return { tags: updated };
    } catch (e) {
      // Another writer (tag mutation OR any other route touching this
      // contact's updatedAt) won this round — re-read the fresh state and
      // retry our own add/remove against it rather than clobbering theirs.
      if (e.code === 'ConditionalCheckFailedException' && attempt < MAX_RETRIES) continue;
      throw e;
    }
  }
}

module.exports = { assignLead, updateStage, updateTags, contactKey, NotFoundError };
