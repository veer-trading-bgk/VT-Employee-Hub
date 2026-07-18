// Pure cache-invalidation helper — no React, no component state.
// Companion to assignmentBridge.ts's assignmentKey: that file owns the
// canonical ['assignment', leadId] key, this one owns the canonical
// invalidation sweep for the three OTHER cache families every contact
// mutation can touch.

import type { QueryClient } from '@tanstack/react-query';

/**
 * Invalidates every React Query cache family that can hold a stale copy of
 * one or more contacts:
 *   - ['contacts']        Contacts list (every paginated/filtered variant)
 *   - ['sales-contacts']  Sales CRM flat list (Kanban + List views)
 *   - ['contact', leadId] Customer 360's single-contact cache (per id)
 *
 * Mirrors the set of layers useOwnerAssign.ts already established as
 * canonical for a contact-mutating action — call this instead of
 * hand-picking a subset of the three per call site, so no module has to
 * remember all three again. leadIds may be a single id, an array (bulk
 * operations), or omitted/null/undefined entries, which are skipped —
 * unknown (phone-only) contacts have no ['contact', id] cache, so passing
 * their id here is a harmless no-op rather than something callers need to
 * filter out themselves.
 */
export function invalidateContactCaches(
  qc: QueryClient,
  leadIds?: string | null | (string | null | undefined)[],
): void {
  qc.invalidateQueries({ queryKey: ['contacts'] });
  qc.invalidateQueries({ queryKey: ['sales-contacts'] });
  const ids = Array.isArray(leadIds) ? leadIds : [leadIds];
  for (const id of ids) {
    if (id) qc.invalidateQueries({ queryKey: ['contact', id] });
  }
}
