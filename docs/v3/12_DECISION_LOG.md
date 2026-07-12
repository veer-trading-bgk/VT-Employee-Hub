# APForce V3 — Decision Log

**Status:** Living document — append new entries as decisions are made
**Date started:** 2026-06-29
**Version:** 3.0

---

## Format

Each entry follows this structure:

```
### [DL-NNN] Decision title
**Date:** YYYY-MM-DD
**Status:** Approved / Under Review / Superseded
**Decided by:** [role or person]

**Context:** What situation prompted this decision?
**Decision:** What was decided?
**Alternatives considered:** What else was evaluated?
**Rationale:** Why was this chosen over the alternatives?
**Consequences:** What does this decision mean going forward?
**Superseded by:** [DL-XXX] if this decision was later reversed
```

---

## Information Architecture Decisions

### [DL-001] Rename "Inbox" to "Communications"
**Date:** 2026-06-29
**Status:** Approved

**Context:** The WhatsApp inbox was named "Inbox" in V1 and V2. The module handles real-time WhatsApp conversations. Phase 3 must accommodate future channels (Instagram, email, SMS).

**Decision:** Rename the module to "Communications". Route changes from `/admin/whatsapp` to `/communications`. Old routes redirect.

**Alternatives considered:**
- Keep "Inbox" — rejected because "Inbox" is email vocabulary in a WhatsApp-first product, and the name locks the module to a single channel perception.
- "Messages" — rejected because Messages implies the content (individual messages), not the activity (managing conversations).
- "Chat" — rejected because Chat implies informality; this module handles business communication.

**Rationale:** "Communications" is channel-agnostic, professional, and accurately describes the module's job (managing all customer communications). It remains correct as Instagram, email, and other channels are added.

**Consequences:** URL migration required. All internal links must be updated. Old URLs must redirect. Documentation updated.

---

### [DL-002] Rename "Contact Hub" to "Customers"
**Date:** 2026-06-29
**Status:** Approved

**Context:** "Contact Hub" was the V2 name for the master contact list. The word "Hub" implies it is the centre of the product. The centre of APForce is Customer 360, not the list.

**Decision:** Rename to "Customers". Route changes from `/admin/contacts` to `/customers`.

**Alternatives considered:**
- "Contacts" — rejected because it is generic (every phone app uses "Contacts") and does not communicate the business purpose.
- "People" — rejected because it is too casual for a financial services product.
- "Contact Hub" — rejected because "Hub" misleads about the product hierarchy.
- "Database" — rejected because it describes the technology, not the business concept.

**Rationale:** "Customers" is the correct word for who these people are in the business context. An AP firm's contacts are their customers — not leads, not contacts, customers.

**Consequences:** URL migration. All internal links updated.

---

### [DL-003] Rename "CRM" to "Sales"
**Date:** 2026-06-29
**Status:** Approved

**Context:** The pipeline management module was called "CRM" in V2. "CRM" is a software category name (Customer Relationship Management), not a job to be done.

**Decision:** Rename to "Sales". Route changes from `/admin/crm` to `/sales`.

**Alternatives considered:**
- "Pipeline" — rejected because the module contains more than the kanban board (list view, follow-ups, import). "Pipeline" understates the module.
- "Deals" — rejected because in the Indian AP market, "deals" is not common vocabulary. Agents talk about "leads."
- "Leads" — rejected because the module manages pipeline management, not just lead records. The Customer 360 workspace is where individual leads are managed.
- Keep "CRM" — rejected because a first-time employee cannot derive the purpose from the acronym.

**Rationale:** "Sales" is the job title and job description of the people who use this module. Every employee understands what "Sales" means without explanation.

**Consequences:** URL migration.

---

### [DL-004] Customer 360 Is Not a Navigation Item
**Date:** 2026-06-29
**Status:** Approved

**Context:** User research and usage observation shows that agents navigate to Customer 360 from lists (Customers, Sales, Communications). There was a suggestion to add "Customer 360" as a sidebar item that opens the most recently viewed customer.

**Decision:** Customer 360 remains a workspace accessible only from a specific customer's record. It is not a sidebar navigation item.

