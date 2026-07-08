# Phase 3 — Technical Debt

## GSI Pollution — leadsByCompany

**Issue:** `leadsByCompany` GSI contains METRICS, CONV, CONTACT, and CONFIG records because all share the `companyId` attribute. The GSI indexes every record that has `companyId`, not just leads.

**Fix:** Add an `entityType` attribute to all DynamoDB records (e.g. `LEAD`, `CONV`, `CONTACT`, `CONFIG`, `METRIC`). Recreate or add a filtered GSI that keys on `companyId` with a filter condition on `entityType = 'LEAD'`.

**Priority:** Medium — must be resolved before the table reaches ~10,000+ records to avoid query performance degradation and excessive read costs from filtering noise out of GSI results.

## ~~Incomplete Hard-Purge — CONV#/TL# Not Cleaned Up~~ — FIXED 2026-07-08

**Issue (as of 2026-07-07):** `DELETE /api/crm/leads/:id` (`crm.js:607-669`) purged the `LEAD#`/`INBOX#` partitions and released the phone-uniqueness lock, but never touched `CONV#`/`TL#` — a separate, newer (Phase 2 Customer 360) entity family this route's partition list was never extended to cover. A "hard purge" left conversation content behind (`CONV#META`'s `lastMessageText`, potentially `aiSummary`) in orphaned records pointing at a lead that no longer existed.

**Fix (2026-07-08, Era 37 — see `19_DECISION_LOG.md`):** The purge route now also deletes `TL#{companyId}#LEAD#{leadId}` (always) and, when the lead's METADATA has a `convId` pointer, the linked `CONV#{companyId}#{conversationId}` partition and its `TL#{companyId}#CONV#{conversationId}` timeline. Leads pre-dating the `convId` pointer, or that never received an inbound WhatsApp message, have no linked conversation — the route detects this and skips cleanly (logged, not an error).

**Scope correction from the original finding:** `TL#{companyId}#CONTACT#{contactId}` is deliberately **not** deleted. The Contact entity is a separate, longer-lived identity this route has never touched (contacts are not owned by a single lead) — auditing this fix confirmed nothing else reads `CONV#`/`TL#` independent of a `LEAD#` today (no route, service, or dashboard reads them at all outside `ConversationService`/`ConversationRepository`/`events/timeline.js` themselves), so this was safe to close with no other consumers to account for.

