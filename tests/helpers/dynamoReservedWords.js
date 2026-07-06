'use strict';

/**
 * Reproduces DynamoDB's own reserved-keyword validation inside a jest mock, so a test
 * can catch the AutomationEngine.js `_finalizeExecution()` "path" bug class (a dynamic
 * attribute name interpolated raw into an UpdateExpression instead of routed through
 * ExpressionAttributeNames) automatically, instead of relying on a plain
 * always-resolves mock that can never distinguish a valid expression from an invalid
 * one. See docs/bible/19_DECISION_LOG.md Era 19 for the incident this closes.
 *
 * The word list below is a curated subset of DynamoDB's ~570 reserved words (the ones
 * realistic for this schema's field names) -- not exhaustive. Treat this as a
 * test-time heuristic, not the authoritative defense; see Era 19's recommendation for
 * a CI-level check against the real, complete reserved-word list.
 */
const DYNAMODB_RESERVED_WORDS = new Set([
  'name', 'names', 'path', 'status', 'state', 'data', 'date', 'size', 'type', 'types',
  'value', 'values', 'count', 'order', 'group', 'level', 'mode', 'role', 'roles',
  'comment', 'default', 'table', 'tables', 'view', 'views', 'language', 'region',
  'zone', 'year', 'month', 'day', 'time', 'timestamp', 'user', 'users', 'owner',
  'key', 'keys', 'items', 'item', 'index', 'action', 'source', 'target', 'text',
  'number', 'list', 'map', 'set', 'string', 'null', 'true', 'false', 'and', 'or',
  'not', 'in', 'between',
]);

const CLAUSE_KEYWORDS = new Set(['SET', 'ADD', 'REMOVE', 'DELETE', 'if_not_exists', 'list_append']);

// Tokens not immediately preceded by '#' (an ExpressionAttributeNames placeholder) or
// ':' (an ExpressionAttributeValues placeholder) are raw attribute-name references —
// exactly the shape that crashes against a reserved word. "stats.delivered"-style
// document paths are split on '.' since each segment is validated independently.
function _rawAttributeNames(updateExpression) {
  const tokens = updateExpression.match(/(?<![#:])[A-Za-z_][A-Za-z0-9_.]*/g) ?? [];
  return tokens.filter((t) => !CLAUSE_KEYWORDS.has(t)).flatMap((t) => t.split('.'));
}

function assertNoRawReservedKeyword(params) {
  const expr = params?.UpdateExpression ?? '';
  const aliased = new Set(Object.values(params?.ExpressionAttributeNames ?? {}));
  for (const name of _rawAttributeNames(expr)) {
    if (DYNAMODB_RESERVED_WORDS.has(name.toLowerCase()) && !aliased.has(name)) {
      const err = new Error(`Invalid UpdateExpression: Attribute name is a reserved keyword; reserved keyword: ${name}`);
      err.code = 'ValidationException';
      throw err;
    }
  }
}

/** jest mockImplementation for dynamodb.update() — resolves normally unless the
 * UpdateExpression references a reserved keyword raw, in which case it rejects with
 * the same error shape DynamoDB itself would return. */
function guardedUpdateMock(resolvedValue = {}) {
  return (params) => {
    try {
      assertNoRawReservedKeyword(params);
    } catch (err) {
      return { promise: () => Promise.reject(err) };
    }
    return { promise: () => Promise.resolve(resolvedValue) };
  };
}

module.exports = { DYNAMODB_RESERVED_WORDS, assertNoRawReservedKeyword, guardedUpdateMock };