**Alternatives considered:**
- "Recent Contact" sidebar item → opens last viewed Customer 360. Rejected because: (a) a stale default is confusing, (b) the agent has no guarantee the "last viewed" is relevant to their current task, (c) it creates an ambiguous navigation pattern.
- "Favourites" → pin specific customers for quick access. Noted for Phase 4+ consideration. Not implemented in Phase 3.

**Rationale:** A navigation item implies you can go there without context. Customer 360 requires a specific customer. The correct pattern is: find the customer first (via any list or search), then the workspace opens.

**Consequences:** Sidebar has 8 items maximum. Customer 360 is always opened from context, never from the sidebar. Global Search is the fastest path for "I know exactly who I want."

---

### [DL-005] Merge team_lead Role into manager
**Date:** 2026-06-29
**Status:** Superseded
**Superseded by:** [DL-021] — the merge described below was never implemented in backend authorization; `team_lead` remained a distinct, real `checkRole()` role throughout, and the split is now ratified as intentional rather than retroactively enforced. This entry is left unedited below for history — see DL-021 for the current, accurate state.

**Context:** V2 has 7 roles: superadmin, admin, manager, team_lead, agent, telecaller, intern. The `team_lead` role had nearly identical permissions to `manager` with a different home path.

**Decision:** Merge `team_lead` into `manager`. All existing `team_lead` users become `manager` users. The `manager` role now covers both team leads and managers.

**Alternatives considered:**
- Keep `team_lead` as a separate role — rejected because it adds a permission case to test for nearly zero functional difference. The business distinction (seniority) is an HR concept, not a product permission concept.

**Rationale:** Permission complexity should reflect real operational differences. Team leads and managers both oversee agents, both approve verifications, both review pipeline. The home page and analytics scope can be the same. If future differentiation is needed, a configurable permission flag is better than a whole new role.

**Consequences:** Role migration required for existing `team_lead` users. `Role` type updated. One less permission case to maintain.

---

### [DL-006] Merge agent, telecaller, intern into sales
**Date:** 2026-06-29
**Status:** Approved

**Context:** V2 has three roles for field sales people: `agent`, `telecaller`, and `intern`. All three performed the same job in APForce: managing leads and conversations. The differences (seniority, compensation) are HR concepts.

**Decision:** Merge all three into a single `sales` role. Agent-level, telecaller-level, and intern-level restrictions become configurable permission flags on the sales role rather than separate roles.

**Alternatives considered:**
- Keep all three — rejected because three roles for the same job is three times the testing surface and three times the confusion for admins setting up the product.
- `agent` and `intern` only (remove `telecaller`) — rejected because `telecaller` is still a real business role name in India. The business keeps the language; the product consolidates the permissions.

**Rationale:** Product permission roles should reflect what people can DO in the system, not their job title or salary. In APForce, all three roles do the same things. Custom permission flags can handle edge cases (e.g., "intern cannot delete contacts").

**Consequences:** Role migration. `Role` type updated. Admin UI gains a permission flag option on the sales role.

---

## Module Responsibility Decisions

### [DL-007] Communications Sidebar Is Read-Only for Contact Mutations
**Date:** 2026-06-29
**Status:** Approved

**Context:** The V2 LeadSidebar in the inbox allowed agents to change pipeline stage, manage tags, change assignee, and add quick notes. This created 3–4 mutation surfaces for the same data fields.

**Decision:** Remove pipeline stage mutation, tag management, and quick note from the Communications sidebar. The sidebar shows these fields as read-only. "Open in Customer 360 ↗" is the CTA for any mutation.

**The one exception kept:** Conversation assignee and chat status. These are conversation routing decisions (who handles this conversation, is it open or resolved) that belong in the conversation context.

**Alternatives considered:**
- Keep all sidebar mutations — rejected because this perpetuates the "4 places to change the same field" problem documented in the IA review.
- Remove sidebar entirely — rejected because agents need contact context (name, lifecycle, health) while in a conversation. A completely context-free chat pane is worse.

**Rationale:** The Communications sidebar is a context strip, not a mini CRM. Mutations belong in the workspace designed for mutations: Customer 360.

**Consequences:** Agents who relied on sidebar stage changes must use Customer 360. Mitigated by: (1) "Open in Customer 360 ↗" links to `?tab=crm` directly, (2) one extra click is acceptable for a mutation that should be considered rather than casual.

