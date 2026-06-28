'use strict';

// Create system metadata for a new entity. Call exactly once at creation time.
// createdAt and createdBy are immutable after this point — never pass them to updateMeta.
function newMeta(actorId = 'system') {
  const actor = actorId || 'system';
  const now   = new Date().toISOString();
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
    version:   1,
  };
}

// Build the patch fields for an UPDATE operation.
// Returns ONLY the fields that should change — never overwrites createdAt / createdBy.
// Spread this into your DynamoDB update expression attributes.
//
// DynamoDB optimistic locking: use `version` in a ConditionExpression before calling this,
// then write the returned patch (which has version + 1) to win the update.
function updateMeta(current, actorId = 'system') {
  const version = (current && typeof current.version === 'number') ? current.version : 0;
  return {
    updatedAt: new Date().toISOString(),
    updatedBy: actorId || 'system',
    version:   version + 1,
  };
}

// Build the patch fields for a SOFT DELETE.
// Soft-deleted entities are excluded from queries via `attribute_not_exists(deletedAt)`.
// Does NOT physically remove the DynamoDB item — the record is preserved for audit.
function softDeleteMeta(current, actorId = 'system') {
  const now    = new Date().toISOString();
  const actor  = actorId || 'system';
  const version = (current && typeof current.version === 'number') ? current.version : 0;
  return {
    updatedAt: now,
    updatedBy: actor,
    version:   version + 1,
    deletedAt: now,
    deletedBy: actor,
  };
}

// Build the patch fields for RESTORING a soft-deleted entity.
// The caller MUST include `REMOVE deletedAt, deletedBy` in the DynamoDB UpdateExpression
// to physically remove those attributes. The _removeAttrs array signals which attributes
// need the REMOVE clause — it is not written to the database.
function restoreMeta(current, actorId = 'system') {
  const version = (current && typeof current.version === 'number') ? current.version : 0;
  return {
    updatedAt:    new Date().toISOString(),
    updatedBy:    actorId || 'system',
    version:      version + 1,
    _removeAttrs: ['deletedAt', 'deletedBy'],
  };
}

module.exports = { newMeta, updateMeta, softDeleteMeta, restoreMeta };
