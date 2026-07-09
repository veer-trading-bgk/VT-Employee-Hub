# Phase 3 — Technical Debt

## GSI Pollution — leadsByCompany

**Issue:** `leadsByCompany` GSI contains METRICS, CONV, CONTACT, and CONFIG records because all share the `companyId` attribute. The GSI indexes every record that has `companyId`, not just leads.

**Fix:** Add an `entityType` attribute to all DynamoDB records (e.g. `LEAD`, `CONV`, `CONTACT`, `CONFIG`, `METRIC`). Recreate or add a filtered GSI that keys on `companyId` with a filter condition on `entityType = 'LEAD'`.

**Priority:** Medium — must be resolved before the table reaches ~10,000+ records to avoid query performance degradation and excessive read costs from filtering noise out of GSI results.

## PDF Extraction Test Fails Inside Jest Only — Not a Production Bug

**Issue:** `tests/documentExtraction.test.js`'s `'PDF: extracts heading and body text'` test fails (`result.ok` is `false`) when run under Jest — confirmed pre-existing as of at least Era 42 (commit `12a9405`), not introduced by any later change. The same `extractText()` call against the same real fixture (`tests/fixtures/sample.pdf`) succeeds when run in a plain Node script outside Jest — verified deterministically, 3/3 runs, correct extracted blocks (`"Fees & Charges"`, the real body text). Isolated specifically to the PDF path: the DOCX/PPTX/XLSX fixture tests in the same file all pass. Root cause traced to `documentExtraction.js`'s PDF branch, which loads `officeParser`'s PDF support (`pdfjs-dist`) via a `file://` URL worker (`PDF_WORKER_SRC`) — that worker load evidently behaves differently under Jest's sandboxed module/VM environment than under a bare `node` process, though the exact mechanism (module registry, `globalThis` differences, worker-thread interaction with Jest's own worker-based test runner, or something else in that family) has not been pinned down further.

**Fix:** Not yet root-caused past the above. Needs investigation into either mocking/stubbing the `pdfjs-dist` worker load specifically for the Jest environment, or an alternative test strategy for the PDF extraction path that doesn't depend on Jest's VM sandbox correctly handling a `file://` worker.

**Priority:** Low — real PDF extraction works correctly in production (Lambda runs as a real Node process, not inside Jest), so this is a test-suite gap, not a production bug. But it means the PDF extraction path currently has no passing automated test coverage — worth knowing before assuming a green CI run means every extraction path is verified.

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

## Wave 5 — Full Audit Log: 84 Medium/Low Findings (2026-07-08 Codebase Audit)

**Source:** The 2026-07-08 "APForce Major Codebase Audit" — 11 parallel research agents (3 backend RBAC inventory, 1 frontend role-gating inventory, 1 RBAC cross-check, 2 dead-code sweeps, 1 connections audit, 1 ADR compliance sweep, 1 security/rate-limit sweep, 1 duplicate-logic sweep), ~1.78M tokens, 559 tool calls, ~20 min wall-clock, read-only. The PDF Viir uploaded only rendered Critical/High findings — Medium/Low/Informational items were behind collapsed `<details>` sections never expanded before export. Recovered from a full "Save As" HTML snapshot of the source Claude Artifact page (`C:\Users\admin\Downloads\APForce Major Codebase Audit_files\saved_resource.html`) — the collapsed sections' content is present in the HTML DOM regardless of visual collapse state. All 118 total findings (5 critical, 16 high, 37 medium, 47 low, plus 13 informational not counted in the "84") were already fully accounted for; every Critical/High item below matches a fix already shipped in Waves 1-3 of this session. This entry transcribes only the 37 medium + 47 low = 84 items that were previously inaccessible. Verbatim from source, not paraphrased or reconstructed.

### RBAC & Role Wiring (7: 3 medium, 4 low)

**Medium:**
1. `src/routes/contacts.js` — *backend-missing-role-restriction* — PUT /stage (line 202) has no checkRole() and no ownership/assignment check whatsoever — any authenticated role (telecaller/agent/intern included) can move ANY lead or unknown contact in the company to any stage. The near-identical crm.js PUT /leads/:id/stage (line 509), mutating the exact same `stage` field on the same record type, DOES restrict telecaller/agent/intern to their own assigned lead. This is a real backend inconsistency between two routes governing identical data.
2. `dashboard/src/app/(v3)/automation/page.tsx` — *frontend-hides-backend-allows* — ProtectedRoute allows only `['admin']` (line 97) plus the superadmin bypass, hiding the entire Automation page from manager. But the backend allows manager to call GET /api/automations/stats, /executions, /, and /:id (all rolesRequired: admin, manager). Managers lose all visibility into automation dashboards, workflow lists, and execution history.
3. `dashboard/src/app/(v3)/contacts/page.tsx` — *frontend-hides-backend-allows* — The per-row 'Assigned to' owner reassignment control (line 282) is gated to owner/admin only, excluding manager. But PUT /api/crm/leads/:id/assign allows admin AND manager (crm.js line 474). Inconsistent with Inbox's equivalent control (canAssignOwner in lib/permissions.js, which correctly includes manager) for the exact same endpoint. **(Fixed in Wave 2, Fix 8 — commit `24965fe`.)**

**Low:**
4. `dashboard/src/app/(v3)/settings/page.tsx` — *frontend-hides-backend-allows* — The Tags settings section is one of 12 sections flagged adminOnly, hidden from manager entirely. But backend tags.js allows manager to POST / (create tag) and PUT /:id (rename/edit) — only DELETE /:id correctly excludes manager.
5. `dashboard/src/components/templates/TemplateList.tsx` — *frontend-hides-backend-allows* — The per-template Send button (canSendRole, line 72) is restricted to owner/admin/manager, hiding it from sales/support. But POST /api/whatsapp/send-template has no checkRole at all (any authenticated role can send an approved template).
6. `dashboard/src/app/(v3)/contacts/page.tsx` — *frontend-hides-backend-allows* — The combined Import/Export buttons (line 281) are gated to owner/admin/manager. Import correctly matches backend (admin/manager only), but Export uses GET /api/contacts, which has no role restriction at all. Agent/telecaller can't export even their own visible contacts.
7. `dashboard/src/hooks/useMetrics.ts` — *frontend-hides-backend-allows* — useRoleScopedMetrics()'s `isAdmin` flag (line 70) checks the raw role for exact equality to 'admin', pointedly excluding 'superadmin' — unlike almost every other gate in the codebase. Can suppress 'all metrics'/'team-summary' queries for a superadmin even though the backend would allow it.

### Security & Rate-Limit Coverage (16: 3 medium, 13 low)

**Medium:**
1. `src/routes/platform.js:91` — *missing-rate-limit* — PUT /companies/:companyId/plan (changes tenant plan/billing incl. suspend) and POST /companies/:companyId/unsuspend (line 161) are platformAdminMiddleware-gated (superadmin-only) but have no rateLimit at all.
2. `src/routes/stockAnalysisAdmin.js:167` — *missing-rate-limit* — PATCH /users/:email lets a stock-analysis admin change a user's role/status/dailySearchLimit with no rate limiting. Also unthrottled: POST /invites/:email/approve (line 68), POST /invites/:email/reject (line 116).
3. `src/routes/badges.js:78` — *missing-rate-limit* — POST /check (authMiddleware, no rateLimit) runs an unpaginated dynamodb.scan over the entire metrics table on every call.

**Low:**
4. `src/middleware/auth.js:14` — *auth-logic-bug* — Verified correct on all 4 specifically-requested bug classes (no fall-through after error responses; `checkRole([])` correctly denies rather than allows; role comparisons are case-sensitive but no live path produces a differently-cased role; `jwt.verify` passes no explicit `algorithms` allow-list — safe today via jsonwebtoken 9.0.3's default, but recommend adding `{ algorithms: ['HS256'] }` explicitly as defense-in-depth).
5. `src/routes/tags.js:28` — *missing-rate-limit* — POST / (create tag), PUT /contacts (bulk-tag), PUT /:id, DELETE /:id all lack rateLimit despite authMiddleware+checkRole.
6. `src/routes/forms.js:25` — *missing-rate-limit* — POST /, PUT /:id, DELETE /:id lack rateLimit. Separately: POST /:id/submit and POST /meta-leads/webhook are intentionally public with no rate limiting either, open to submission-flooding/spam.
7. `src/routes/automations.js:310` — *missing-rate-limit* — PUT /:id, PUT /:id/status, DELETE /:id lack rateLimit unlike POST / and POST /:id/duplicate in the same file. Also (informational): POST /_tick (line 172) appears shadowed/unreachable since app.js registers the same path directly before mounting this router.
8. `src/routes/campaigns.js:268` — *missing-rate-limit* — PUT /:id and DELETE /:id lack rateLimit, inconsistent with POST /, /audience/preview, /audience/validate, /:id/launch in the same file.
9. `src/routes/points.js:28` — *missing-rate-limit* — POST /award (admin/manager/team_lead) has no throttling.
10. `src/routes/attendance.js:32` — *missing-rate-limit* — POST /mark, POST /leave, PUT /leave/:userId/:leaveId all lack rateLimit.
11. `src/routes/knowledgeCenter.js:73` — *missing-rate-limit* — Only AI-test/publish/restore routes use KNOWLEDGE_TEST_RATE_LIMIT; POST / (create entry), PUT /:entryId/draft, /archive, /unarchive have no rate limit.
12. `src/routes/knowledgeDocuments.js:97` — *missing-rate-limit* — Only POST / uses UPLOAD_RATE_LIMIT; PUT /:documentId, /publish, /archive, /unarchive have no rate limit.
13. `src/routes/aiAdmin.js:79` — *missing-rate-limit* — Only prompt-addendum test/publish/restore routes use PROMPT_TEST_RATE_LIMIT; PUT /general, /conversation, /future, /prompt-addendum/draft have no rate limit.
14. `src/routes/companies.js:49` — *missing-rate-limit* — PUT /profile (adminMiddleware) has no rate limit.
15. `src/routes/whatsapp.js:368` — *missing-rate-limit* — POST /manual-connect, DELETE /connection, PUT /config, POST /connection/probe, POST /connection/repair, DELETE /branches/:branchId, POST /inbox/:leadId/mark-read, POST /inbox/unknown/:phone/mark-read all lack rateLimit.
16. `src/routes/ai.js:84` — *missing-rate-limit* — PUT /config (admin) writes AI config with no throttling. POST /insights and /team-insights also lack rateLimit but are currently low-impact (both short-circuited to HTTP 410).

### Frontend ↔ Backend Connections (19: 3 medium, 16 low)

**Medium:**
1. `src/routes/attendance.js:32` — *orphaned-backend-route* — POST /api/attendance/mark has zero callers anywhere in dashboard/src. The route's own comment claims "auto-called on login" but no login flow actually calls it — reads as an abandoned/incomplete integration.
2. `src/routes/attendance.js:150` — *orphaned-backend-route* — GET /api/attendance/leave (the real, correct "own leave history" endpoint) has zero callers, because the frontend calls the nonexistent `/leave/my` instead (see the Critical broken-call finding, already fixed). Fixing the frontend call to hit this existing route is the correct fix, not adding a new backend route.
3. `src/routes/forms.js:13` — *orphaned-backend-route* — GET/POST /api/forms (list/create), PUT/DELETE /api/forms/:id all have zero frontend callers. Only the public form-view/submit pair is wired up — no admin UI anywhere to build/list/edit/delete lead-capture forms.

**Low:**
4. `src/routes/badges.js:23` — GET /api/badges/user/:userId, POST /api/badges/check have zero callers. `BadgeCard.tsx` exists fully built but never rendered anywhere — likely an abandoned gamification feature.
5. `src/routes/points.js:28` — POST /award, GET /leaderboard, GET /my all have zero callers — a second, parallel points system superseded by the metrics-based leaderboard actually used.
6. `src/routes/companies.js:17` — GET/PUT /api/companies/profile have zero callers — no company-profile editing UI anywhere under Settings.
7. `src/routes/companies.js:94` — GET /api/companies/trial has zero callers; its own comment claims a "trial banner" consumer that doesn't exist (banner sources trial info elsewhere now).
8. `src/routes/crm.js:143` — GET /api/crm/leads (bare list) has zero callers — every bare call is a POST (create); dashboard uses GET /api/contacts as the unified list instead.
9. `src/routes/crm.js:782` — POST /api/crm/leads/:id/restore has zero callers — no "undo delete" affordance anywhere in Contacts UI.
10. `src/routes/crm.js:1234` — GET /api/crm/stats and GET /api/crm/crm-analytics (line 1257) both have zero callers — Analytics page is built entirely on /api/metrics/* and /api/analytics instead.
11. `src/routes/tags.js:74` — PUT /api/tags/:id and DELETE /api/tags/:id have zero callers — every tag-catalog UI only creates or applies/removes tags, never renames/deletes from the catalog.
12. `src/routes/whatsapp.js:2804` — GET /api/whatsapp/templates/:id/history has a fully-typed frontend client wrapper (`fetchTemplateHistory`) that is itself never called anywhere.
13. `src/routes/whatsapp.js:909` — GET /api/whatsapp/connection/diagnose has zero callers — superseded by /connection/health, /probe, /repair, all three of which ARE wired up.
14. `src/routes/whatsapp.js:2262` — GET/PUT /api/whatsapp/agent/availability has zero callers — no UI toggle for agent availability exists.
15. `src/routes/whatsapp.js:2292` — POST /api/whatsapp/inbox/auto-assign has zero callers — no bulk auto-assign button exists in Inbox.
16. `src/routes/whatsapp.js:2147` — PUT /api/whatsapp/contact/name has zero callers — no "rename this contact" control exists.
17. `src/routes/whatsapp.js:2402` — DELETE /api/whatsapp/inbox/canned/:id has zero callers — canned responses can be listed/created but never deleted from the UI.
18. `src/routes/metrics.js:534` (grouped) — PUT/DELETE /api/metrics/config/:metricKey, POST /bulk-entry, POST /pending/dismiss, POST /verify/:metricId, GET /my-team, POST /add-for-member all have zero frontend callers.
19. `src/routes/admin.js:676` (grouped) — GET/PUT /api/admin/crm/auto-assign has no settings UI. POST /api/admin/employees (create) has zero callers — employee creation actually goes through POST /api/auth/register instead. PUT /api/admin/metrics/:userId/:date/:metricType also has zero callers.

### Dead Code — Backend (11: 4 medium, 7 low)

**Medium:**
1. `src/utils/audit.js:44` — *duplicate-logic* — `getAuditLogs(userId, hoursBack)` has zero callers anywhere; `src/routes/audit.js` hand-rolls its own local `queryAuditLogs()` doing the same conceptual job independently, with additional company-scoping. `docs/bible/08_MODULES.md`'s dependency table is stale here (lists getAuditLogs as depended-on by many routes, but they all call `logAudit`, not `getAuditLogs`).
2. `src/services/ContactService.js:191` — *unused-export* — `updateContact()`, `softDeleteContact()`, `restoreContact()`, `listContacts()` are exported and test-covered but have zero production callers — the CONTACT# entity's CRUD surface is only half wired in; `src/routes/contacts.js` doesn't even import this service, operating on legacy LEAD#/INBOX# records instead.
3. `src/services/ConversationService.js:425` — *unused-export* — `listByCompany()` and `listByContact()` are unit-tested but have zero production callers, consistent with the CONV# entity layer having zero UI readers today.
4. `src/services/notifications.js:7` — *unused-export* — `sendPushNotification()` has zero callers anywhere — built (Expo push token support) but never wired into any route or service.

**Low:**
5. `src/services/PipelineService.js:24` — *duplicate-logic* — `getPipelineStages()`/`isValidStage()` and `CustomerIdentityService.js`'s own `_getPipelineStages()` both independently fetch the same CONFIG#PIPELINE record. Already documented/accepted in `docs/bible/08_MODULES.md:504` as a deliberately-unconsolidated duplicate — reporting per audit mandate, not a fresh regression.
6. `src/events/timeline.js:27` — *duplicate-logic* — `writeTlRecord()` hand-rolls the same idempotent-write idiom (`attribute_not_exists(SK)` + catch) that `src/utils/dedupPut.js`'s `dedupPut()` already provides. Already documented in `docs/bible/08_MODULES.md:618`.
7. `src/services/LeadScoringService.js:32` — *unused-export* — `INTENT_POINTS` is exported but used only internally; no external caller.
8. `src/services/CustomerIdentityService.js:203` — *unused-export* — `computeDelta()` is exported "for CSV enrich mode + unit tests" but is called only internally within `resolveOrCreate()`; no CSV/bulk-import route or test calls it directly.
9. `src/services/WorkingHoursService.js:16` — *unused-export* — `WEEKDAYS` is exported but never referenced externally; `WorkingHoursPanel.tsx` defines its own independent literal array instead.
10. `src/utils/featureFlags.js:38` — *unused-export* — `getFlags()`, `isEnabled()`, `DEFAULTS`, `_clearCache()` are fully built and unit-tested but have zero call sites in routes/services. Already documented as known/deliberate scaffolding-ahead-of-adoption in `docs/bible/08_MODULES.md:620`.
11. `src/utils/operationalMetrics.js:34` — *unused-export* — `emitMetric()` is exported and unit-tested but has zero consumers. Already documented in `docs/bible/08_MODULES.md:622` as known/deliberate.

### Dead Code — Frontend (28: 21 medium, 7 low)

**Medium:**
1. `dashboard/src/components/badges/BadgeCard.tsx:19` — zero importers; the whole `components/badges/` directory contains only this one file.
2. `dashboard/src/components/common/Skeleton.tsx:3` — exports `SkeletonLine`/`SkeletonCard`/`SkeletonRow`/`SkeletonConversation`; the live, actively-used file is the differently-pathed `components/v3/ui/Skeleton.tsx` — sole consumer of this legacy one is the dead `ContactHeader.tsx`. **(Queued for deletion after the Journey Bar port — tracked separately above, not yet safe per that entry.)**
3. `dashboard/src/components/common/UndoToast.tsx:12` — zero importers (verified, including a case-insensitive "undo" sweep to rule out an inline replacement).
4. `dashboard/src/components/common/EmptyState.tsx:8` — every real usage imports `@/components/v3/ui/EmptyState` instead; this legacy duplicate has zero importers.
5. `dashboard/src/components/contacts/ContactAvatar.tsx:34` — sole importer is the dead `ContactHeader.tsx`. **(Same Journey-Bar-port dependency as above.)**
6. `dashboard/src/components/contacts/HealthScoreBadge.tsx:20` — sole consumer is the dead `ContactHeader.tsx`.
7. `dashboard/src/components/contacts/CustomerJourneyBar.tsx:20` — sole consumer is the dead `ContactHeader.tsx`. **(This is the component with real, undocumented-elsewhere product functionality — see the port-before-delete entry above; do not delete.)**
8. `dashboard/src/components/contacts/ContactIdentityBlock.tsx:39` — sole consumer is the dead `ContactHeader.tsx`.
9. `dashboard/src/components/contacts/ContactMetaRow.tsx:40` — sole consumer is the dead `ContactHeader.tsx`.
10. `dashboard/src/components/contacts/ContactTabNav.tsx:12` — zero importers; `[contactId]/page.tsx` renders its own inline "frozen 7-tab list" instead.
11. `dashboard/src/components/dashboard/StatsCard.tsx:20` — zero importers; the whole `components/dashboard/` directory contains only this one file, an orphaned pre-v3 mini-feature.
12. `dashboard/src/components/ui/DataTable.tsx:13` — zero importers; legacy pre-v3 metrics export table, superseded by the actively-used `v3/ui/Table.tsx`.
13. `dashboard/src/components/ui/DateRangeFilter.tsx:9` — zero importers.
14. `dashboard/src/components/ui/ErrorMessage.tsx:7` — zero importers.
15. `dashboard/src/components/ui/Leaderboard.tsx:12` — zero importers; `analytics/page.tsx` has its own inline "Monthly Leaderboard" heading instead — same duplicate-then-orphan pattern seen elsewhere.
16. `dashboard/src/components/ui/SortableMetricCard.tsx:24` — `SortableMetricCard` (L24) and `DragOverlayCard` (L62), a full `@dnd-kit` drag-to-reorder feature, zero importers. Pairs with `hooks/useMetricOrder.ts` (also dead) — a whole feature was built and never wired in.
17. `dashboard/src/components/ui/MetricCard.tsx:31` — sole apparent importer (`SortableMetricCard.tsx`) is itself dead, making this transitively dead. A same-named local function in `MonthlyTeamProgress.tsx` is an unrelated local declaration, not an import.
18. `dashboard/src/components/v3/ui/ErrorState.tsx:12` — re-exported from the `v3/ui/index.ts` barrel, but nothing imports it from the barrel or directly.
19. `dashboard/src/hooks/useMetricOrder.ts:26` — `useMetricOrder(userId)` zero importers; pairs with the dead `SortableMetricCard.tsx`.
20. `dashboard/src/hooks/useMetrics.ts:11` — exports `useMyMetrics`, `useAllMetrics`, `useTeamSummary`, `useRoleScopedMetrics` — none imported anywhere else in dashboard/src (each checked individually).
21. `dashboard/src/app/(v3)/templates/page.tsx:11` — renders `TemplateDashboard`+`TemplateList` behind a tab toggle, but is unreachable from any nav (`V3Sidebar`/`V3BottomNav` don't reference `/templates`, no `Link`/`router.push` targets it) — templates functionality has been fully absorbed as a tab inside `app/(v3)/campaigns/page.tsx` instead.

**Low:**
22. `dashboard/src/components/charts/GaugeChart.tsx:11` — zero importers.
23. `dashboard/src/components/charts/TrendLineChart.tsx:10` — zero importers.
24. `dashboard/src/components/charts/MonthlyTeamProgress.tsx:195` — zero importers (has a locally-declared, non-imported `MetricCard` function at line 106 — a naming collision confirmed not to be a real import).
25. `dashboard/src/components/common/Loading.tsx:6` — zero real importers (name collides with the common literal text "Loading…", producing false-positive word-boundary hits on a naive grep).
26. `dashboard/src/hooks/useDebounce.ts:3` — `useDebounce<T>` zero importers (checked both `@/hooks/useDebounce` and relative `./useDebounce` forms).
27. `dashboard/src/hooks/useRealTime.ts:24` — `useRealTime(...)` zero importers.
28. `dashboard/src/hooks/useWebSocket.ts:9` — thin wrapper around `WebSocketContext.tsx`'s `useWsContext()`, zero importers. Note: `WebSocketProvider` itself IS live and does real work (mounted in root layout) — but its `useWsContext()` read-hook has no consumer either, since this dead hook was its only caller.

### Duplicate Business Logic & Architecture Debt (3: 3 medium, 0 low)

**Medium:**
1. `src/routes/tags.js:9` — *duplicate-business-logic* — Defines its own local `to10Digit(phone)` instead of importing the canonical one from `src/utils/phone.js` that every other module uses — a second, independently-maintained copy that can silently drift (e.g. if non-Indian-number support is ever added to the canonical one).
2. `src/routes/crm.js:397` — *duplicate-business-logic* — PUT /api/crm/leads/:id validates the raw, un-stripped `req.body` against `updateLeadSchema`'s exact-10-digit phone regex BEFORE the route's own ad-hoc digit-stripping runs (lines 415-416) — any caller submitting a formatted phone (+, spaces, dashes) fails validation immediately. Currently unreachable via the dashboard's own `useContactMutations.updateField` (no phone field in its type), so latent rather than actively firing — same reimplement-instead-of-reuse root cause as the already-fixed POST /leads finding.
3. `src/services/WhatsAppSendService.js:51` — *duplicate-business-logic* — `_toE164()` is a private, narrower reimplementation of the canonical `normalizeE164()` in `src/utils/phoneNormalize.js` (which handles WhatsApp JIDs, already-E.164 input, leading zeros, non-Indian numbers) — used across all 5 live send methods instead of the canonical one. A third, near-identical copy (`toE164()`) also exists at module scope in `src/routes/whatsapp.js` (lines 183-189) with zero call sites today. Three independent implementations of the same normalization.

---

**Not transcribed here (already fully known/actioned, not part of the "84"):** the 5 Critical and 16 High findings (all match fixes already shipped across Waves 1-3 of this session), and 13 Informational findings (mostly confirmed non-issues or already-documented deliberate exceptions — available in the same source file if needed later).

## _handoff()'s Send Failure Is Swallowed — False "true" on a Failed Handoff Message

**Issue:** `_handoff()`'s internal `WASendSvc.sendText()` call (sending `HANDOFF_MESSAGE` on escalation) is wrapped in its own `.catch((e) => logger.warn(...))` — if the escalation handoff message itself fails to send, `_runTurn()` still returns `true`, so the caller believes a handoff message went out when it didn't. Pre-existing since Era 22 (2026-07-06), adjacent to the maybeStart()/continueTurn() signal-contract bug fixed on 2026-07-08, not part of that fix — found while enumerating every path through `_runTurn()` for that fix, but deliberately left alone (a different failure mode: `WhatsAppSendService` failing, not `AIService.generate()`).

**Fix:** Needs its own deliberate fix if prioritized — likely surfacing `_handoff()`'s own send outcome back up through `_runTurn()`'s return value the same way the fixed `AIService.generate()` path now does.

**Priority:** Low — narrower window than the fixed bug (WhatsApp send failing specifically on an escalation-triggered handoff, a comparatively rare trigger path vs. every first-contact message), and no confirmed live incident yet.

## CONFIG#AI#{companyId} Has No Change-History / Audit Log

**Issue:** `CONFIG#AI#{companyId}` (AIService's master switch + per-useCase moduleToggles) is a plain `dynamodb.put()` overwrite (`src/routes/ai.js`) with no `logAudit()` call — there's no way to reconstruct what a company's AI master/module toggles were at any point in the past. Surfaced while investigating the 2026-07-08 ConversationalAgentService incident, where it was moot only because the company in question had zero WhatsApp traffic ever.

**Fix:** Would need a `logAudit()` call (or a small append-only history item) alongside the existing `dynamodb.put()` in `src/routes/ai.js`'s PUT /config route, matching how other admin-config changes in this codebase are already audited.

**Priority:** Low — worth adding audit logging if this question ever needs answering under less convenient circumstances (a company with real traffic and an ambiguous incident window).

## welcomeConfigSchema Doesn't Exempt Disabled Configs From Content Validation

**Issue:** `welcomeConfigSchema`'s `.superRefine()` (`src/utils/validation.js`) requires non-empty `buttons`+`bodyText` whenever `messageType` is `reply_buttons`, and non-empty `ctaButtons`+`bodyText` whenever `messageType` is `cta_buttons` — regardless of the record's `enabled` flag. Surfaced 2026-07-09 while fixing the Welcome Message/Working Hours toggle-visibility bug in `WelcomeMessagePanel.tsx`/`WorkingHoursPanel.tsx` (Save button was unreachable after toggling off; now fixed). So: an admin disabling Welcome Message while its `reply_buttons`/`cta_buttons` content is mid-edit-and-cleared (buttons removed, bodyText emptied, but not yet switched back to `messageType: 'template'`) still gets a 400 on save, even though the record being saved is `enabled: false` and would never actually be sent. Not caused by the toggle-visibility fix — pre-existing in the schema, just adjacent to it.

**Fix:** Not yet scoped. Likely fix is scoping the `.superRefine()` checks to only fire when `data.enabled` is true, so a disabled config can be saved in any partially-edited content state.

**Priority:** Low — narrow window (only hit while actively mid-editing button/CTA content and disabling in the same unsaved session), and the failure mode is a clear 400 with a validation message, not silent data loss.

## ~~stripStorageMetadata() Rollout Was Incomplete — whatsapp.js's Config Routes Missed~~ — FIXED 2026-07-09

**Issue:** The 2026-07-07 production incident (documented in `src/utils/validation.js`'s header comment) established that a `.strict()` Zod schema rejects DynamoDB's own storage/audit metadata (`PK`, `SK`, `companyId`, `updatedAt`, `updatedBy`) if a raw `dynamodb.get().Item` is ever handed straight to that schema — and fixed it via a `stripStorageMetadata()` helper, applied at the time to `aiAdmin.js` and `ConversationalAgentService.js` only. It was never swept to other files with the identical shape. Surfaced 2026-07-09: Viir toggled Working Hours off (right after the same-day toggle-visibility fix made that Save reachable for the first time — see the entry above) and got a live 400. Root cause: `whatsapp.js`'s `GET /hours-config`/`GET /ooo-config`/`GET /delayed-response-config`/`GET /welcome-config` all returned `result.Item` raw; `workingHoursConfigSchema`/`oooConfigSchema`/`delayedResponseConfigSchema` are all `.strict()`, so the frontend's round-tripped GET response 400'd on PUT with `unrecognized_keys: PK, SK, companyId, updatedAt`. Confirmed byte-for-byte against live API Gateway access logs (`responseLength: 199` on every failing request, matching the reconstructed Zod error exactly) and against real production DynamoDB data for `CONFIG#HOURS#viir_trading`/`CONFIG#OOO#viir_trading`. `welcomeConfigSchema` has the same raw-Item GET leak but is not `.strict()`, so it never 400'd — fixed anyway for consistency, since the leak itself (not just its `.strict()`-triggered symptom) is the real defect.

**Fix (2026-07-09):** All four GET routes in `whatsapp.js` now return `schema.parse(stripStorageMetadata(result.Item))` instead of `result.Item ?? {hardcoded defaults}` — same call-site shape as the existing `aiAdmin.js`/`ConversationalAgentService.js` precedent, reusing the schema's own `.default()`s instead of duplicating default objects inline. Validated against real production data (all 4 config shapes parse cleanly post-strip; a control run without the strip reproduces the exact live 400) and via 7 new Jest regression tests across `workingHoursConfig.test.js`, `delayedResponseConfig.test.js`, and `whatsappWelcomeButtons.test.js` (metadata-stripped assertions plus full GET→toggle-off→PUT→refresh round trips for hours-config and ooo-config specifically). Full suite: 1369/1369 passing.

**Deliberately not done — root-fix option considered and rejected:** also stripping known storage-metadata keys on the PUT side (defense-in-depth, so a payload with `PK`/`SK`/etc. would self-heal instead of 400ing) was considered and rejected in favor of GET-side-only. Reasoning: a `.strict()` PUT 400ing loudly on unexpected keys is a useful tripwire for exactly this bug class — it's what surfaced this incident and the 2026-07-07 one before it. Making PUT permissive would silently mask any *other*, still-undiscovered GET route with the same raw-Item leak (see below) instead of forcing it to surface and get fixed at its actual source; it would also only protect the round-trip-into-PUT symptom, leaving the underlying leak free to break any other future consumer of that same GET response in some other way.

**Repo-wide sweep — done 2026-07-09, CONFIRMED CLEAN of the round-trip class.** Method: (a) grepped every `.strict()` schema in `src/utils/validation.js` (the only file defining Zod schemas repo-wide, confirmed via grep for `require('zod')`) — 10 real top-level `.strict()` schemas beyond the 4 already fixed: `aiConfigSchema`, `aiAdminGeneralSchema`, `aiAdminConversationSchema`, `aiAdminFutureSchema`, `promptAddendumDraftSchema`, `knowledgeEntryDraftSchema`, `knowledgeDocumentMetaSchema`, `branchSchema`, `updateEmployeeSchema`, `updateLeadSchema`. (b) For each, traced its PUT/POST route(s) to the corresponding GET/list route and read the actual frontend consumer to see whether the PUT/POST body is ever constructed by spreading a fetched entity, or always built from explicit controlled-form fields. Result:
- `aiConfigSchema` (`ai.js` `GET /config`), `aiAdminGeneralSchema` (`aiAdmin.js` `GET /general`), `promptAddendumDraftSchema` (`aiAdmin.js` `GET /prompt-addendum`) — GET routes already cherry-pick individual fields into the response, never echo `result.Item` raw. No leak, no risk.
- `aiAdminConversationSchema`, `aiAdminFutureSchema` — already fixed in the original 2026-07-07 pass (`aiAdmin.js`/`ConversationalAgentService.js` both call `schema.parse(stripStorageMetadata(r.Item))`).
- `knowledgeEntryDraftSchema` (`knowledgeCenter.js`), `knowledgeDocumentMetaSchema` (`knowledgeDocuments.js`), `branchSchema` (`whatsapp.js` `/branches`) — GET/POST responses **do** leak raw items (PK/SK/companyId/updatedBy), but every frontend consumer (`KnowledgeEntryDrawer.tsx`, `documentsApi.ts`'s `uploadDocument`/`updateDocumentMeta`, `BranchesPanel.tsx`) explicitly cherry-picks fields into its own PUT/POST body — none ever spread a fetched entity. No 400 risk, but the leak itself is real — **fixed anyway** (`stripStorageMetadata()` applied to `knowledgeCenter.js`'s `GET /`/`POST /`, `knowledgeDocuments.js`'s `GET /`/`POST /`, `whatsapp.js`'s `GET /branches`/`POST /branches`/`PUT /branches/:branchId`), same reasoning as fixing `welcomeConfigSchema` even though it never errored. `KnowledgeEntry`'s frontend type had an unused `updatedAt` field removed to match (nothing read it). 7 new Jest tests added across `knowledgeCenter.test.js`/`knowledgeDocuments.test.js`/`branchesConfig.test.js`.
- `updateEmployeeSchema` (`admin.js`) — `GET /employees/:id` destructures out only the truly sensitive fields (`password`/`totpSecret`/`backupCodes`) and echoes the rest, including `companyId`/`createdAt`/`id` — a real minor leak, but a different table/pattern entirely (`DYNAMODB_TABLE_EMPLOYEES` uses a flat `id` primary key, no `PK`/`SK`/single-table design) and `companyId` is plausibly used elsewhere (superadmin cross-company views). `EditEmployeeModal.tsx` diffs field-by-field before PUTting (`changes.name = form.name` etc.), never spreads the fetched employee — no round-trip risk. **Not fixed** — lower confidence this needs the identical treatment, flagged for a separate look rather than guessed at.
- `updateLeadSchema` (`crm.js`) — `useContactMutations.ts`'s `updateField`/`updateCrm` both send explicitly-typed `Partial<{...}>` payloads, never a spread fetched lead. No round-trip risk from THIS bug class. **But found a different, real, currently-live bug while checking**: `CrmTab.tsx` lets an admin edit "Expected Value" and "Win Probability" and PUTs `{..., expectedValue, probability}` to `/api/crm/leads/:id` — but `updateLeadSchema` has no `expectedValue`/`probability` fields at all (only `name, phone, email, productInterest, source, notes, closureDeadline, tags`). Being `.strict()`, every attempt to save either field 400s unconditionally — not an edge case, the very first save always fails. Confirmed via `src/routes/crm.js` (schema fields vs. the `allowed` write-whitelist) and `CrmTab.tsx:242-249`. **Not fixed** — different bug class (missing schema fields, not a metadata leak), out of scope for this sweep, logged here since it was found as a byproduct.

`src/utils/validation.js`'s header comment updated to record the sweep's completion.

**Priority:** Low (fixed) for both the original whatsapp.js instance and the newly-fixed knowledge/documents/branches leaks. The `updateLeadSchema` `expectedValue`/`probability` gap is a separate, higher-priority item — see the dedicated entry below.

## updateLeadSchema Is Missing expectedValue/probability — CRM Tab's Save Always 400s

**Issue:** Found 2026-07-09 as a byproduct of the `.strict()`-schema repo-wide sweep (see the entry above), not part of that sweep's own scope. `CrmTab.tsx` (`dashboard/src/components/contacts/tabs/CrmTab.tsx:242-249`) lets an admin edit "Expected Value" and "Win Probability" and saves via `updateCrm.mutate({ ..., expectedValue, probability })`, which PUTs to `PUT /api/crm/leads/:id`. `updateLeadSchema` (`src/utils/validation.js`) is `.strict()` and only defines `name, phone, email, productInterest, source, notes, closureDeadline, tags` — no `expectedValue`/`probability` field exists anywhere in the schema. Confirmed via `crm.js`'s own `allowed` write-whitelist (line ~410), which also excludes both fields. Both fields ARE read back correctly elsewhere (`crm.js:1162-1163` reads `existing.expectedValue`/`existing.probability` for display), so something else can set them (CSV import, AI scoring, a different route not found in this pass) — but there is no working save path for a human editing them from this UI. Every attempt 400s with `unrecognized_keys`, unconditionally — not a second-save edge case like the other findings in this file, the very first attempt fails.

**Fix:** Not scoped. Add `expectedValue: z.number().min(0).nullable().optional()` and `probability: z.number().min(0).max(100).nullable().optional()` (or whatever the actual intended value ranges are — not confirmed from this pass) to `updateLeadSchema`, and add both to `crm.js`'s `allowed` whitelist so the write path actually persists them.

**Priority:** Medium — a visible, always-broken save control on a CRM tab in daily use, not a rare edge case. Higher priority than the metadata-leak findings in this file since it's a currently-live UI bug with no workaround, not a hygiene issue.