---

### [DL-008] Customers Module Is Read-Only
**Date:** 2026-06-29
**Status:** Approved

**Context:** The V2 Contact Hub allowed inline stage changes via dropdown and inline tag management via floating selector. This is a second mutation surface for the same fields that Customer 360 owns.

**Decision:** The Customers module is read-only. Stage and tags are displayed as non-interactive badges. Clicking a row navigates to Customer 360 for all mutations.

**Alternatives considered:**
- Keep inline stage changes — rejected because it creates a fourth stage mutation surface (Inbox sidebar, Customers, Sales kanban, Customer 360).
- Keep inline tag management — rejected because same reason. Tag management should have one home.

**Rationale:** Dashboards observe; workspaces operate. The Customers module is a dashboard (browse and navigate). Customer 360 is the workspace (operate and mutate). The roles should not overlap.

**Consequences:** Agents who want to quickly change a stage or tag on multiple contacts must open Customer 360 for each one. This is acceptable — bulk operations (bulk tag, bulk stage) will be available as a separate bulk-action flow in the Customers module in Phase 3.

---

### [DL-009] Sales Kanban Drag-Drop Is the Sole External Stage Mutation
**Date:** 2026-06-29
**Status:** Approved

**Context:** Given DL-007 and DL-008 removed stage mutations from Communications and Customers, the only remaining external stage mutation (outside Customer 360) is the Sales kanban drag-drop.

**Decision:** Kanban drag-drop stays as a stage mutation. It is explicitly sanctioned as the one exception to the "Customer 360 owns mutations" rule.

**Rationale:** Kanban drag-drop is a *pipeline management operation* — a manager or senior agent moving multiple deals at once based on a pipeline review, not a detailed assessment of one customer. It serves a different workflow than the Customer 360 CRM tab mutation (which is done while reviewing the full customer context). Both are valid; the contexts are different.

**Consequences:** The stage field has two write surfaces: Customer 360 CRM tab (individual contact context) and Sales kanban drag-drop (pipeline management context). Both update the same field via the same API. This exception is documented and intentional.

---

## Data Model Decisions

### [DL-010] Explicit lifecycleStage Field Instead of Inferred
**Date:** 2026-06-29
**Status:** Approved

**Context:** V2 infers the lifecycle stage from pipeline stage and other signals via `journeyInference.ts`. This creates ambiguity when admins customize pipeline stage names.

**Decision:** Add an explicit `lifecycleStage` field to every contact record. The inferred value is used only as a fallback for contacts created before V3.

**Alternatives considered:**
- Keep inference — rejected because: (a) inference breaks when stage names are customized, (b) cannot be queried directly in DynamoDB (requires client-side derivation), (c) cannot fire automation triggers on lifecycle change (no event to trigger on), (d) cannot be audited (no history of when it changed).

**Rationale:** Explicit is better than implicit. Financial services require audit trails. Lifecycle is a business fact, not a derived property.

**Consequences:** Migration: existing contacts get `lifecycleStage` derived from inference logic on first V3 load. New contacts created after V3 deployment get explicit `lifecycleStage` on creation. The `journeyInference.ts` logic is preserved as the migration source of truth.

---

### [DL-011] lifecycleHistory as an Append-Only Audit Log
**Date:** 2026-06-29
**Status:** Approved

**Context:** In financial services, changes to customer classification (e.g., who is a Customer vs an Investor) may have regulatory implications. There must be an audit trail.

**Decision:** Every lifecycle stage change is recorded in `lifecycleHistory` on the contact record and as a Timeline event. `lifecycleHistory` is append-only — entries are never deleted.

**Alternatives considered:**
- Rely on Timeline events only — rejected because Timeline events are query-heavy (requires scanning all events for a contact to find lifecycle changes). The `lifecycleHistory` field on the record enables O(1) lookup.

**Rationale:** Data integrity in financial services is non-negotiable. The cost (slightly larger DynamoDB record) is trivial compared to the risk of losing audit data.

---

## Architecture Decisions

### [DL-012] Customer360Provider Remains the Single Data Owner
**Date:** 2026-06-29
**Status:** Approved

