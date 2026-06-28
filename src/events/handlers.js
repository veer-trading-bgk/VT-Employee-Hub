'use strict';

/**
 * Event handler registry.
 *
 * Phase 1: empty — no handlers registered.
 * Phase 2: automation engine registers handlers here.
 * Phase 3: AI pipeline, workflow engine register here.
 *
 * Handlers run after the Timeline write completes.
 * A handler failure is logged and swallowed — it never surfaces to
 * the original request handler or affects other registered handlers.
 *
 * Usage:
 *   const { onEvent } = require('../events/handlers');
 *   const { E }       = require('../events/catalog');
 *   onEvent(E.LEAD_CREATED, async (event) => { ... });
 */

const _registry = new Map();

/**
 * Register an async handler for a specific event type.
 *
 * @param {string}   eventType - from catalog.E
 * @param {function} handler   - async (event: CanonicalEvent) => void
 */
function onEvent(eventType, handler) {
  if (typeof handler !== 'function') {
    throw new TypeError(`onEvent: handler must be a function, got ${typeof handler}`);
  }
  if (!_registry.has(eventType)) _registry.set(eventType, []);
  _registry.get(eventType).push(handler);
}

/**
 * Retrieve all handlers registered for an event type.
 * Returns an empty array when none are registered — safe to iterate.
 *
 * @param {string} eventType
 * @returns {function[]}
 */
function getHandlers(eventType) {
  return _registry.get(eventType) ?? [];
}

/**
 * Remove all handlers for an event type.
 * Primarily used in tests to reset state between runs.
 *
 * @param {string} eventType
 */
function clearHandlers(eventType) {
  _registry.delete(eventType);
}

/**
 * Remove all handlers across all event types.
 * Used in tests only.
 */
function clearAllHandlers() {
  _registry.clear();
}

module.exports = { onEvent, getHandlers, clearHandlers, clearAllHandlers };