**Outcome surfacing:** each of the three best-effort deletes (TL#LEAD, CONV#, TL#CONV) is tracked (not just logged) via a `convTlPurge` object written onto the `crm_lead_purged` audit record. A partial failure there does not block the primary LEAD# purge or 500 the route, but is surfaced as a `warning` field in the response too (additive — today's only caller, `dashboard/src/app/(v3)/contacts/page.tsx`'s bulk-delete, ignores unknown response fields, so this is backward-compatible).

**Validation:** `tests/leadPurgeConvTl.test.js` drives the real purge route, `CustomerIdentityService`, `ConversationService`, and event publisher/timeline writer against a shared in-memory DynamoDB fake — confirms LEAD#/INBOX#/lock/CONV#/TL#(LEAD)/TL#(CONV) are all gone post-purge, TL#(CONTACT) survives untouched, the missing-`convId` edge case purges without error, and a forced CONV#/TL# failure still lets LEAD# purge succeed while surfacing the partial failure in both the response and the audit record. Full suite: 1336/1336 passing.

## No Automated Test Coverage for Frontend Role-Gating Logic

**Issue:** `dashboard/` has zero unit-test tooling for `.tsx` components (no Jest/RTL/Vitest configured, no `test` script in `dashboard/package.json`) and no live E2E credentials in this environment (Playwright's `e2e/smoke/` suite needs a real running dev server plus per-role login, none configured here — confirmed while validating Wave 2's RBAC fixes, commit `19336d8`). Every RBAC-sensitive frontend fix in that wave (`ProtectedRoute` gates, `canVerify`/`canCreate`/`canMutate`-style booleans) was validated by manual verification notes only — reading the code and the live backend `checkRole()` call, not by running an automated check that would catch a future regression.

**Fix:** Not yet scoped. Would need either component-level tests (Jest/RTL or Vitest, testing each gate boolean against a mocked `useAuth()` per role) or reactivating/extending the disabled Era 25 Playwright harness (`e2e/smoke/protectedRoute.spec.ts`, `test.describe.skip`) with real per-role fixtures and CI credentials.

**Priority:** Medium — RBAC frontend/backend drift has now been found and fixed in two separate waves (Wave 1, Wave 2) purely by manual code audit; without automated coverage, the same class of bug (a v3Role-bucket check silently admitting a role the backend rejects) can reappear undetected in any future change to these pages.

## No Running Dev Server or Browser Available in This Claude Code Environment

**Issue:** No dev server or browser is available in this Claude Code environment — confirmed across Wave 2 (RBAC gating) and Wave 3 (Fix 1, Fix 4). All frontend behavior-change fixes here are validated via `tsc`/`build`/`grep` only; live-render/interaction verification is a recommendation for Viir to perform, not something Claude Code can confirm happened.

## ContactHeader.tsx — Port Customer Journey Bar Before Deleting (Queued, Not Started)

**Issue:** `ContactHeader.tsx` (`dashboard/src/components/contacts/ContactHeader.tsx`) has zero importers — `app/(v3)/contacts/[contactId]/page.tsx` uses its own inline header JSX instead. Investigated during Wave 3 (Fix 2): the inline JSX is **not** a strict superset. Confirmed real, non-trivial functionality exists only in the orphaned component and is not reproduced anywhere else in the codebase: the **Customer Journey Bar** (`CustomerJourneyBar.tsx` + its sole dependency `lib/contacts/journeyInference.ts`, the 6th orphan found), an "Open in WhatsApp Web" quick deep-link, and a "Customer 360" workspace badge pill. Per decision, the Journey Bar is real, documented product functionality (Customer 360 header spec), not scaffolding — it must not be silently dropped as part of a dead-code cleanup.

**Fix (queued, not started):** Port the Customer Journey Bar (and `journeyInference.ts`) out of `ContactHeader.tsx` and into wherever `[contactId]/page.tsx`'s current inline header lives. Once ported and confirmed working, the rest of `ContactHeader.tsx`, its other orphaned children (`ContactAvatar.tsx`, `HealthScoreBadge.tsx`, `ContactIdentityBlock.tsx`, `ContactMetaRow.tsx`), and `components/common/Skeleton.tsx` become safe to delete — but re-confirm at that point that none of them gained a new consumer in the meantime; don't assume the Wave 3 orphan-check still holds. (Separately, decide whether the WhatsApp deep-link and the "Customer 360" badge pill are also worth porting, or intentionally dropped — they're minor compared to the Journey Bar but were also confirmed to have no equivalent elsewhere.)

**Priority:** Medium — not urgent, but the longer `ContactHeader.tsx` sits unreferenced, the more likely a future contributor mistakes it for pure dead code and deletes it (and the Journey Bar with it) without knowing this decision was made.

## Inbox → useCustomer360() Cache Consolidation (Queued, Not Started)

**Issue:** `inbox/page.tsx`'s conversation panel owns its own React Query cache (`['wa-conv', convKey]`) for data that, for known leads, duplicates `Customer360Provider`'s `['contact', leadId]` cache (`Customer360Context.tsx`) — the exact duplicate-ownership pattern `dashboard/CLAUDE.md`'s Commit-Level Enforcement forbids. Wave 3 (Fix 4) fixed the concrete symptom (stage changes from Inbox not reflecting in Customer 360's CRM tab) with a targeted cache invalidation, but did not consolidate the cache ownership itself.

**Blocker found (log this so it isn't rediscovered from scratch):** `Customer360Provider` explicitly does not represent unknown/non-lead contacts (its own doc comment: "Unknown/INBOX# contacts... are not representable here: callers must branch before mounting this provider") — but Inbox's conversation panel handles unknown contacts routinely, via a completely different endpoint (`/api/whatsapp/inbox/unknown/:phone/messages` vs. `/api/crm/leads/:leadId`). A full migration cannot simply swap the hook; it would need Inbox to conditionally consume `useCustomer360()` for known-lead conversations only, while re-threading its optimistic-send cache update, its websocket-triggered refetch, and a second co-located notes query (all currently keyed on `['wa-conv', convKey]`) onto whatever the new arrangement is — across the app's largest, most real-time-sensitive page.

**Fix:** Not yet scoped. Needs a dedicated plan (not squeezed into an unrelated wave) covering: how Inbox distinguishes known-lead vs. unknown-contact conversations for cache purposes, how the optimistic-send update targets the right cache shape in both cases, and whether `Customer360Provider` should be extended to cover unknown contacts or Inbox should keep two parallel paths permanently.

**Priority:** Medium — the immediate user-facing symptom (stale Customer 360 stage) is fixed; this entry tracks the underlying architectural duplication, which is cosmetic risk (extra network calls, cache drift on other fields besides stage) rather than an active bug right now.