**Context:** V3 adds new fields (expected deal value, win probability, lifecycle stage) to Customer 360. There was a question of whether these new fields should be fetched in their own hooks or added to the existing provider.

**Decision:** All Customer 360 data continues to flow through `Customer360Provider`. New fields are added to the existing queries. No new providers are introduced inside Customer 360.

**Alternatives considered:**
- New `DealProvider` for deal value/probability — rejected because it introduces a second provider inside the same workspace, splitting data ownership.

**Rationale:** The Customer360Provider pattern has proven itself in V2. A single data owner makes the data flow predictable and makes query deduplication automatic (React Query cache).

**Consequences:** `Customer360ContextValue` grows in V3. The interface must be documented. New fields are added to existing queries, not new queries.

---

### [DL-013] Home Page Uses Parallel Independent Widget Queries
**Date:** 2026-06-29
**Status:** Approved

**Context:** The Home page requires data from multiple API endpoints (tasks, conversations, pipeline, metrics). A sequential loading approach would make the page slow.

**Decision:** All Home page widgets load in parallel via independent React Query calls. Each widget has its own loading and error state. Widget failure is isolated — one failed widget does not break the page.

**Alternatives considered:**
- Single "dashboard summary" API that returns all data — rejected because: (a) changes to one widget's data require a backend change to the summary endpoint, (b) the endpoint cannot be cached per-widget (different stale times), (c) a failure of any data fetch fails the entire home page.

**Rationale:** Independence through parallelism. Each widget is a self-contained unit. The home page is resilient to partial failures.

**Consequences:** Multiple API calls on home page load. Acceptable because they are parallel. Total load time ≈ slowest single API call, not sum of all calls.

---

### [DL-014] Communications Channel Model Is Additive
**Date:** 2026-06-29
**Status:** Approved

**Context:** V3 builds Communications with WhatsApp only. Future channels (Instagram, email, SMS, voice) must be addable without restructuring the module.

**Decision:** The `channel` field on Conversation and Message records is a string enum: `'whatsapp' | 'instagram' | 'facebook' | 'email' | 'sms' | 'voice'`. All channel-specific fields are namespaced extensions on the base record. The conversation list, chat pane, and Customer 360 Conversation tab all filter by channel as a data attribute, not as a structural variant.

**Alternatives considered:**
- Separate modules per channel (WhatsApp module, Instagram module) — rejected because it creates N fragmented experiences instead of one unified Communications module.
- Channel-specific data models — rejected because it requires structural changes to add each new channel.

**Rationale:** Additive channel model means new channels are data configurations, not structural rewrites. The UI gains a new filter option; the data model gains a new enum value; the Lambda gains a new webhook handler. No existing code is restructured.

**Consequences:** Channel field must be present on every Conversation and Message from the start. WhatsApp conversations created in V2 must have `channel: 'whatsapp'` set (migration or inference).

---

### [DL-015] Health Score Is Client-Side and Rule-Based in V3
**Date:** 2026-06-29
**Status:** Approved

**Context:** `HealthScoreBadge` has `aiEnabled={false}` in V2. V3 must improve the health score. The question is whether to use a server-side ML model or a client-side deterministic algorithm.

**Decision:** V3 health score is calculated client-side using a deterministic weighted algorithm with 6 named signals. AI-enhanced health scoring is explicitly deferred to Phase 4.

**Alternatives considered:**
- Server-side ML model (Phase 3) — rejected because: (a) requires ML infrastructure not yet built, (b) health score must be explainable to agents (regulatory preference), (c) black-box scores reduce agent trust.
- Keep the static number from V2 — rejected because the static number provides no actionable insight (why is it this number?).

**Rationale:** A deterministic, named-signal algorithm is explainable, testable, and fast. Every agent can understand why the score is what it is. When ML is ready in Phase 4, it is added as an additional signal in the same algorithm, not a replacement.

**Consequences:** Health score algorithm is pure TypeScript, no API calls. It updates instantly when contact data changes. The algorithm is documented in `src/lib/contacts/healthScore.ts`.

---

### [DL-016] Next Best Action Is Rule-Based in V3 (No AI)
**Date:** 2026-06-29
**Status:** Approved

**Context:** The ActivityPanel in V2 has a placeholder for "next action." V3 implements this as the "Next Best Action" header button.

