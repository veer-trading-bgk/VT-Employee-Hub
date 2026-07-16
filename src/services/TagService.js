'use strict';

const dynamodb = require('../config/dynamodb');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const MAX_CONFLICT_RETRIES = 3;

// ─── Tag catalog (single source of truth: TAG_CATALOG#<companyId> / CATALOG) ──
//
// Every writer of this item shares ONE `version` attribute and conditions on
// it: mutateCatalog()'s full-replace writes (tag create/edit/delete) and
// addLabelIfMissing()'s list_append (auto-created labels from lead
// create/update/import) both read it, both increment it, both retry on
// ConditionalCheckFailedException. That's what lets either side detect the
// other's concurrent write instead of silently overwriting it — without a
// shared counter, a full-array write can't tell whether the array it read
// is still current, and a concurrent append (or another full-replace) that
// landed in between just vanishes when it writes back its stale snapshot.

function catalogKey(companyId) {
  return { PK: `TAG_CATALOG#${companyId}`, SK: 'CATALOG' };
}

/**
 * Fetch the company's tag catalog.
 * @param {string} companyId
 * @returns {Promise<Array<{id: string, label: string, color: string, createdAt?: string, aiAssignable?: boolean}>>}
 */
async function getCatalog(companyId) {
  const r = await dynamodb.get({ TableName: TABLE, Key: catalogKey(companyId) }).promise();
  return r.Item?.tags ?? [];
}

/**
 * Read-modify-write the catalog under optimistic concurrency. Replaces the
 * old saveCatalog(companyId, tags) — a plain, unconditioned dynamodb.put —
 * which every caller (tag create/edit/delete) used to call after its own
 * getCatalog() read, with no version check at all. That was the second half
 * of the tag-catalog race: a concurrent addLabelIfMissing() append (or
 * another one of these same writes) landing between the read and the write
 * would silently disappear when the stale snapshot got written back.
 *
 * `mutatorFn(tags)` receives the current catalog array and returns:
 *  - `{ skipWrite: true, ...dataForCaller }` — no write should happen at all
 *    (e.g. tag id not found, or a duplicate label) — returned immediately,
 *    dynamodb is never touched.
 *  - `{ tags: newArray, ...dataForCaller }` — replace the array with
 *    `newArray` (e.g. delete's filter, create's append).
 *  - `{ ...dataForCaller }` (no `tags` key) — the array was mutated in
 *    place (e.g. edit's `tags[idx].field = ...`); that mutated array is
 *    what gets written.
 *
 * On a version conflict (someone else — another mutateCatalog() call, or
 * addLabelIfMissing() — wrote first), re-reads and re-runs mutatorFn against
 * fresh data rather than failing the request; bounded to
 * MAX_CONFLICT_RETRIES so a pathological hot tag can't retry forever.
 *
 * @param {string} companyId
 * @param {(tags: Array<object>) => ({ tags?: Array<object>, skipWrite?: boolean } & Record<string, unknown>)} mutatorFn
 * @returns {Promise<object>} whatever mutatorFn returned
 */
async function mutateCatalog(companyId, mutatorFn, _retry = 0) {
  const r = await dynamodb.get({ TableName: TABLE, Key: catalogKey(companyId) }).promise();
  const tags = r.Item?.tags ?? [];
  const version = r.Item?.version ?? 0;

  const result = mutatorFn(tags) ?? {};
  if (result.skipWrite) return result;

  try {
    await dynamodb.put({
      TableName: TABLE,
      Item: { ...catalogKey(companyId), tags: result.tags ?? tags, version: version + 1 },
      ConditionExpression: 'attribute_not_exists(#ver) OR #ver = :ver',
      ExpressionAttributeNames: { '#ver': 'version' },
      ExpressionAttributeValues: { ':ver': version },
    }).promise();
    return result;
  } catch (e) {
    if (e.code === 'ConditionalCheckFailedException' && _retry < MAX_CONFLICT_RETRIES) {
      return mutateCatalog(companyId, mutatorFn, _retry + 1);
    }
    throw e;
  }
}

