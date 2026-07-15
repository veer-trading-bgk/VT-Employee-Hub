'use strict';

const dynamodb = require('../config/dynamodb');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// ─── Tag catalog (single source of truth: TAG_CATALOG#<companyId> / CATALOG) ──

/**
 * Fetch the company's tag catalog.
 * @param {string} companyId
 * @returns {Promise<Array<{id: string, label: string, color: string, createdAt?: string, aiAssignable?: boolean}>>}
 */
async function getCatalog(companyId) {
  const r = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `TAG_CATALOG#${companyId}`, SK: 'CATALOG' },
  }).promise();
  return r.Item?.tags ?? [];
}

/**
 * Persist the company's tag catalog (full replace).
 * @param {string} companyId
 * @param {Array<object>} tags
 */
async function saveCatalog(companyId, tags) {
  await dynamodb.put({
    TableName: TABLE,
    Item: { PK: `TAG_CATALOG#${companyId}`, SK: 'CATALOG', tags },
  }).promise();
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

module.exports = { getCatalog, saveCatalog, expandTagFilter, matchesTagFilter };