**Decision:** V3 Next Best Action is a deterministic rule engine with ~10 named rules, evaluated client-side against the contact record. AI-enhanced suggestions are Phase 4.

**Rationale:** Same reasoning as DL-015. Explainability is critical in financial services. Agents must be able to understand and trust suggestions. A named rule ("24h window expiring in 2h → send a message") is more trustworthy than a black-box prediction.

**Consequences:** Rules are defined in `src/lib/contacts/nextBestAction.ts`. New rules can be added as named constants. The function returns `{ label, tabHref, priority }` for display.

---

### [DL-022] Automation Module: Remove the Linear "Simple" Editor — Canvas Is the Only Editor
**Date:** 2026-07-10
**Status:** Approved
**Decided by:** Viir (via re-verified, corrected scope — see Rationale)

**Context:** The Automation module shipped with two workflow editors: a linear step-sequence
"Simple" editor (`WorkflowCreateDrawer.tsx`/`WorkflowBuilder.tsx`, `steps[]`-shaped data) and a
newer branching graph canvas (`nodes[]`/`edges[]`-shaped, supports if/else condition nodes, button-
reply branching, per-button handles). Maintaining two editors and two underlying data shapes for
the same conceptual object (a workflow) is duplicate surface area with no product reason for a user
to prefer the older, strictly-less-capable one.

**Decision:** Delete the linear "Simple" editor entirely. `WorkflowCreateDrawer.tsx` is removed;
"Create Workflow" navigates straight to `/automation/canvas/new`; every existing workflow (linear
or graph) opens in the canvas — `WorkflowList`'s `openEdit()` no longer branches on
`isGraphWorkflow`, because after this change every workflow *is* graph-shaped. A one-time converter
(`convertLinearToGraph()`) migrated the one real linear workflow that existed in production
(`assign_employee`+`end`, `viir_trading`) rather than the app carrying a permanent dual-shape
runtime path.

**Alternatives considered:**
- Keep both editors, let users choose — rejected because it doubles the testing/maintenance surface
  for a strictly-dominated option (everything the linear editor can express, the canvas can express
  plus branching), and the "which editor should I use" choice itself is confusing with no clear
  answer.
- Migrate the data shape but keep the linear UI as a "simple mode" view over graph data — rejected
  as unnecessary complexity: no product request was driving keeping a simplified view, and it would
  mean maintaining two renderers for one data shape indefinitely.

**Rationale:** An incoming audit initially proposed a larger, riskier version of this change
(claiming a sanitizer bug and a missing canvas node that, on direct re-verification against the
actual codebase and a live DynamoDB scan, did not exist — see `docs/bible/19_DECISION_LOG.md` Era
44 and its "Open architectural questions" item 19 for the full incorrect-premise/correction
detail). Re-scoping down to what the codebase and real data actually showed — exactly one real
linear workflow, losslessly convertible — made this a small, low-risk migration rather than the
larger one originally proposed. Verified the conversion was lossless via a field-by-field diff
through the real POST/PUT/GET handlers against real AWS before deleting anything.

**Consequences:** `WorkflowStep`/linear-specific types and their UI (`StepCard`, `Connector`,
`stepSummary`) are dead code and were removed alongside the drawer, not left as unused scaffolding.
Any future workflow creation path (if one is ever added outside the canvas UI) must produce
`nodes[]`/`edges[]` directly — there is no longer a linear shape to fall back to or convert from at
runtime, only the one-time migration script (kept for historical/reference purposes, not part of
the live app).

**Superseded by:** —

---

## Rejected Features

### [DL-017] "Customer 360" Sidebar Navigation Item — Rejected
**Date:** 2026-06-29
**Status:** Approved (rejection)

**Context:** See DL-004. Repeated here for completeness.

**Decision:** Do not add Customer 360 to the sidebar navigation.

**Rejected.**

---

### [DL-018] Inline Stage Edit in Communications Sidebar — Rejected
**Date:** 2026-06-29
**Status:** Approved (rejection)

**Context:** See DL-007. The V2 stage dropdown in the LeadSidebar is removed in V3.

**Decision:** Sidebar shows read-only stage pill. Pipeline stage is edited in Customer 360 CRM tab only (plus kanban drag-drop).

**Rejected.**

