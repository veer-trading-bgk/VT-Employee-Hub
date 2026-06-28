'use strict';

/**
 * publishEvent() — the single entry point for all domain events.
 *
 * ARCHITECTURE CONTRACT
 * ─────────────────────
 * Every module that needs to record something happened calls publishEvent().
 * No module writes TL# records directly. No module calls cross-module
 * functions directly. All cross-module communication flows through this.
 *
 * PHASE EVOLUTION (callers never change code)
 * ───────────────────────────────────────────
 * Phase 1: writes TL# records + runs registered handlers (synchronous, setImmediate)
 * Phase 3: swap internals to EventBridge.putEvents() — callers are untouched
 *
 * LAMBDA NOTE
 * ───────────
 * setImmediate defers processing until after the current I/O cycle, ensuring
 * the primary HTTP response is sent before timeline writes begin. Lambda keeps
 * the execution context alive until the event loop drains, so writes that fit
 * within the remaining function timeout will complete. This is acceptable for
 * Phase 1. Phase 3 (EventBridge) removes this dependency entirely.
 *
 * GUARANTEE
 * ─────────
 * publishEvent() never throws. It never returns a Promise. Callers must not
 * await it. A failure inside the deferred processing is logged and discarded.
 */

const crypto = require('crypto');

const { writeTlRecords } = require('./timeline');
const { getHandlers }    = require('./handlers');
const logger             = require('../config/logger');

/**
 * Generate a unique event ID.
 * Format: evt_<20 random hex chars>
 * Uses crypto.randomBytes — more reliable than Math.random for uniqueness.
 */
function generateEventId() {
  return `evt_${crypto.randomBytes(10).toString('hex')}`;
}

/**
 * Publish a domain event.
 *
 * @param {string} eventType  - constant from catalog.E
 * @param {object} payload
 *   @param {string}   payload.companyId           required
 *   @param {string}   payload.entityType          required — primary entity (ENTITY.*)
 *   @param {string}   payload.entityId            required — primary entity ID
 *   @param {string}   [payload.contactId]         contact this event relates to
 *   @param {string}   [payload.actorId]           employee who caused it (null = system)
 *   @param {string}   [payload.actorName]
 *   @param {string}   [payload.channel]           whatsapp | email | system | telegram
 *   @param {string}   payload.summary             human-readable one-liner for display
 *   @param {object}   [payload.metadata]          event-specific data
 *   @param {Array}    [payload.additionalEntities]
 *     [{entityType, entityId}] — write to these timelines too
 *     e.g. stage_changed writes to LEAD timeline + CONTACT timeline
 *
 * @returns {void}  — fire-and-forget. Do NOT await this.
 */
function publishEvent(eventType, payload) {
  // Guard: validate required fields before deferring so callers get immediate
  // feedback in logs without waiting for the setImmediate cycle.
  if (!eventType || typeof eventType !== 'string') {
    logger.warn('[publishEvent] invalid eventType — skipped');
    return;
  }
  if (!payload || !payload.companyId || !payload.entityType || !payload.entityId) {
    logger.warn(`[publishEvent] ${eventType} missing companyId/entityType/entityId — skipped`);
    return;
  }

  const event = {
    eventId:    generateEventId(),
    eventType,
    timestamp:  new Date().toISOString(),
    companyId:  payload.companyId,
    contactId:  payload.contactId  ?? null,
    entityType: payload.entityType,
    entityId:   payload.entityId,
    actorId:    payload.actorId    ?? null,
    actorName:  payload.actorName  ?? null,
    channel:    payload.channel    ?? null,
    summary:    payload.summary    ?? '',
    metadata:   payload.metadata   ?? {},
  };

  // Build the full list of timeline partitions to write to.
  // The primary entity is always included. additionalEntities fan the event out.
  const targets = [
    { entityType: event.entityType, entityId: event.entityId },
    ...(Array.isArray(payload.additionalEntities) ? payload.additionalEntities : []),
  ];

  // Defer all processing — caller's response path is not blocked.
  setImmediate(async () => {
    try {
      // 1. Write to all timeline partitions (best-effort, parallel)
      await writeTlRecords(event, targets);

      // 2. Run registered handlers (Phase 1: none registered — this loop is a no-op)
      const handlers = getHandlers(eventType);
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (handlerErr) {
          logger.warn(`[publishEvent] handler error for ${eventType}: ${handlerErr.message}`);
        }
      }
    } catch (err) {
      // Outer catch: defensive — writeTlRecords already swallows per-write errors,
      // but guard against any unexpected throw from the outer async block.
      logger.warn(`[publishEvent] processing error for ${eventType}: ${err.message}`);
    }
  });
}

module.exports = { publishEvent };