/**
 * Atomically ensure a label exists in the catalog, auto-creating it if not,
 * and return its catalog entry (existing or newly created).
 *
 * Uses a `list_append` UpdateExpression rather than mutateCatalog()'s
 * conditional full-replace: an append never needs to see or touch any OTHER
 * tag's fields, so it reads the list's current value server-side at the
 * moment THIS update commits and can never overwrite a field it didn't
 * touch, no matter how it interleaves with a concurrent mutateCatalog()
 * call. It shares mutateCatalog()'s exact `version` attribute (see the file
 * header), so mutateCatalog() correctly sees this write and retries against
 * fresh data instead of clobbering it, and vice versa.
 * @param {string} companyId
 * @param {string} label
 * @param {string} [color]
 * @returns {Promise<{id: string, label: string, color: string, createdAt: string}>}
 */
async function addLabelIfMissing(companyId, label, color = '#6366f1', _retry = 0) {
  const trimmed = label.trim();
  const r = await dynamodb.get({ TableName: TABLE, Key: catalogKey(companyId) }).promise();
  const catalog = r.Item?.tags ?? [];
  const version = r.Item?.version ?? 0;

  const existing = catalog.find((t) => t.label.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;

  const newTag = {
    id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    label: trimmed,
    color,
    createdAt: new Date().toISOString(),
  };

  try {
    await dynamodb.update({
      TableName: TABLE,
      Key: catalogKey(companyId),
      UpdateExpression: 'SET tags = list_append(if_not_exists(tags, :empty), :newTag), #ver = :newVer',
      ConditionExpression: 'attribute_not_exists(#ver) OR #ver = :ver',
      ExpressionAttributeNames: { '#ver': 'version' },
      ExpressionAttributeValues: {
        ':empty': [],
        ':newTag': [newTag],
        ':ver': version,
        ':newVer': version + 1,
      },
    }).promise();
    return newTag;
  } catch (e) {
    if (e.code === 'ConditionalCheckFailedException' && _retry < MAX_CONFLICT_RETRIES) {
      // Someone else appended (or this is the first write racing another
      // first write) — re-read, re-check for the label, retry.
      return addLabelIfMissing(companyId, label, color, _retry + 1);
    }
    throw e;
  }
}

// ─── Filter matching ──────────────────────────────────────────────────────────
// Contacts store catalog tag IDs (t_xxx), but two legacy shapes still exist:
//   - contacts imported/automated before IDs: raw label strings in lead.tags
//   - campaign/broadcast filters saved before the ID migration: labels in filter.tags
// expandTagFilter() resolves every filter value to BOTH its ID and its label
// (case-insensitive) so any combination of the four shapes still matches.

/**
 * Expand filter tag values into a lowercase accept-set of ids + labels.
 * @param {string} companyId
 * @param {string[]} filterTags  tag IDs and/or labels as sent by the client
 * @returns {Promise<Set<string>>} lowercase set to test lead tags against
 */
async function expandTagFilter(companyId, filterTags) {
  const accept = new Set();
  if (!filterTags?.length) return accept;
  const catalog = await getCatalog(companyId);
  const byId    = new Map(catalog.map((t) => [t.id, t]));
  const byLabel = new Map(catalog.map((t) => [t.label.toLowerCase(), t]));

  for (const raw of filterTags) {
    const v = String(raw).trim();
    if (!v) continue;
    accept.add(v.toLowerCase());
    const hit = byId.get(v) ?? byLabel.get(v.toLowerCase());
    if (hit) {
      accept.add(hit.id.toLowerCase());
      accept.add(hit.label.toLowerCase());
    }
  }
  return accept;
}

/**
 * Test whether a contact's tags intersect an accept-set from expandTagFilter().
 * @param {string[]|undefined} contactTags  tag IDs (or legacy labels) on the record
 * @param {Set<string>} acceptSet
 * @returns {boolean}
 */
function matchesTagFilter(contactTags, acceptSet) {
  if (acceptSet.size === 0) return true;
  return (contactTags ?? []).some((t) => acceptSet.has(String(t).toLowerCase()));
}

module.exports = { getCatalog, mutateCatalog, addLabelIfMissing, expandTagFilter, matchesTagFilter };