---

### [DL-019] Inline Tag Editor in Customers Module — Rejected
**Date:** 2026-06-29
**Status:** Approved (rejection)

**Context:** See DL-008. The V2 floating tag selector in the Contact Hub is removed in V3.

**Decision:** Customers module shows read-only tag chips. Tags are managed in Customer 360 Profile tab only.

**Rejected.**

---

### [DL-020] Campaign Broadcasts as a Phase 3 Feature
**Date:** 2026-06-29
**Status:** Deferred to Phase 4

**Context:** The ability to send a message to a filtered segment of contacts (e.g., "all Investors with MF interest who haven't been contacted in 30 days") is a high-value feature for AP firms.

**Decision:** Campaigns are explicitly out of scope for Phase 3. The Customers module's filter and bulk-selection UI is being built in Phase 3 in a way that accommodates a future "Send Campaign" bulk action. The `data-slot` reservation pattern in Customer 360 Timeline accommodates campaign events.

**Rationale:** Campaigns require WhatsApp template approval workflows, sending rate limits, opt-out management, and analytics. Building this correctly in Phase 3 would add 30+ days to delivery. It is better to ship a great Phase 3 without Campaigns than a compromised Phase 3 with a rushed Campaigns feature.

**Consequences:** Phase 4 planning document must include Campaigns as a first-class item. The Automation module's "Sequences" feature in Phase 3 covers individual customer sequences (not bulk broadcasts), which partially satisfies the use case.

---

### [DL-021] team_lead/manager Split Ratified as Intentional — Supersedes DL-005
**Date:** 2026-07-09
**Status:** Approved
**Decided by:** Viir

**Context:** DL-005 (and the frozen `09_PERMISSION_MATRIX.md`, built on top of it) documented a decision to merge `team_lead` into `manager` — one role, same permissions. That merge was never implemented in backend authorization. Verified directly against the code, not assumed: `team_lead` remains a real, distinct value throughout `Role`/`checkRole()`/`updateEmployeeSchema` (`src/utils/validation.js:177,199`), and the backend enforces a genuinely different, narrower scope for it than for `manager` — not just a cosmetic difference:
- `manager` has broad, company-wide access across four modules: `attendance.js` (leave admin, all attendance records), `compensation.js` (payroll, adjustments — view), `crm.js` (lead creation/assign/restore/import, stats, analytics), and most of `metrics.js`'s admin-facing routes (`team-summary`, `bulk-entry`, `pending`, `verify`, `pending/dismiss`). Confirmed via `resolveTargetUserId()` (`metrics.js:64-100`): a `manager` can act on/view any employee's metrics company-wide, no team-membership check.
- `team_lead` has access to a narrow, metrics/points-only surface — `metrics.js`'s `performers`, `my-team` (team_lead-*exclusive*, manager cannot call it), and `add-for-member`; `points.js`'s `award`. It has **zero** access anywhere in `attendance.js`, `compensation.js`, or `crm.js` — not even reduced to team scope, simply absent from every `checkRole()` list in those three files. Where it does have access, it's explicitly team-restricted: `resolveTargetUserId()`/`add-for-member` both reject a target employee whose `teamLeadId !== req.user.id` with a 403 (`metrics.js:95`, `metrics.js:1041`) — `manager` has no such check.

The only place any merge actually happened is the frontend *display* layer: `toV3Role()` (`dashboard/src/types/v3.ts:7-18`) maps both raw `manager` and raw `team_lead` to the single V3 UI bucket `'manager'`. This is presentation only — it never touched backend authorization, and conflating it with a real permission merge is what let DL-005's claim go unnoticed as inaccurate for this long.

**Decision:** Keep the code as-is. The `manager`/`team_lead` split is ratified as **intentional, current product behavior** — a real feature (team-scoped delegation for SMB sales teams: a team lead can enter metrics and manage sign-offs for their own small team without the company-wide reach a manager has), not accidental drift from an unfinished migration. The docs were wrong, not the code. No code changes accompany this decision.

**Alternatives considered:**
- Actually implement the DL-005 merge now (collapse `team_lead` into `manager` in the backend, matching the docs) — rejected. That would be a real permission *reduction* for existing `team_lead` users (losing nothing, since `team_lead` is already a subset-plus-team-restriction of `manager`'s reach) or a permission *expansion* (if migrated the other direction) with no product request driving it, months after the fact, and would require a live user-role migration for a change nobody asked for.
- Leave DL-005 and `09_PERMISSION_MATRIX.md` as the source of truth and treat the backend split as a bug to fix — rejected. The split correctly serves a real need (team-scoped delegation) that a fully-merged company-wide `manager` role can't express, and multiple modules were deliberately built to enforce it (the `teamLeadId` checks aren't accidental — they're commented as intentional restrictions at each call site).

**Rationale:** The backend behavior is more correct than the plan that preceded it. `team_lead` as team-scoped and `manager` as company-wide is a real, useful permission distinction for a multi-team sales org, and it already works and is already tested. Rewriting the backend to match a two-week-old planning doc, when the doc's own premise ("95% identical permissions") doesn't hold, would be change for the sake of matching paper rather than for the sake of the product.

**Consequences:**
- `09_PERMISSION_MATRIX.md`'s "Manager" column/row descriptions reflect `team_lead`-shaped (team-scoped) behavior more closely than raw `manager`'s actual (company-wide) reach in several capabilities — annotated in that document rather than rewritten wholesale (its own format is frozen; see the document's own note pointing here and at the code).
- `06_ROLE_BASED_EXPERIENCE.md`'s V2→V3 role migration table and "Why merge team_lead into manager" section are corrected to state the real, current backend behavior.
- `11_PHASE3_IMPLEMENTATION_PLAN.md` and `ARCHITECTURE_AUDIT.md`'s `team_lead → manager` implementation-plan line items are annotated as never executed and no longer planned, rather than left implying it's still pending work.
- `toV3Role()`'s manager/team_lead → `'manager'` display collapse stays as-is (harmless for navigation/sidebar rendering) — but per this session's Wave 2 RBAC findings, it must never be used as, or mistaken for, a permission gate. Only raw roles (`req.user.role` server-side, the raw `role` field client-side) may gate an action; `v3Role`/display buckets are for UI grouping only.

---

## Open Questions (Unresolved as of 2026-06-29)

| # | Question | Context | Status |
|---|---|---|---|
| OQ-001 | Should `owner` be a role that replaces the first `admin` on account creation, or is it a separate role that must be explicitly assigned? | V3 role model | Open |
| OQ-002 | Should the Sales > Pipeline board show all agents' leads by default for a sales agent, or only their own? | Role-filtered pipeline | Open |
| OQ-003 | How many days of inactivity triggers the "Dormant" flag? Should it be configurable per lifecycle stage? | Lifecycle model | Open |
| OQ-004 | Should the Customers > Import flow handle deduplication automatically (phone number match) or prompt the agent for each duplicate? | Import workflow | Open |
| OQ-005 | Is the Relationship Score feature (DL-??? — new in this doc) worth implementing in Phase 3, or defer to Phase 4? | C360 header enhancement | Open |
| OQ-006 | Should `team_lead`'s Contacts-module scope be **own-only** (current actual behavior, undocumented) or **team-wide** (as `09_PERMISSION_MATRIX.md` currently documents — "sees Team contacts," "can export team contacts")? Found 2026-07-09, still open as of 2026-07-12. Not the same finding as DL-021 (which resolved `team_lead` vs `manager` scope in `attendance.js`/`compensation.js`/`crm.js`/`metrics.js`) — this is `contacts.js` specifically, a different route with its own binary `isAdmin ? all : own-only` check and no team tier at all. | Contacts module RBAC | Open — awaiting Viir's product call; tracked in `docs/PENDING_WORK.md` |

**Note on DL-021 (team_lead/manager split):** DL-021 above resolved `team_lead`'s scope for
`attendance.js`/`compensation.js`/`crm.js`/`metrics.js`. It did **not** cover `contacts.js` — that
file's `team_lead` scoping is the separate, still-open OQ-006 immediately above. Do not read DL-021
as having settled Contacts-module behavior; it hasn't.

---

*This log is a living document. Every significant architectural decision made during Phase 3 implementation must be recorded here with the standard format above. Decisions that are reversed must be marked "Superseded by [DL-XXX]" and a new entry created for the superseding decision.*
