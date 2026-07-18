# 19 — Decision Log

Status: verified against repo state 2026-07-02 (commit `50771ba`, branch `main`). Extended with a
new Era 44 on 2026-07-12 covering 2026-07-09 through 2026-07-12 (this file is a running
chronological log, appended to incrementally — Eras 8 through 43 were already added in earlier
sessions between the original 2026-07-02 verification and this pass; treat each Era's own cited
date/commit as the accurate verification point for that entry, not the file-level Status line
above).

This is a chronological institutional-memory log of the major architectural and product
decisions behind APForce (repo: VT-Employee-Hub / vt-employee-bot). It exists so a new
engineer — or an AI acting on this codebase — can understand **why** the code looks the
way it does, not just what it currently does.

Sources for every entry are cited. Where a statement is inferred rather than quoted
directly from a commit message, ADR, or CLAUDE.md, that is called out explicitly.

Two separate decision-record systems exist in this repo and are both covered here:

- `docs/adr/ADR-012` through `ADR-014` — backend/platform ADRs, numbered independently,
  enforced via root `CLAUDE.md`.
- `docs/phase2/DESIGN_DECISIONS.md` — a **separately numbered** `ADR-001`–`ADR-011` series
  covering Phase 2 Customer 360 *frontend* decisions. Do not confuse the two numbering
  systems — "ADR-001" in this repo is a Phase 2 frontend doc, not the first backend ADR.

All dates and commit hashes below were verified with `git log`/`git show` against this
repo, not taken from paraphrase.

---

## Era 1 — V2: CRM, WhatsApp, and the APForce rebrand (2026-06-18 to 2026-06-27)

### 2026-06-18 — Repo pivots from Telegram bot to web dashboard

The repo's earliest commits in this history remove Telegram bot functionality
(`341c353`, "remove: telegram bot functionality") and add a Next.js dashboard frontend
(`4decc7b`, "add: dashboard Next.js frontend") on the same day. This is the starting
point of the product as it exists today — an employee performance/metrics tracker with
role-based dashboards (admin, manager, team_lead, agent, intern), before CRM or WhatsApp
existed.
**Status:** superseded (foundation only; the metrics/attendance/payroll product survives
as the "Team" module, see Era 1 continuation below).
**Reference:** commits `341c353`, `4decc7b`.

### 2026-06-19 to 2026-06-20 — Metrics/performance product hardens

A dense run of commits builds out the original employee-metrics product: PMS/Pro
Insight/LTPP metrics, config-driven metric targets, leaderboard, monthly progress,
self-correction of daily entries, and admin/employee dashboard UX passes. This is
pre-CRM, pre-WhatsApp APForce — a sales-team performance tracker.
**Status:** shipped; still present as the Team/Performance module.
**Reference:** commits `9417474` … `68a0462` (2026-06-19 to 2026-06-20 range).

### 2026-06-21 — Multi-tenancy foundation + APForce branding

`bf26da7` ("feat: multi-tenancy foundation + APForce signup + onboarding + billing")
converts the single-company employee tool into a multi-tenant SaaS with its own
signup/onboarding/billing flow, under the APForce brand. This is the point the product
becomes a sellable SaaS rather than an internal tool. A string of same-day CORS
firefighting commits (`7bc69b7` … `7f26934`) reflects the immediate production pain of
opening the API to `app.apforce.in`.
**Status:** shipped, foundational — every later module builds on this tenancy model.
**Reference:** commit `bf26da7`.

### 2026-06-22 — CRM module + Meta WhatsApp Cloud API integration

`727ab1c`... actually the CRM/WhatsApp introduction commit is `727c47e` ("feat: CRM
module + Meta WhatsApp Cloud API integration"), followed same-day by CRM v2 (custom
pipeline, lead assignment, tags, deadlines, Meta Embedded Signup — `2e8bcf3`), kanban
drag-and-drop + manual WABA connect (`c309519`), and a first WhatsApp inbox with CRM
stage control (`fce32e4`). This is the point APForce becomes a WhatsApp-first CRM, which
is the product's current core identity.
**Status:** shipped; this CRM/WhatsApp pairing is the backbone every subsequent era
(Phase 2, V3, Campaigns, Automation) extends.
**Reference:** commits `727c47e`, `2e8bcf3`, `c309519`, `fce32e4` (2026-06-22).

### 2026-06-23 to 2026-06-27 — CRM/Inbox/Contact Hub scale-out (pre-Phase-2)

A long sequence of feature and hardening commits: lead auto-assign with capacity rules
(`2c2008`/`718a748`), superadmin platform panel (`73921ba`, `adc9407`), Metric Settings
admin UI, multi-tenant onboarding fixes, inbound/outbound media (S3 presigned upload,
image/video lightbox), a first "Contact Hub" (`f2f66bf`, 2026-06-26) as a unified contact
list distinct from CRM leads and WhatsApp inbox, global tag system, and a first backend
hardening pass (Zod validation, rate limiting, message pagination, async automations —
`bb8a49a`, 2026-06-27). This era is where the **lead vs. contact duality** that Phase 2
later resolves is created: a WhatsApp message from a new number creates an
`INBOX#`/contact record; a sales agent creating a prospect creates a `LEAD#` record; the
two are not explicitly linked yet.
**Status:** superseded by Phase 2 Customer 360 (contact becomes canonical), see below.
Some pieces (tag system, S3 media pipeline, rate limiting) persist unchanged into the
current codebase.
**Reference:** commits `2c2761a`, `bb8a49a`, `2a6e8d3`, `dd4abe9`, `f2f66bf`, `a7b7ae1`
(2026-06-23 to 2026-06-27); phone-normalization bug fix `ccdc797` (2026-06-23,
"normalize phone format for lead matching and INBOX routing") is an early, narrower
predecessor of the `phoneNorm` rule later formalized in Phase 2 ADR-011 and backend
ADR-013.

---

## Era 2 — Pre-Phase-2 platform hardening: WebSockets, entities, CRM Foundation (2026-06-26 to 2026-06-28)

### 2026-06-28 — Real-time WebSocket layer replaces polling

`4ce7295` ("feat: WebSocket Phase 1 — backend handlers, notify utility, WS tests") and
`9e1f389` ("feat: WebSocket Phase 2 — frontend client, context, hooks, token auth") add
a WebSocket push layer to replace the Inbox's polling-based message refresh. A long
same-day sequence of env-var/CORS/cache-busting commits (`0ece3b0` … `3719a5c`) reflects
real Vercel/Lambda deployment friction getting `NEXT_PUBLIC_WS_URL` to production
correctly. By end of day, optimistic sends and `setQueryData`-based zero-round-trip
message delivery are working (`8742515`, `8c09034`).
**Status:** shipped; this is the real-time transport every later Inbox/Conversation-tab
feature depends on.
**Reference:** commits `4ce7295`, `9e1f389`, `8742515`, `8c09034` (2026-06-28).

### 2026-06-28 — Core identity entities and event infrastructure (pre-CIS)

Same day, a separate thread of commits lays groundwork later consumed by Phase 2 and by
backend ADR-013: `f5bf7ad` ("feat(core): ULID identity layer — id, entityKeys,
systemMeta, phoneNormalize"), `0cbc800` ("feat(contact): Contact entity — repository,
service, phone dedup, GSI migration"), `e93bf1f` ("feat(conversation): Conversation
entity — repository, service, status management"), `34fba91` (wires a
`conversationResolver` into the WhatsApp webhook, fire-and-forget), and `c7b0f1e`
("feat(events): add publishEvent() abstraction — Phase 1 event infrastructure"). This is
where the E.164-based `ContactService`/`CONTACT#` entity (later referenced in ADR-013 as
a second, non-canonical identity graph) is introduced.
**Status:** shipped, but its `ContactService`/E.164 identity model is explicitly
subordinated to `LEAD#`/10-digit `phoneNorm` identity by ADR-013 (see Era 4). Not
removed — kept as "a richer identity graph for future CRM features" per ADR-013 text.
**Reference:** commits `f5bf7ad`, `0cbc800`, `e93bf1f`, `34fba91`, `c7b0f1e`
(2026-06-28).

### 2026-06-28 — CRM Foundation: Lead→Contact linkage

`ba104ad` ("feat(crm): CRM Foundation — Lead→Contact linkage, reserve 11 future-ready
fields") is, per its commit message, the explicit bridge between the old `LEAD#`-only
CRM and the new `Contact` entity — the direct predecessor of Phase 2's "Contact is the
canonical entity" decision (Phase 2 ADR-001, see Era 3).
**Status:** shipped; superseded in spirit by Phase 2 Customer 360, which is the full
realization of this linkage at the UI layer.
**Reference:** commit `ba104ad` (2026-06-28).

### 2026-06-28 — Production hardening pass: feature flags, EMF metrics, WS state machine

`2b890cf` ("feat(prod): production hardening — feature flags, EMF metrics, WS state
machine, docs") is a named checkpoint commit bundling a feature-flag system (later used
by Phase 2's `ai_insights` flag per `docs/phase2/DESIGN_DECISIONS.md` ADR-006),
CloudWatch EMF metrics, and a formalized WebSocket connection state machine.
**Status:** shipped; feature-flag mechanism is reused by every subsequent module
(Campaigns, Automation) to gate rollout.
**Reference:** commit `2b890cf` (2026-06-28).

---

## Era 3 — Phase 2: Customer 360 (2026-06-29)

This entire era ships in a single calendar day (2026-06-29) as a pre-planned 13-commit
sequence. `f31bcb9` ("docs: add Phase 2 Customer 360 architecture documentation") lands
first, establishing `docs/phase2/CUSTOMER_360_ARCHITECTURE.md` and
`docs/phase2/IMPLEMENTATION_PLAN.md` as, per root `dashboard/CLAUDE.md`, "the
authoritative references for Phase 2 scope and architecture" under a
Documentation-as-Contract rule: if implementation discovers a document is wrong, the
document is updated in the same commit, so code and docs never diverge.

### Product decision: Contact is the canonical customer entity

Recorded as Phase 2 `ADR-001` in `docs/phase2/DESIGN_DECISIONS.md` (not to be confused
with backend `ADR-012`+). **Decision:** a `Contact` is the single canonical entity
representing a customer; it may exist as a CRM lead, an inbox-only WhatsApp contact, or
both. **Why:** pre-Phase-2, a WhatsApp message created an inbox contact and a sales
agent created a separate CRM lead for the same person with no explicit link — agents
had to manage two records and lost context switching between them. **Consequences:**
Contact Hub becomes the entry point; CRM Pipeline and Inbox become filtered views over
the same contact data, not separate entities.
**Status:** shipped, foundational; this is the model the rest of Phase 2 (and later
Campaigns/Automation targeting) is built on.
**Reference:** `docs/phase2/DESIGN_DECISIONS.md` ADR-001.

### Product decision: one detail page per customer

Phase 2 `ADR-002`. **Decision:** `/admin/contacts/[id]` (Customer 360) is the only
customer detail page; the old `/admin/crm/[id]` CRM Lead Detail page (with its own chat
tab on 15-second polling) is redirected and eventually removed. **Why:** two detail
pages for the same customer were guaranteed to diverge — features and bug fixes applied
to one and not the other.
**Status:** shipped. `/admin/crm/[id]` redirects to `/admin/contacts/[id]?tab=crm`
starting at "Commit 8" (Contact Hub Migration, `7c215fb`).
**Reference:** `docs/phase2/DESIGN_DECISIONS.md` ADR-002; commit `7c215fb`.

### Product decision: Inbox, Contact Hub, CRM Pipeline stay separate nav items

Phase 2 `ADR-003`. **Decision:** the three screens are not merged into one, because they
serve different workflows (Inbox = urgency-sorted real-time queue; Contact Hub =
directory/search; CRM Pipeline = stage management) — they are "operational views," while
Customer 360 is "the workspace." **Status:** shipped, current.
**Reference:** `docs/phase2/DESIGN_DECISIONS.md` ADR-003.

### Product decision: ChatPane reused without modification (ADR-004), Timeline synthesized client-side in v1 (ADR-005), AI Health Score reserved not mocked (ADR-006), AI tab fetches lazily (ADR-007), tab state lives in URL (ADR-008), mutations centralized in one hook (ADR-009), CRM Pipeline stays a separate route from Contact Hub (ADR-010)

These seven Phase 2 frontend ADRs (`docs/phase2/DESIGN_DECISIONS.md` ADR-004 through
ADR-010) are implementation-pattern decisions rather than product-shape decisions:
reuse the battle-tested `ChatPane` via props rather than forking it; ship a client-side
timeline synthesis now and defer a backend event-log endpoint; show a reserved `–` state
for the AI health score rather than a fake heuristic number, gated by an `ai_insights`
feature flag; lazy-fetch the AI tab on open rather than prefetching an expensive LLM
call for every page load; store active tab in the URL (`?tab=X`) for deep-linking rather
than component state; centralize all contact mutations in one
`useContactMutations(contactId, leadId)` hook; and defer merging CRM Pipeline into
Contact Hub to a future phase.
**Status:** all shipped and current as of 2026-07-02, per direct reading of
`docs/phase2/DESIGN_DECISIONS.md`.
**Reference:** `docs/phase2/DESIGN_DECISIONS.md` ADR-004 through ADR-010.

### Product decision: phoneNorm is the canonical phone identity (Phase 2 ADR-011)

**Decision:** `phoneNorm` (via `to10Digit()` in `src/utils/phone.js`) is the
platform-wide canonical phone identifier; every path that creates/imports/syncs a
contact or lead must compute and persist it, and all duplicate detection must compare
`phoneNorm`, never raw phone strings. **Why:** the same subscriber's number arrived in
different formats across paths (`+91 9866141993`, `919866141993`, `9866141993`), and
raw string comparison let inbox-assigned (12-digit) and manually-created (10-digit)
leads for the same person coexist as separate records in production. As of the doc's
"covered paths" table (dated 2026-06-30), 8 entry points were marked compliant.
**Status:** shipped as a documented rule on 2026-06-30, but this is the **direct
predecessor** of backend `ADR-013` (2026-07-01, see Era 4), which found the picture
less complete than this table suggested — `CustomerIdentityService` existed but "is not
called by any route," and re-documented 3 of these same paths as having gaps
(`contacts.js` raw-phone dedup, CSV import in-memory scan, WhatsApp unknown-contact
race). Treat backend ADR-013 as the current source of truth over this table.
**Reference:** `docs/phase2/DESIGN_DECISIONS.md` ADR-011 (2026-06-30 as-of date);
superseded/refined by `docs/adr/ADR-013-customer-identity.md` (2026-07-01).

### The 13-commit Phase 2 rollout

The roadmap was formalized mid-rollout: `c1bd367` ("docs(phase2): update roadmap to
approved 13-commit plan") lands between Commit 4 and Commit 5. The 13 commits, all
dated 2026-06-29:

| # | Commit | Hash | Scope |
|---|---|---|---|
| 1 | Customer 360 page foundation | `353b5f5` | `/admin/contacts/[id]` route, `ContactDetail`/`TabId`/`CONTACT_TABS` types, journey inference, mutation hook skeleton |
| 2 | Conversation tab + Customer360Provider | `018865a` | shared data provider for all tabs |
| 3 | Conversation Workspace completion | `867ff8c` | — |
| 4 | CRM workspace tab | `e5e72f4` | — |
| — | (roadmap doc update) | `c1bd367` | — |
| 5 | Timeline & Activity Feed | `c94ad1d` | client-side synthesis per ADR-005 |
| 6 | Contact Profile & Identity | `ccd52a1` | — |
| 7 | Tasks & Follow-up Workspace | `f7f6bf0` | — |
| 8 | Contact Hub Migration | `7c215fb` | old CRM detail page redirect begins |
| 9 | CRM Migration to Customer 360 | `0abe679` | — |
| 10 | Navigation & Discovery | `09cafad` | — |
| 11 | Performance, Accessibility & UX Polish | `791c90f` | — |
| 12 | Production Hardening & Regression Validation | `c3a33bc` | — |
| 13 | Phase 2 Release | `68a7ecf` | — |

A same-day follow-up, `4d09d9e` ("ux(phase2.1): improve Customer 360 workspace
discoverability across all entry points"), is documented in git history as "phase2.1" —
i.e. a post-release polish pass, not part of the original 13.

**Frozen Tab List (from `dashboard/CLAUDE.md`, undated as a standalone ADR but stated as
a permanent rule tied to this rollout):** the Customer 360 tab list — Profile,
Conversation, Timeline, CRM, Tasks, Notes, Documents — is frozen. New tabs require an
explicit architecture decision. Every proposed feature must pass the test: "Does this
feature help understand, communicate with, or operate a single customer?" — if yes, it
belongs inside Customer 360; if no, it belongs in a separate module. This is the rule
that later keeps AI, Automation, Campaigns, Analytics, Marketplace, and Workflow **out**
of Customer 360 as new tabs — they integrate into the frozen tabs or into an "Activity
Panel" extension-point instead (`data-slot="timeline-ext-*"` reserved slots).
**Status:** enforced, current. This rule directly shapes the Campaigns module decision
below (Campaigns is "a future separate module," not a Customer 360 tab).
**Reference:** `dashboard/CLAUDE.md` "Customer 360 Boundary Rule" and "Frozen Tab List"
sections; commits in table above.

---

## Era 4 — V3: full UI overhaul (2026-06-30)

### 2026-06-30 — APForce V3: full UI overhaul across all modules

`efe9c7c` ("feat(v3): implement APForce V3 — full UI overhaul across all modules") is a
single large commit replacing the entire dashboard UI: a new design-token system
(Inter font, primary-blue/neutral-slate/semantic color tokens, WCAG 2.1 AA skip-link,
`prefers-reduced-motion` support), a 22-component UI library under
`src/components/v3/ui/` (Button, Input, Select, Table, Drawer, FAB, CommandPalette,
etc.), and a new `(v3)` Next.js route group with its own shell
(`V3Sidebar`/`V3BottomNav`/`V3NotificationPanel`/`CommandPalette`/`FAB`). Per user
memory (`project_v3_directive.md`), this was framed as a "business operating system"
navigation restructure — not verified verbatim in a commit message, noted here as an
inference from project context rather than a git-sourced fact.
**Status:** shipped; this is the UI foundation all later modules (Templates, WhatsApp
settings, Campaigns, Automation, E2E tests) are built inside.
**Reference:** commit `efe9c7c` (2026-06-30).

### 2026-06-30 — V2 to V3 migration completes; V2 routes eliminated

Same-day follow-up commits complete the cutover: `f59545f` ("wire V3 inbox to real V2
WhatsApp API endpoints" — V3 UI, V2 backend, bridged), `424635d` (full Team tab in
Analytics + Employees section in Settings), and `fbeeb5a` ("feat(v3): complete V2→V3
migration — eliminate all V2 routes"). `b2b638d` removes conflicting standalone V2
analytics/settings pages the same day.
**Status:** shipped; V2 dashboard routes no longer exist as of this date.
**Reference:** commits `f59545f`, `424635d`, `fbeeb5a`, `b2b638d` (2026-06-30).

### 2026-06-30 — Customers renamed to Contacts; CustomerIdentityService authored

Two related decisions land the same day: `15faa70` ("feat(contacts): rename Customers →
Contacts module, add /contacts route") and `aec92a3` ("feat(phase-a): implement
CustomerIdentityService — core platform identity layer"). The latter is the first
appearance of `CustomerIdentityService` (`CIS`) as a named service — written but, per
backend ADR-013 written the next day, not yet wired into any route.
**Status:** `CustomerIdentityService` code shipped 2026-06-30; its *mandated use* across
all entry points is formalized and enforced the next day via ADR-013 (Era 5). Treat
2026-06-30 as "service exists," 2026-07-01 as "service is the law."
**Reference:** commits `15faa70`, `aec92a3` (2026-06-30); `docs/adr/ADR-013-customer-identity.md`
(2026-07-01).

---

## Era 5 — Backend ADRs: WhatsApp send service and customer identity (2026-07-01)

This is the first day formal ADR documents (`docs/adr/ADR-0NN-*.md`, distinct from the
Phase 2 frontend ADR series) and a root `CLAUDE.md` enforcement file appear in this repo.

### ADR-012 — Outbound WhatsApp Messaging must go through WhatsAppSendService

**Date:** 2026-07-01. **Status:** Accepted, ENFORCED (per root `CLAUDE.md`).
**Decision:** all outbound WhatsApp messages must go through
`src/services/WhatsAppSendService.js` — no direct `axios`/`fetch` calls to
`graph.facebook.com/*/messages` outside it, no send logic in route handlers.
**Context (why):** before commit `1a10646`, outbound sends were implemented
independently in at least 5 places (`whatsapp.js` `/send`, `/send-template`,
`/broadcast`, `/send-media`, `/upload-send`, the webhook welcome message, and
`automations.js` via a separate `src/utils/whatsappSend.js` hardcoded to Meta API
`v19.0`). Each re-implemented WABA config lookup, E.164 normalization, and message
storage independently; bugs fixed in one path weren't fixed in others; contact
resolution used a full-table DynamoDB Scan; template sends from automations left no
message history; RBAC was inconsistent. Upcoming modules (Campaigns, AI Agents, CTWA,
Customer Journey automation) would each have duplicated this logic again without
centralization.
**Consequences:** one bug fix now applies everywhere; every send path writes a DDB
message record and updates the last-message preview (automation-triggered sends now
appear in the Inbox); `resolveContact()` uses the `company-phone-index` GSI instead of
scans; a `resolvedContact` shortcut avoids N redundant DDB reads in broadcast loops; RBAC
enforcement (`_assertSendPermission()`) is centralized. Constraint: route handlers still
own pre-send orchestration (S3 download, Meta media upload, broadcast recipient
scanning) — only the Meta API call and DDB persistence steps must go through the
service. `sendCatalog`/`sendPayment`/`sendFlow`/`sendPoll`/`sendLocation`/`sendContact`
remain 501 stubs to be implemented as needed.
**Status:** shipped and enforced. The refactor itself landed as `1a10646` ("feat(whatsapp):
centralize all outbound messaging in WhatsAppSendService") followed same-day by
`c58d07f` ("refactor(whatsapp): final architecture cleanup — freeze messaging
foundation" — described in ADR-012 as "scan eliminated"). The ADR document and backend
`CLAUDE.md` landed in the same commit, `99131b1`.
**Reference:** `docs/adr/ADR-012-whatsapp-send-service.md`; commits `1a10646`,
`c58d07f`, `99131b1` (2026-07-01).

### ADR-013 — Customer Identity & Recipient Resolution

**Date:** 2026-07-01 (commit `ea3a86e`). **Status:** Accepted, ENFORCED (per root
`CLAUDE.md`).
**Decision:** `phoneNorm` (`to10Digit(rawPhone)`, 10-digit Indian numbers only in Phase
1) is the *only* value used to compare, look up, or deduplicate customers — never raw
phone strings. Every entry point that creates or claims a customer must call
`CustomerIdentityService.resolveOrCreate()`; no route handler may query
`company-phone-index` directly for dedup or write `LEAD# METADATA` items directly.
**Context (why):** as of this ADR, `CustomerIdentityService` "provides atomic customer
creation with a `LEAD_PHONE#` DynamoDB TransactWrite lock, `IDEM#` idempotency locks...
[but] is not called by any route." A survey of 6 active entry points found 2 with active
gaps (CSV import used in-memory scan dedup instead of the GSI; WhatsApp inbound-unknown
path had no phone lock before `INBOX#` creation) plus a known bug (`contacts.js`
deduplicated on raw `l.phone` instead of `phoneNorm`) and 2 future entry points (CTWA,
public partner API) not yet built. It also formally reconciles a format mismatch the
Phase 2 ADR-011 table didn't fully surface: the Phase 2 `ContactService` normalizes to
E.164 while every other path normalizes to 10-digit — ADR-013 rules that `LEAD#`
identity (10-digit `phoneNorm`) is the source of truth for messaging/dedup, and
`CONTACT#` records are a secondary, linked identity graph.
**Consequences:** impossible duplicates (the `LEAD_PHONE#` TransactWrite lock makes
concurrent duplicate creation a handled atomic failure, not a race); idempotent webhooks
via time-bucketed `IDEM#` locks (5-minute default window — a duplicate delivered more
than 5 minutes later creates a new customer, but the `LEAD_PHONE#` lock still prevents
it persisting as a duplicate); one place to add new country codes. Constraint: high-volume
batch imports must chunk rows rather than call CIS per-row in a tight loop (TransactWrite
caps at 100 items/call).
**Status:** rule is enforced going forward; **the 3 pre-existing gaps are explicitly
NOT yet fixed** — see "Open architectural questions" below.
**Reference:** `docs/adr/ADR-013-customer-identity.md`; commit `ea3a86e` (2026-07-01).

### Root CLAUDE.md becomes the enforcement mechanism for backend ADRs

Both ADR-012 and ADR-013 land alongside edits to a newly-created root `CLAUDE.md`
(first appearing in `99131b1`, extended in `ea3a86e`) that mirrors each ADR's "what this
means in practice" section and code-review gate as permanent, session-independent rules.
Per the file's own header: "An architecture decision record (ADR) must be cited to
override any rule." This is the mechanism by which future AI-driven sessions (Claude
Code or otherwise) are kept aligned with these two ADRs without needing to re-read the
full ADR text every time.
**Status:** current, active constraint on this repository.
**Reference:** `f:\aws\vt-employee-bot\CLAUDE.md`.

---

## Era 6 — Campaigns and Automation modules (2026-07-01)

### Campaigns Phase 1 foundation

`efb152d` ("feat(campaigns): Phase 1 Campaigns module foundation", 2026-07-01) adds
`src/routes/campaigns.js` (CRUD, launch, audience preview) and a 5-step campaign
creation wizard (Info → Audience → Template → Schedule → Review) in the dashboard. Per
its own commit message, it explicitly sends via `WASendSvc` (citing ADR-012), gates on
APPROVED-only WhatsApp templates, and caps audiences at 1,000 contacts. This is the
first new module built entirely on top of the just-established ADR-012/013 send and
identity contracts, and — consistent with the Customer 360 Frozen Tab List rule (Era 3)
— ships as its own top-level nav item / module rather than a Customer 360 tab.
**Status:** shipped; iterated on heavily the same day (see below) and hardened the
following day (ADR-014, Era 7).
**Reference:** commit `efb152d`; `dashboard/CLAUDE.md` "Campaigns" row in the
Customer 360 integration-rules table (documents this module-not-tab placement decision).

### Campaign bug-fix and hardening chain (same day)

A rapid same-day sequence fixes wizard crashes and data-integrity bugs found right after
the foundation commit: `4f0fc1c` (AudienceBuilder crash when company has tags),
`389e148` (template selection crashes wizard on Next), `3d55372` (stale
`t.templateId` reference), and `6163069` ("fix audience mismatch — deletedAt filter,
phoneNorm dedup, live Review count" — note: this is the campaigns module's own
independent brush with the `phoneNorm` dedup rule from ADR-013/Phase-2-ADR-011).
**Status:** shipped fixes, superseded by the more thorough audience-integrity redesign
below.
**Reference:** commits `4f0fc1c`, `389e148`, `3d55372`, `6163069` (2026-07-01).

### Product decision: enterprise launch integrity — audience validation gate

`20256a6` ("feat(campaigns): enterprise launch integrity — audience validation gate",
2026-07-01). **Decision:** a campaign must never send a different number of messages
than the count shown to the user. A single authoritative `_buildAudience()` helper is
shared by `/audience/preview`, `/audience/validate`, and `/:id/launch` — the audience
object built during the launch-integrity check is reused directly for the send loop
(never rebuilt twice in one request). `POST /:id/launch` compares the `reviewCount` the
user approved against the live `finalCount` at launch time; a mismatch returns HTTP 409
`AUDIENCE_CHANGED` and sends zero messages, leaving the campaign in draft.
**Why:** without this, "Review / Launch dialog / Actual sends" counts could each differ,
breaking user trust in the system (stated directly in the commit message).
**Rule enforced (verbatim from commit message):** `reviewCount == launchedCount ==
actualSentCount`; if these three values differ, the campaign is aborted before the
first message.
**Status:** shipped, current.
**Reference:** commit `20256a6` (2026-07-01).

### Product decision: Templates move into Campaigns as a tab

`c8c9670` ("feat(campaigns): move Templates into Campaigns module as a tab",
2026-07-01). Templates is removed from the sidebar's top-level `FLAT_ITEMS` and becomes
the 6th tab inside the Campaigns page, reusing the existing `TemplateDashboard`/
`TemplateList` components; the standalone `/templates` route is kept for direct
bookmark access. This reflects a product judgment that templates are primarily a
campaigns input, not an independent top-level concern — consistent with, but not
explicitly cited against, the Customer 360-style "don't multiply top-level nav items"
philosophy seen elsewhere in this repo (inferred parallel, not a stated cross-reference
in the commit).
**Status:** shipped, current.
**Reference:** commit `c8c9670` (2026-07-01).

### Automation Module Phase 1 — trigger-based workflow engine

`fed22c0` ("feat(automation): Phase 1 Automation Module — trigger-based workflow
engine", 2026-07-01), merged via `7405e78` ("merge feature/v3-automation"). Adds
`AutomationEngine.js` as an orchestration service (`fireTrigger`, `_startExecution`,
`_runSteps`, `_runAction`, `processDueWaits`) that explicitly delegates WhatsApp sends to
`WASendSvc` (cites ADR-012 in its own commit message) and customer resolution to `CIS`
(cites ADR-013 in its own commit message) — i.e., this is the first new module built
*after* both backend ADRs existed, and it was built to comply with both from its first
commit rather than needing a later migration. A rewrite of `automations.js` preserves
`runAutomations()` for backward compatibility with existing `crm.js` callers. A UAT audit
pass (`60dbc6c`) and a hotfix (`92eb454`, "EventBridge `/_tick` bypass was blocked by
app-level auth") follow same-day.
**Status:** shipped, current.
**Reference:** commits `fed22c0`, `7405e78`, `60dbc6c`, `92eb454` (2026-07-01).

### E2E test suite and CI hardening

Same-day and into 2026-07-01, `4bc528f` ("feat(e2e): install Playwright and add smoke
test suite") adds the first end-to-end test layer, followed by a chain of CI fixes
(`c322eef` Node 24 for E2E job, `4b64a9e` npm install vs npm ci lockfile mismatch,
`3ab56b4` CORS allowlist for localhost E2E, `3d920e4`/`43b89af` Playwright strict-mode
locator fixes for desktop+mobile dual sidebars) and a decision to make E2E non-blocking
(`946ceed`, "make E2E non-blocking so dashboard deploy is never gated") — i.e., E2E
failures do not currently block a production deploy.
**Status:** shipped; E2E is present but explicitly non-gating as of this date. See "Open
architectural questions" below.
**Reference:** commits `4bc528f`, `946ceed`, `c322eef`, `4b64a9e`, `3ab56b4`, `3d920e4`,
`43b89af` (2026-07-01); `docs/bible/10_TESTING_GUIDE.md` for current test-running
instructions.

---

## Era 7 — Campaign scheduler hardening and ADR-014 (2026-07-02, most recent)

### ADR-014 — Campaign Scheduler: scan-based due-campaign sweep (interim)

**Date:** 2026-07-02 (commit `50771ba`, same commit as the implementation — the ADR and
code shipped together). **Status:** Accepted (interim).
**Decision:** `src/services/CampaignScheduler.js` runs on a 5-minute EventBridge
schedule and finds due campaigns (`scheduledAt` passed) via a DynamoDB `Scan` with a
narrow `ProjectionExpression` (fetching only `PK`, `SK`, `id`, `companyId`,
`createdBy`, `createdByName`, `status`, `scheduledAt`) and a `FilterExpression` scoped
to `begins_with(SK, 'CAMP#')`. **A GSI is deliberately not added yet.**
**Context (why):** campaign items are keyed `PK = CONFIG#CAMP#{companyId}` —
company-scoped, not sortable by `scheduledAt` across companies — so there is no index
that answers "all due campaigns, any company" directly. At current scale (single-digit
to low-tens of companies, campaign items a tiny fraction of the table), a Scan on a
5-minute cadence is judged cheap enough. The ADR explicitly cites two existing precedents
of accepted low-cardinality Scans against the same table: `_buildAudience()` in
`campaigns.js` (scans all of a company's leads on every audience preview/launch) and the
WhatsApp webhook's WABA-config-by-`wabaId` scan for template-status updates.
**Migration trigger (explicit, quoted):** revisit and add a GSI (e.g. `GSI_PK = status`,
`GSI_SK = scheduledAt`) when *any* of: `DYNAMODB_TABLE_METRICS` crosses ~1M items such
that the 5-minute Scan becomes a measurable cost line item; the number of companies with
active campaigns grows past ~50; or CloudWatch shows the scheduler's Scan consuming a
disproportionate share of read capacity. The reason a GSI isn't added now is stated
directly: it "adds an always-on write cost to every campaign status transition
(draft/scheduled → launching → active → completed/failed) and requires a
backfill/migration on an existing table" — not justified while campaign volume is low.
**What must not regress:** the Scan must always use `ProjectionExpression`; must stay
filtered to `begins_with(SK, 'CAMP#')` (never widened to other entity types); due
campaigns must be processed in bounded batches (`BATCH_SIZE` in `CampaignScheduler.js`),
not unbounded concurrency.
**Status:** accepted as a deliberate interim tradeoff, current. Carries a
`// TODO(ADR-014)` comment in `CampaignScheduler.js` pointing back to the ADR.
**Reference:** `docs/adr/ADR-014-campaign-scheduler-scan.md`; commit `50771ba`
(2026-07-02).

### Bug fix bundled with ADR-014: scheduled launch, delivery/reply stats, race-safe state machine

The same commit (`50771ba`, "fix(campaigns): wire scheduled launch, delivery/reply
stats, and harden the scheduler") fixes three previously silent no-ops, per its own
commit message: (1) clicking "Schedule" always created a draft — `status` was
hardcoded and nothing ever flipped it; (2) delivered/read/replied stats never updated
after launch, because the inbound-status webhook only fed the older `BROADCAST#` path,
not campaigns; (3) there was no trigger to auto-launch a campaign once `scheduledAt`
arrived — this is what `CampaignScheduler.js` (introduced in this same commit) now
provides. The fix also introduces an atomic launch state machine —
`Scheduled/Draft → Launching → Running` — using a conditional claim, so two overlapping
EventBridge invocations (or a scheduler racing a manual launch) cannot double-send: the
losing writer's conditional claim fails and it exits gracefully. Execution telemetry
(`scannedCount`/`launchedCount`/`skippedCount`/`failedCount`/`executionTime`) is logged
per run.
**Status:** shipped, current — this is the most recent commit on `main` as of this
document's verification date.
**Reference:** commit `50771ba` (2026-07-02).

---

## Era 8 — Bible-audit fix pass: webhook signature, points RBAC, ADR-012/013 gaps (2026-07-02)

### Four production issues found by the Bible audit itself, fixed same-day, pre-commit as of this writing

The audit that produced this Bible (Eras 6-7 and the chapters themselves) surfaced its own
list of critical findings in `20_CURRENT_STATE.md` §3. Four of those were fixed directly,
in this exact order, before the Bible was committed:

1. **WhatsApp webhook signature verification.** New shared `src/utils/verifyMetaWebhookSignature.js`
   verifies `X-Hub-Signature-256` via HMAC-SHA256 over the true raw request body
   (`req.rawBody`, captured by a `verify` hook added to `app.js`'s `express.json()`).
   Both Meta webhook consumers (`whatsapp.js`, `forms.js`) now share it and fail closed
   (401) on a bad/missing signature. `forms.js`'s pre-existing check — which hashed
   `JSON.stringify(req.body)`, not true raw bytes — was corrected, not just reused.
   `config/secrets.js` now warns at cold start if `META_APP_SECRET` is unset in production.
2. **`points.js`'s `POST /award` RBAC gap.** Now requires `admin`/`manager`/`team_lead`
   (matching `metrics.js`'s `POST /add-for-member`). Verified before fixing: this route had
   zero callers anywhere in the frontend — a real but latent gap, not exploited traffic.
3. **Three points/leaderboard formulas unified.** `points.js`, `admin.js`'s
   `/points-rebuild`, and `metrics.js`'s `/leaderboard` now all call one `calcPoints()` +
   new `buildCustomWeights()` helper in `config/metricsConfig.js`. The weekend
   `1.5×` multiplier that only `points.js` had was **removed** (not centralized) because
   `metrics.js`'s leaderboard operates on monthly-aggregated totals with no per-entry date
   left to apply it to. **Product decision, approved 2026-07-02 (same day):** confirmed as
   an intentional, final removal — not a placeholder pending reinstatement. Weekend metric
   entries earn the same points as weekday entries going forward.
4. **ADR-012's one bypass closed.** New `WhatsAppSendService.sendReadReceipt()` method;
   `whatsapp.js`'s `POST /inbox/:leadId/mark-read` calls it instead of a direct `axios.post`.
5. **ADR-013 migrated for four of six known-bypassing paths.** `crm.js`'s `POST /leads`,
   `crm.js`'s `POST /import` (new-lead branch only — the explicit `overwrite` branch stays
   a direct update, since CIS's conservative enrich-merge isn't the same operation as a
   forced overwrite), and both of `forms.js`'s lead-creating routes now call
   `CIS.resolveOrCreate()`. The Meta Lead Ads webhook now also passes an explicit
   `idempotencyKey` (`meta_lead_ads:${leadgen_id}`), closing the redelivery-race gap ADR-013
   was specifically designed to close for webhook entry points.
   **Deliberately not touched** (not in the migrated list; still open — see updated
   Open Question #1 below): `whatsapp.js`'s unknown-contact `INBOX#` creation path, and
   `contacts.js`'s raw-`l.phone` read-time dedup (a different class of bug — it doesn't
   create anything, so CIS migration doesn't apply to it the way the other five paths do).

**Status:** implemented, validated (Jest, ESLint, TypeScript, build all passing), and
committed together with this Bible and the doc updates recording it — code and
documentation landed in the same commit. Verify `git log -1` for the exact hash; this
entry was written moments before that commit and does not self-reference its own SHA.
**Reference:** this session's fix + deployment report.

**Note on `CLAUDE.md`:** the root `CLAUDE.md` referenced throughout Era 5 (with its
detailed ADR-012/013 tables and a per-item "Migration status" checklist) was **rewritten
to a terser "bootstrap" form** in the same window as this fix, pointing readers to this
Bible instead of inlining the detail. The "Migration status" checklist Open Question #1
(below) used to cite no longer exists in `CLAUDE.md` verbatim — this Bible is now the
authoritative record of that checklist's state, per the new `CLAUDE.md`'s own §12
("Documentation Updates... Update: CURRENT_STATE.md, Relevant docs/bible file").

---

## Era 9 — Automation "Stage Changed" trigger fix, found during Phase 0 audit for the branching automation builder (2026-07-04)

**Found:** auditing `AutomationEngine.js` ahead of the new graph/branching engine work (see
`08_MODULES.md`'s `AutomationEngine.js` entry) surfaced that `crm.js`'s stage-transition
route fired `runAutomations(companyId, 'stage_change', ...)` — no trailing *d* — while every
other consumer of this event name uses `'stage_changed'`: the frontend's trigger picker
(`WorkflowBuilder.tsx`'s `TRIGGER_OPTIONS`), `events/catalog.js`'s `STAGE_CHANGED` constant,
and the events/timeline test suite. `AutomationEngine.fireTrigger()`'s workflow filter does
exact string equality (`wTrigger === triggerType`), so **any workflow built through the UI
with a "Stage Changed" trigger could never fire, for any company, since the trigger type was
added.** Confirmed via `grep` across every `runAutomations(` call site — this was the only one
using the mismatched string.

**Fixed:** `crm.js`'s stage-transition route now fires `'stage_changed'`, matching the
canonical name used everywhere else. One-line change, no schema/shape change, no data
migration needed (no live workflow currently uses a Stage Changed trigger, per direct
DynamoDB check against `viir_trading`'s two live workflows — both use `whatsapp_conversation_started`/`lead_created`). `tests/events.test.js` (41 tests) and
`tests/crmValidation.test.js` (6 tests) re-run clean after the change.

**Status:** implemented, validated, and committed as its own small commit, separate from the
in-progress branching automation builder feature (Phase 0 audit for that feature is what
surfaced this bug — see the new feature's own tracking once Phase 1 lands).

---

## Era 10 — Branching automation builder, Phase 1: graph engine (backend only) (2026-07-04)

**What:** `AutomationEngine.js` now supports a second, graph-shaped workflow representation
(`nodes[]`/`edges[]`/`entryNodeId`) alongside the original flat `steps[]` model — a real
if/else branching engine, not just sequential actions. A new `condition` node type supports
three modes: `field_match`/`boolean` (CRM-field branching, e.g. "stage = Won," with a **live
re-fetch** of the lead's current state at evaluation time rather than the frozen context
captured when the trigger fired — the actual point of putting a condition after a `wait`) and
`button_reply` (branches on which WhatsApp reply button a contact taps, racing an event-driven
resume against the node's own timeout).

**Design decisions, confirmed with the product owner before implementation:**
1. Condition nodes re-fetch live lead state (not frozen trigger-time context) — approved
   over the frozen-context alternative specifically to support "check current CRM state
   after waiting."
2. Graph executions get their own `path[]` field on `AUTO_EXEC#` records (append-only,
   additive) instead of reusing linear's fixed-size `steps[]` — approved, with the note that
   `ExecutionList.tsx` will need a second render branch once the canvas UI (Phase 2) lands.
3. A separate, pre-existing bug found during the Phase 0 audit for this feature (`crm.js`
   firing `'stage_change'` instead of the canonical `'stage_changed'`) was fixed immediately
   as its own small commit (`e536bc2`), not bundled into this feature — see the entry above
   this one for detail.

**Backward compatibility:** zero migration. `_startExecution()` dispatches purely on whether
`workflow.nodes` is a non-empty array — a workflow is graph-shaped or linear-shaped for its
whole lifetime. The two live workflows in production (`viir_trading`'s "testing" and "Welcome
new leads," both simple `send_template → end`, both currently paused, confirmed via direct
DynamoDB read) are unaffected and never exercise the new code path. `automations.js`'s
`POST /`/`PUT /:id` gained purely additive `nodes`/`edges`/`entryNodeId` support next to the
existing `steps` handling, with a new shallow `validateGraphShape()` check (referential
integrity only — every edge's `source`/`target` must reference a real node id; deeper
graph-integrity concerns like cycles or unreachable nodes are deferred to the Phase 2 canvas
UI, where a human is actively building the graph and can be guided interactively).

**Scope of this Phase:** backend engine only — `AutomationEngine.js` (graph walk, condition
evaluator, wait/resume dispatch, new `resumeOnButtonReply()`), `automations.js` (additive CRUD
support), `whatsapp.js` (new `resumeOnButtonReply()` call from both the known-lead and
unknown-contact inbound button-tap branches, independent of and additional to the pre-existing
`fireButtonFollowUp()` welcome-message mechanism). No frontend/canvas work — the existing
`WorkflowBuilder.tsx` linear UI is completely untouched, per explicit instruction; a React
Flow-based visual canvas is Phase 2, not yet started, and needs `reactflow`/`dagre` added as
new `dashboard` dependencies (not yet installed as of this entry).

**ADR conflicts checked:** none. ADR-012 — the graph runner's `send_template` node still goes
through the same `_runAction()` → `WASendSvc.sendTemplate()` call as the linear runner, no new
Graph API call sites. ADR-013 — the live re-fetch reads an already-known `leadPK`'s `METADATA`
by direct `dynamodb.get`; it never creates or deduplicates a customer.

**Status:** implemented and validated. `tests/automationEngine.test.js` grew from 7 to 14
tests (7 new, covering the graph walk, live re-fetch, plain-wait pause/resume, `button_reply`
pause + event-driven resume + timeout-fallback resume, and dangling-edge handling); the
original 7 pass unchanged. Full suite: 600/600 passing (up from the 593 baseline at the start
of this session). See `08_MODULES.md`'s `AutomationEngine.js` entry for the full technical
writeup.

---

## Era 11 — ADR-015: AIService.js, the single governed AI entry point (2026-07-05)

`e53c2cf` ("feat(ai): build AIService.js as the single governed entry point (ADR-015)").
Migrates `ai.js`'s two pre-existing direct-fetch-to-Anthropic endpoints
(`metrics-insights`, `team-metrics-insights`) onto a single
`AIService.generate({ useCase, companyId, context, user })` entry point, backed by a new
`src/config/aiConfig.js` useCase registry (model/prompt template/rate limit per useCase),
mandatory `companyId` scoping, PII redaction (`src/utils/aiRedaction.js` — field denylist
plus an unconditional PAN/Aadhaar regex scrub), and the `CONFIG#AI#{companyId}` two-level
master/module toggle (Rule 7, checked fresh on every call, no caching). Written
proactively, before AI Inbox, Campaign Intelligence, or AI Automation existed — same
reasoning ADR-012/013 used for WhatsApp sending and customer identity.
**Status:** shipped, foundational — every AI feature shipped this session builds on this
boundary; `AIService.js` has zero `require()` dependency on `WhatsAppSendService` (Rule 5),
enforced by a repo-grep-style test, not just prose.
**Reference:** `docs/adr/ADR-015-ai-service-boundary.md`; commit `e53c2cf` (2026-07-05).

## Era 12 — AI Intent Detection: first real feature on AIService.js (2026-07-05)

`024dfe0` ("feat(ai): add AI intent detection — first real feature on AIService.js"). The
`inbox-intent-detection` useCase classifies a WhatsApp conversation's likely intent (8
categories — interested, complaint, kyc_query, pricing_question, etc.) once per
conversation, fire-and-forget, mirrored onto `LEAD#METADATA`/`INBOX#CONTACT` as
`intent`/`confidence`/`classifiedAt`. `customerFacing: false` — never engages Rule 6's
approval gate. Surfaced as a badge on the Inbox conversation list (`6da689d`, "Item 7")
and on Contact 360's Conversation tab.
**Status:** shipped, live.
**Reference:** `src/services/IntentDetectionService.js`; commit `024dfe0` (2026-07-05).

## Era 13 — Approval queue: routes + frontend for ApprovalService's pre-existing routing logic (2026-07-05)

`1ee7aa4` ("feat(ai): add Approval queue routes + frontend (ApprovalService's missing
UI)"). `ApprovalService.js`'s `routeApproval()`/`resolveApproval()` (leave-aware routing:
assignee → their `teamLeadId` if on leave → any active admin → an unassigned queue entry,
never silently dropped) had zero route and zero frontend before this — a routed approval
sat in DynamoDB, invisible to any human. Adds `src/routes/approvals.js` +
`dashboard/src/app/(v3)/approvals/page.tsx` + a live pending-count badge in
`V3Sidebar.tsx`. **Deliberate scope boundary, re-confirmed still true in the 2026-07-05
full system audit:** resolving an approval only flips its status and records who/when —
it does not send anything, for this or any future `customerFacing: true` useCase (see
`docs/bible/07_DATABASE.md` §2.29).
**Status:** shipped, live.
**Reference:** `docs/bible/07_DATABASE.md` §2.29; commit `1ee7aa4` (2026-07-05).

## Era 14 — AI-Assisted Template Creation (2026-07-05)

`1df4172` ("feat(ai): add AI-Assisted Template Creation"). The `template-creation`
useCase: an admin describes a template in plain language, AI drafts a Meta-compliant
WhatsApp template (name/category/body/buttons) for the admin to review, edit, and submit
— it never saves, submits to Meta, or sends anything itself. `customerFacing: false`.
Self-caught during implementation, not by the user: the schema initially allowed a
`PHONE_NUMBER` button type with no `phoneNumber` field for the model to actually supply,
the same fabrication risk already guarded against for URLs — fixed before shipping.
**Status:** shipped, live.
**Reference:** `src/routes/whatsapp.js` `POST /templates/ai-draft`; commit `1df4172`
(2026-07-05).

## Era 15 — AI-Powered Lead Scoring: deterministic, no LLM call (2026-07-05)

`f90514f` ("feat(crm): add AI-Powered Lead Scoring — deterministic, no LLM call"). A
weighted deterministic formula (`LeadScoringService.js` — stage + intent + recency +
urgency + value) scores every open lead into `priorityScore`/`priorityTier` (hot ≥70,
warm ≥40), recomputed on a self-throttling ~60-minute cycle riding the existing 5-minute
`CampaignScheduler` EventBridge rule rather than provisioning new AWS infrastructure
(`LeadScoringScheduler.js`). **Deliberately not an `AIService` useCase** — recurring
per-lead-per-cycle scoring is the wrong shape for a per-item LLM call, since cost/latency
would scale unbounded with leads × cycles, unlike every genuine `AIService` useCase which
is bounded by one real, human-triggered event. Retires `CrmTab.tsx`'s ad hoc
`derivePriority()` heuristic in favor of this single persisted source of truth, and fixes
a real, previously-dormant List View sort bug found along the way (the sort-column chevron
updated but nothing ever actually reordered the list).
**Status:** shipped, live.
**Reference:** `src/services/LeadScoringService.js`, `LeadScoringScheduler.js`; commit
`f90514f` (2026-07-05).

## Era 16 — AI Template Suggestions in Chat: first real customerFacing:true useCase (2026-07-05)

`a7bf409` ("feat(ai): add AI Template Suggestions in Chat — first real customerFacing:true
useCase"). The `inbox-template-suggestion` useCase: an agent clicks "Suggest a reply" in
the Inbox composer; AI picks from the live APPROVED template registry only (never authors
free text) and pre-fills its variables; the agent reviews and sends themselves.
`customerFacing: true`, `autonomous: true` — the agent's own review-then-send click already
is the human-in-the-loop this rule exists to guarantee; the model's own self-rated
`confidence` (`confidenceThreshold: 0.75`) is the real per-call safety net, force-routing a
low-confidence pick to the Approval queue instead (which, per Era 13's scope boundary, does
not then send anything — the composer simply shows no suggestion for that click). First
real use of `AIService`'s `conversationHistory` parameter by any useCase.
**Status:** shipped, live.
**Reference:** `docs/adr/ADR-015-ai-service-boundary.md` Rule 6 addendum; commit `a7bf409`
(2026-07-05).

## Era 17 — ADR-016: AI Chat with Customers, pre-implementation requirements (drafted 2026-07-05, committed 2026-07-05)

Written during the same 2026-07-05 full AI audit that produced Eras 11-16, as a proactive,
not-yet-authorized requirements doc for a future full multi-turn AI conversation feature —
the same reasoning ADR-015 itself used for features that didn't exist yet. Three binding
requirements once picked up: (1) default `autonomous: true` with Rule 6 as the only safety
net — no second approval mechanism; (2) a superadmin-only per-conversation exchange cap
(default 7), zero company-facing visibility, a deliberately different governance shape from
`CONFIG#AI#`'s company-facing toggles; (3) intent-first routing — check
`inbox-intent-detection`'s existing classification and answer via an existing template
before ever starting a full AI conversation. **Hard blocker, explicitly not cleared by this
ADR:** no Knowledge Center (FAQ store, document repository, or vector store) exists
anywhere in the codebase; do not start this feature until that's resolved.
**Status:** requirements accepted and binding whenever the feature is picked up; the
feature itself has not been started. Drafted same-day but left uncommitted until the
2026-07-05 full system audit found it still untracked — committed as-is, then had one
stale claim (`conversationHistory` "not yet used by any real useCase") corrected once
Era 16 made it inaccurate.
**Reference:** `docs/adr/ADR-016-ai-chat-design-requirements.md`.

---

## Era 18 — Dashboard AI Insights: additive widgets, /api/v3/my-work gap deliberately not fixed (2026-07-05)

**What:** `/home` (title "My Work") gained a new "AI insights" section with two widgets:
a Lead Priority Distribution (hot/warm/cold share of pipeline, via `priorityTier` —
Era 15's `LeadScoringScheduler` output) and an Approvals Pending count/link. Both
read their own small, targeted queries (`/api/contacts?pageSize=500`, reusing
`sales-contacts` as the query key to share cache with `sales/page.tsx`; and
`/api/approvals?status=pending`, reusing `approvals-badge-count` to share cache with
`V3Sidebar.tsx`'s nav badge). Zero new backend routes.

**Decision: additive, not a `/home` redesign.** A full dashboard audit (this same session)
found `/home`'s four pre-existing widgets (Urgent Replies, Overdue Follow-ups, Today's
Follow-ups, Recent Contacts, and the 4 KPI cards) all read from a single
`GET /api/v3/my-work` query that **has no backend implementation** — confirmed via `grep`
and the full `app.js` route-mount list (no `/api/v3` prefix registered anywhere). Every
one of those widgets has always rendered on the query's `placeholderData` fallback (all
zeros/empty arrays) in production. This was already found and partially addressed once
before (`508f992`, "fix(dashboard): home-page KPI crash and canvas error-message
clarity" — fixed a crash from `data?.kpis.X` missing an optional-chain on `.kpis`, but
explicitly left the missing endpoint itself as a separate gap, per that commit's own
message).
**Why additive, not fixed here:** the user's explicit instruction was to surface new
AI-insight widgets, not to repair the pre-existing `/api/v3/my-work` gap — two genuinely
separable problems (new read-only aggregations vs. an entire page's primary data source
missing). Bundling them would have silently expanded scope beyond what was asked and
requires its own design pass (what should `/api/v3/my-work` actually aggregate, and from
which existing services). **The gap is still open** — see Open Question #7 below.

**Implementation note — `ProgressBarChart` extended, not forked.** The existing
`ProgressBarChart`/`ProgressRow` chart component (previously written but never actually
rendered on any page — confirmed via a repo-wide grep, both it and `MonthlyTeamProgress`
were dead code before this) bakes in a goal-vs-target `StatusBadge`
(Excellent/On Track/Needs Attention/Not Started) and a matching percentage-text color,
both driven purely by the `progress` number. That framing fits a sales-target metric but
is misleading for a plain category distribution (e.g. "40% cold leads" is not inherently
"Needs Attention"). Rather than fork a parallel component, `ProgressBarChart` gained one
new optional prop, `showStatusBadge` (default `true`, preserving all existing/future
goal-progress callers), and the new distribution widget passes `showStatusBadge={false}`.
Caught and fixed during implementation, not by the user.

**Status:** implemented and validated (TypeScript, ESLint, dashboard build all passing);
committed locally, not yet pushed as of this entry.
**Reference:** this session's Dashboard Audit + AI Insights implementation;
`dashboard/src/app/(v3)/home/page.tsx`, `dashboard/src/components/charts/ProgressBarChart.tsx`.

---

## Era 19 — Production incident: every graph-workflow resume/finalize silently failing since launch (2026-07-06)

**What happened:** the first real customer interaction with Era 10's Part A
pause/resume feature (`c460a42`, per-button `send_buttons`/`send_list` canvas
handles) surfaced that button-tap resumes on workflow `32b47481-…` never
visibly did anything — reported as "30-120s delay, sometimes doesn't fire."
Investigated with real evidence (CloudWatch logs + direct `AUTO_EXEC#`/`AUTO_WAIT#`
reads via the AWS CLI), not guessed.

**Root cause 1 (the actual bug): `_finalizeExecution()` used the raw, unaliased
attribute name `path`** in its `UpdateExpression` — `path` is a reserved DynamoDB
keyword. Every graph execution that ever reached its end state (including
immediately after a successful button-tap resume) threw
`ValidationException: Invalid UpdateExpression: Attribute name is a reserved
keyword; reserved keyword: path`, caught by the caller's try/catch and reduced
to a `logger.warn`, so nothing visibly happened. **Not a timing/delay bug** —
confirmed instant (~100-200ms) and 100% reproducible: 17/17 real resume attempts
for this workflow failed identically across the full test window
(2026-07-05 16:27 → 2026-07-06 02:01); a table-wide scan found this is the
**first real graph execution to ever attempt to finalize** since the graph
engine shipped (Era 10, 2026-07-01) — the only prior `path`-bearing item with
`status: completed` was seeded demo data (`exec-checkpoint-demo`), not a real
execution. `_runSteps`'s linear-workflow equivalent (`fieldName: 'steps'`) was
never affected — `steps` isn't a reserved word.
**Fix:** `fieldName` is now always passed through an `ExpressionAttributeNames`
alias (`#f`), the same way `#st` already aliases `status` — never interpolated
raw into the `UpdateExpression`.
**Side effect discovered, not fixed automatically:** the `AUTO_WAIT#` distributed
claim (conditional-delete) always succeeded *before* the crash, so the stuck
executions had no wait record left to resume from even after this fix. Since the
product is still pre-launch (testing phase, zero real customers), these were
data-deleted outright rather than status-flipped/preserved — see the "Cleanup
and future-proofing pass" addendum below for the exact scope and a second,
independent bug found while investigating two further anomalous records.

**Root cause 2 (independent, latent gap): `processDueWaits()`'s own code
comment said "Wire to AWS EventBridge Scheduled Rule for production" since
Era 10 (2026-07-01) — but it never actually was.** `handler.js`'s EventBridge
Scheduled-Event branch only ever called `runDueCampaigns()`/`runDueLeadScoring()`;
confirmed via `aws events list-rules`/`list-targets-by-rule` that no rule
anywhere calls `POST /api/automations/_tick`. This meant **no paused workflow's
timeout branch, and no `DelayedResponseService` timer, has ever fired on its
own in production** — the only path that could ever resume a paused execution
was the event-driven webhook resume (`resumeOnButtonReply()`), with zero
fallback if it ever missed. Not what caused this specific incident (the
`path` bug fired instantly, before any timeout could matter), but a real gap
regardless.
**Fix:** added `AutomationEngine.processAllDueWaits()` — a table-wide `Scan`
across every company's `AUTO_WAIT#` partition (same accepted interim tradeoff
as ADR-014's `CampaignScheduler` Scan; no GSI yet at today's scale), sharing
the existing claim/dispatch loop (extracted into `_claimAndResume()`) with the
single-company `processDueWaits(companyId)` Query path, which stays as-is for
the JWT-admin manual-trigger route. Wired into `handler.js`'s existing 5-minute
EventBridge tick alongside the other two schedulers (`Promise.allSettled`, so
one failing sweep never blocks the others) — zero new AWS provisioning, same
pattern `LeadScoringScheduler.js` already established for riding this rule.

**Status:** both fixes implemented, tested (new regression test reproduces the
exact reserved-keyword crash via a mock that enforces DynamoDB's real
validation — the existing mock always resolved regardless of expression
validity, which is why 1029 passing tests never caught this), full suite green
(1031/1031), committed and pushed directly given live production impact.
**Reference:** `src/services/AutomationEngine.js` (`_finalizeExecution()`,
`processAllDueWaits()`, `_claimAndResume()`), `src/handler.js`;
`tests/automationEngine.test.js`, `tests/handlerEventBridge.test.js`.

### Cleanup and future-proofing pass (same day)

**Data cleanup:** since the product is pre-launch (testing phase, zero real
customers), the 17 stuck executions plus 2 further anomalous records on the
same workflow — `40332edd-…`/`7e1feaca-…`, stuck at `status: 'running'` with no
`path` at all, found while auditing this incident — were **deleted outright**
(no status-flip/preservation needed at this stage), along with one now-orphaned
`AUTO_WAIT#` record left behind by one of the deleted executions. Verified via
read-back: 0 remaining executions for this workflow, 0 remaining `AUTO_WAIT#`
items for the company. No other workflow or company touched.

**Root cause of the 2 anomalous `running`-forever records: a second, independent
un-awaited-async bug, same class, different call site.** `whatsapp.js`'s webhook
handler calls `AutomationEngine.fireTrigger(companyId, 'keyword_message', ctx)`
**without `await`** (only `.catch()`) before its own `res.sendStatus(200)` — the
exact hazard the handler's *own* code comment two screens up warns about
("Resolving serverless-http's response earlier freezes the execution context and
suspends all async work until the next warm request"), just not followed here.
Confirmed via CloudWatch: both anomalous invocations (`1e8f136f…`, `9075038e…`)
logged their last line (`notified (inbox)`) and hit `END RequestId` within
~155-190ms — before `fireTrigger()`'s `_startExecution()` → `_runGraph()` →
`WASendSvc.sendInteractive()` chain (a real outbound HTTPS call to Meta) had any
chance to run or log. **This is not a one-off:** measuring `startedAt` →
first-node `completedAt` across all 17 (now-deleted) paused executions on this
workflow showed gaps of **6.3s to 49.4s** (mean ~22s) — the entry message only
went out once the same frozen Lambda execution environment happened to thaw on
a later, unrelated invocation. For the 2 anomalous records, the environment was
apparently recycled before ever being reused, so the frozen promise never ran at
all — permanently stuck at `running`, no path, no error logged anywhere. **This
independently explains the "30-120s delay, sometimes doesn't fire" framing from
the original report at least as well as the reserved-keyword bug did** — the
resume-side crash (this Era's main fix) was actually instant and deterministic,
not delayed; this `fireTrigger()` gap is the delayed half.
**Status: found, not yet fixed.** Same bug shape as the `resumeOnButtonReply()`
call site immediately below it in the same file (which *is* internally awaited
per-item, just not by the outer caller — that one races the DB, not a slow
outbound HTTP call, so it never showed this symptom). Needs its own fix +
explicit sign-off before changing `whatsapp.js`'s webhook handler further
tonight.

**Reserved-keyword sweep (codebase-wide):** grepped every `UpdateExpression:`
built with a template literal. Only one other site shared the `_finalizeExecution()`
bug's shape — `whatsapp.js`'s broadcast/campaign stats increments
(`ADD ${field} :one` / `ADD ${campField} :one`) — a dynamic attribute name
interpolated raw. **Not currently exploitable** (the two literal value sets —
`deliveredCount`/`readCount`/`failedCount` and `stats.delivered`/`stats.read`/
`stats.failed` — happen not to collide with any reserved word today) but the
same fragile shape, so hardened anyway: both now go through `#`-aliased
`ExpressionAttributeNames`, the `stats.X` case aliasing each dot-segment
separately. Every other dynamic-`SET`-clause site in the codebase
(`CustomerIdentityService.js`, `crm.js` ×2, `companies.js`, `platform.js`,
`compensation.js`, `automations.js`) already threads every dynamic key through
a `#${k}`-alias — `_finalizeExecution()` was the sole place in the entire
codebase that didn't.

**Test infrastructure:** extracted the reserved-keyword-enforcing mock into
`tests/helpers/dynamoReservedWords.js` (`guardedUpdateMock()` — a curated subset
of DynamoDB's ~570 reserved words realistic for this schema, explicitly not
exhaustive) and applied it to all 4 `dynamodb.update` mock setups in
`tests/automationEngine.test.js` (previously each just unconditionally resolved,
regardless of expression validity). Not retrofitted across the other 43 test
files' own inline `dynamodb` mocks — none of them construct a dynamic
`UpdateExpression` at all, so there was nothing there for this helper to catch;
it's available for any future test that does.

**Recommendation — a real CI/static check, not just a smarter mock:** a jest
mock can only ever catch what a specific test happens to exercise. The durable
fix is a small static-analysis script (no live AWS call needed) that scans
`src/**/*.js` for every `UpdateExpression`/`ConditionExpression` template
literal, extracts any raw (non-`#`, non-`:`) identifier, and checks it against
AWS's full, authoritative reserved-word list — failing CI if a new one shows up
unaliased. Worth adding given this bug class has now hit this codebase once for
real; scope is small (one script, one `package.json` check, run in the same
place ESLint already runs) and it protects every future dynamic-field update,
not just the ones a test author remembers to guard.

**Status:** data cleanup done and verified; `whatsapp.js` stats-increment
hardening done, tested (full suite 1031/1031 green — no test previously covered
this code path, consistent with the file's existing convention of unit-testing
exported pure helpers rather than full-handler webhook tests); shared test
helper built and applied. The `fireTrigger()` un-awaited call is a **known, open
issue** — not fixed in this pass, pending explicit sign-off. The CI
reserved-word check is a **recommendation**, not yet built.
**Reference:** `src/routes/whatsapp.js` (broadcast/campaign stats increments,
and the still-open `fireTrigger('keyword_message', …)` call site),
`tests/helpers/dynamoReservedWords.js`.

---

## Era 20 — Fixed the un-awaited fireTrigger()/resumeOnButtonReply() gap in the WhatsApp webhook (2026-07-06)

**What:** the second bug found during Era 19's cleanup pass — `whatsapp.js`'s
webhook handler called `AutomationEngine.resumeOnButtonReply()` (×2, lead +
inbox path), `fireTrigger('keyword_message', …)` (×2), and
`runAutomations('whatsapp_conversation_started', …)` (×1) all fire-and-forget,
before its own `res.sendStatus(200)`. Measured in production: 6.3s-49.4s delays
(mean ~22s) before a workflow's entry message went out, and 2 executions that
never completed at all — the Lambda execution context suspended right after the
webhook's own response resolved, exactly the hazard the handler's *own* code
comment two screens above already documented for a different reason.

**A deeper finding changed the fix's shape:** `fireTrigger()`'s own per-workflow
dispatch loop was *itself* fire-and-forget (`this._startExecution(...).catch(...)`,
never awaited) — so merely adding `await` at the `whatsapp.js` call site would
have fixed nothing; the outer promise resolved right after the initial DynamoDB
query, before any workflow actually ran. `resumeOnButtonReply()`, by contrast,
already awaited its own per-item `resumeExecution()` calls correctly — it only
needed the fix at the call site.

**Audited every other fire-and-forget call in this same handler before touching
anything** — `notifyCompany()` (WS push), `storeInboundMedia()` (S3 archive,
explicitly idempotent), the `resolveForLead`/`resolveForInbox` → intent
classification chain, `DelayedResponseService.scheduleIfEnabled()`, and two
denormalized-cache field patches. All five are genuinely safe to leave
fire-and-forget — losing/delaying any of them means a cache field is stale or a
realtime push didn't fire, never that a customer-facing automated action
silently doesn't happen. Only the three automation-dispatch calls above carry
that risk.

**Considered and rejected an SQS-based dispatch** instead of awaiting —
checked first, per instruction: no SQS queues exist in the account, no queue
SDK usage anywhere in `src/`, only the existing 5-minute EventBridge tick. Building
one would mean new infrastructure (queue, consumer, IAM, DLQ monitoring) for a
correctness bug, not a throughput problem, and would introduce a real new
ordering risk (a customer's button-tap and keyword-message events arriving out
of order on a standard SQS queue could resume the wrong branch) without a FIFO
+ per-phone-group design this session didn't have room to build safely. Given
zero real customers yet and CRM-scale traffic, premature relative to the actual
problem.

**Fix:**
1. `AutomationEngine.fireTrigger()` now `await Promise.allSettled(starts)` over
   its per-workflow `_startExecution()` calls (each still individually
   `.catch()`-guarded, so one workflow's failure still never blocks another) —
   benefits every caller (`crm.js`, `forms.js`, `campaigns.js`), not just this
   webhook.
2. All 5 at-risk call sites in `whatsapp.js` are now `await`ed before
   `res.sendStatus(200)`.
3. Each is wrapped in a bounded timeout race, `withTimeout()` — **checked
   Meta's own docs first** (Graph API Webhooks + WhatsApp Cloud API
   webhook-setup pages) for a documented response-time SLA to plan the timeout
   against: neither publishes one, both only describe the multi-day
   retry-on-failure schedule. The real, verifiable constraint is our own infra:
   confirmed via `aws lambda get-function-configuration` and `aws apigatewayv2
   get-integrations` that both the Lambda's configured `Timeout` and API
   Gateway's HTTP API integration `TimeoutInMillis` are exactly 30000ms — the
   binding ceiling regardless of what Meta itself would tolerate. Chose 5000ms
   per call: a wide margin over a single Graph API round-trip, leaving ~20s of
   headroom even if more than one at-risk call applies to the same message. On
   timeout, `withTimeout()` resolves (not rejects) — the webhook proceeds,
   falling back to the pre-fix behavior for just that one slow call rather than
   blocking every message behind it. (First version of this helper leaked its
   `setTimeout` when the real promise won the race — caught by a Jest
   "worker failed to exit gracefully" warning during testing, fixed with
   `clearTimeout` in a `.finally()` plus `.unref()`.)
4. `crm.js`'s 3 `runAutomations()` call sites (`lead_created`, `tag_added`,
   `stage_changed`) are **deliberately left fire-and-forget** — same underlying
   risk, but a different blast radius (an authenticated HTTP route, not the
   public webhook) and out of scope for this pass. Flagged for a separate future
   decision, not silently fixed or silently ignored.

**Verification — real evidence, not just passing tests, given this function's
blast radius:**
- Unit-level ordering proof (`tests/whatsappListReply.test.js`): a deferred
  promise stands in for `fireTrigger()`; after draining every other
  already-resolved awaited step via a macrotask yield (`setImmediate`, not just
  a few microtask ticks — several other real awaits precede this call), asserts
  `res.sendStatus` has **not** fired while the deferred promise is still
  pending, then resolves it and asserts the response fires only after. **Proved
  this test actually catches the regression** (not just passes coincidentally)
  by temporarily `git stash`-ing the `whatsapp.js` fix alone and re-running it:
  failed against the pre-fix code exactly as expected (`res.sendStatus` had
  already been called), passed once the stash was restored.
- [Live staging/prod verification results — appended after deploy, see below.]

**Status:** implemented, full suite green (1032/1032). No separate staging
Lambda exists for this backend (confirmed via `aws lambda list-functions`) — the
live CloudWatch verification could only happen against the real production
function, so it was sequenced as: push → deploy → immediate live test → report
real numbers, rather than gating the push on evidence that structurally
couldn't exist yet. Live results appended once available.
**Reference:** `src/services/AutomationEngine.js` (`fireTrigger()`),
`src/routes/whatsapp.js` (`withTimeout()`, the 5 call sites),
`tests/whatsappListReply.test.js`.

---

## Era 21 — Removed the AI customer-reply approval gate: AI now sends directly (2026-07-06)

**What:** `POST /api/whatsapp/inbox/suggest-reply` (aiConfig.js's
`inbox-template-suggestion` useCase, the only `customerFacing: true` useCase in
the codebase) now sends the AI's chosen template directly via
`WhatsAppSendService.sendTemplate()`, with no human review step of any kind.
Previously, the only human-in-the-loop mechanisms were (a) a confidence-gated
`ApprovalService` hold for low-confidence picks, which — per that service's own
code comment — never actually released/sent anything even once approved (a
"standing, deliberate architectural gap"), and (b) the agent's own manual
"Send" click on the suggestion chip in the Inbox composer. Both are now gone;
a high-or-low-confidence pick either sends immediately or doesn't (per the
model's own `hasSuggestion` judgment), with no queued/held state left at all.

**Explicit, informed business decision — not a default.** This was investigated
and flagged before any implementation: the real gate blocking autonomous sends
today was the agent's manual click, not `ApprovalService` (which had no
send-trigger wired to it at all); building "sends directly" meant building a
brand-new autonomous-send capability from scratch, not deleting an existing
one. This exact question had already been circled twice in this project's
history and deliberately deferred both times (`ApprovalService`'s own comment,
and ADR-016's "AI Chat with Customers, pre-implementation requirements" draft
that was never built) — surfaced explicitly given the regulatory stakes (VT
Trading's owner is a SEBI-registered Authorized Person; an unsupervised AI
message that reads as investment advice has real legal/regulatory consequences,
not just a bad customer experience) before writing any code. The business
owner explicitly weighed this and directed it to proceed anyway.

**Compliance mitigations built in, given zero human review:**
1. **Hard system-prompt rule** (`aiConfig.js`, `inbox-template-suggestion`
   promptVersion bumped v1→v2): never promise/imply any return, yield, or
   profit; never use "guaranteed" about any investment/product/outcome; never
   give a buy/sell/hold directive — the model is instructed to set
   `hasSuggestion: false` rather than force a template that could cross this
   line, even if the customer's message is explicitly asking for that kind of
   advice. Known limitation, stated plainly: a system prompt is not an airtight
   compliance control on its own — LLMs don't reliably hold to prompt
   constraints under adversarial/edge-case input. This is a mitigation, not a
   guarantee.
2. **Mandatory, awaited audit trail** — every AI-sent message now calls
   `logAudit()` (`action: 'ai_customer_reply_sent'`, `details.aiGenerated:
   true`, plus `useCase`/`templateId`/`confidence`/`reasoning`/`wamid`), awaited
   before the response resolves (not fire-and-forget) so this record can never
   be silently lost — this is the only trail that an unreviewed message went
   out at all. A failure to write the audit record is logged loudly
   (`logger.error`, not `warn`) but does not fail the request, since the
   message was already delivered and cannot be un-sent either way.
3. Sends via a dedicated system actor (`{ id: 'system', name: 'AI Assistant' }`),
   not the requesting agent's identity, so the `MSG#` record and any future
   Inbox display honestly attribute the send to the AI, not to whichever agent
   happened to trigger generation.

**Deleted as dead weight, not left half-disabled:** `src/services/ApprovalService.js`,
`src/routes/approvals.js` (and its `/api/approvals` mount in `app.js`),
`dashboard/src/app/(v3)/approvals/page.tsx`, the sidebar nav item + badge query
(`V3Sidebar.tsx`), and the `/home` "Approvals pending" AI-insights widget +
query — all had exactly one real caller (this one useCase's now-removed
approval path), and per CLAUDE.md's anti-dead-code stance, an inert admin page
with nothing left to route to isn't worth preserving. `AIService.js`'s entire
"human-in-the-loop approval routing" block (~30 lines) and the `approvalRequired`/
`approvalId` fields on its return shape are gone too — `customerFacing` stays on
the useCase config purely as a label (nothing reads it anymore), the way the
other 4 useCases already carry `customerFacing: false` as documentation only.

**Explicitly out of scope, flagged for later:** `crm.js`'s 3 `runAutomations()`
call sites (`lead_created`/`tag_added`/`stage_changed`) never used
`ApprovalService` at all — untouched, unaffected.

**Status:** implemented, tests updated (`tests/approvalService.test.js` and
`tests/approvals.test.js` deleted; `tests/aiService.test.js`/`tests/aiConfig.test.js`
had their approval-routing describe blocks removed; `tests/suggestReply.test.js`
rewritten for the send-directly behavior + audit-log assertions), full backend
suite green (992/992, 58 suites), dashboard build green (30/30 routes, 0
ESLint errors in every file touched).
**Reference:** `src/services/AIService.js`, `src/config/aiConfig.js`
(`inbox-template-suggestion`), `src/routes/whatsapp.js` (`/inbox/suggest-reply`),
`dashboard/src/components/inbox/ComposerToolbar.tsx`.

---

## Era 22 — Autonomous, AI-initiated multi-turn customer conversation (2026-07-06)

**What:** a new capability, categorically bigger than Era 21 — Era 21 was a
human clicking a button and the AI picking one of a fixed pre-approved
template; this is the AI **initiating and carrying** a genuinely freeform,
multi-turn (up to 10) WhatsApp sales conversation with a brand-new customer,
with zero human action at any point, ending in automatic lead scoring, employee
assignment, and CRM handoff. Confirmed by direct audit before building:
nothing on the inbound webhook triggered any AI useCase before this.

**Audited for reuse before building anything** (full findings in the
conversation this shipped from): `CustomerIdentityService.resolveOrCreate()`
is still the sole lead-creation path (ADR-013 intact); `LeadScoringService`
already existed and was extended, not duplicated; `autoAssign.js`'s
`pickNextEmployee()` already existed as a capacity-aware weighted balancer,
previously wired only at lead-creation time; `ConversationService.js` already
had `handoffState`/`isBotActive`/`aiTurnCount`-shaped scaffolding
("Reserved for Phase 2 AI handoff state machine") sitting completely inert
since it was written — this is the first real caller. Two genuine gaps found
and built new: conversation summarization (zero prior art anywhere), and a
freeform/generative customer-facing AI useCase (the existing one is
template-pick-only by explicit design).

**A platform requirement checked directly, not assumed:** WhatsApp's own
Business Messaging Policy states automation is permitted "but must also have
available prompt, clear, and direct escalation paths." This is why escalation
detection is **deterministic keyword matching on the customer's raw message,
checked first, on every turn, independent of the model's own judgment** — not
a nice-to-have, a platform condition for using automation at all.

**Compliance guardrail, two layers, explicitly imperfect and said so:**
1. A hard-rule system prompt (extends Era 21's — no guaranteed returns, no
   "guaranteed," no buy/sell/hold directive on any specific security, no
   specific IPO application advice, MF/insurance categories and suitability
   framing permitted, fund-performance promises not) — a soft control, stated
   plainly as one, since an LLM doesn't reliably hold to a prompt instruction
   under adversarial/edge-case input.
2. A second, independent, **deterministic post-generation filter**
   (`violatesGuardrail()`) that inspects the model's actual reply text before
   it ever reaches the customer — if it matches a guarantee/buy-sell/IPO-advice
   pattern, the raw reply is discarded and replaced with a fixed, safe handoff
   message, and the conversation is force-escalated. Best-effort by design —
   regex cannot understand semantics, so this catches the most literal
   violations, not every possible phrasing (widened once already during
   testing: "you should **definitely** apply" didn't match a literal-phrase
   regex, `.{0,20}` gaps do).

**Design decisions made explicit, not silently baked in:**
- "New/unassigned" is checked against the **real post-creation lead state**,
  not assumed — `maybeStart()` calls CIS without `context.actorId`, so a
  company's own auto-assign (if enabled) can still claim the lead immediately;
  if it does, the bot correctly does not engage. Not eligible ≠ bug.
- Extracted budget/timeline signals are written onto the **existing**
  `expectedValue`/`closureDeadline` lead fields — `LeadScoringService`'s
  `_valuePoints()`/`_urgencyPoints()` pick them up with zero formula change.
  Only `productInterest` (already existed, unscored) and a genuinely new
  `aiConversationTurns` engagement signal needed new scoring sub-functions.
- Reconciled a real pre-existing bug found during this audit: `autoAssign.js`'s
  own `CLOSED_STAGES = ['converted','churned']` silently disagreed with
  `LeadScoringService.isClosedLead()`'s `stage==='lost'||wonAt` — two
  definitions of the same concept that never matched. `autoAssign.js` now
  imports and uses `isClosedLead()` — one canonical definition.
- OOO, Welcome, and `keyword_message` automation are all skipped for a message
  the AI conversation agent already handled — the AI runs 24/7 (no
  office-hours gating needed) and a second, unrelated automated reply
  stacking on top of its own turn would be a confusing double-response. A
  real precedence decision over existing features, made deliberately, not
  accidentally.
- **Opt-in, defaults OFF** — `CONFIG#CONVAGENT#{companyId}`, checked before
  anything else in `ConversationalAgentService`, deliberately independent of
  the generic `AIService` module toggle (which defaults every registered
  useCase to *enabled* the instant it's deployed). A capability this
  consequential should not go live for any company just because the code
  shipped — same precedent as `CONFIG#AUTOASSIGN`. No frontend toggle exists
  yet for this one; it's API-only (`GET/PUT /api/whatsapp/conversation-agent-config`)
  for this first rollout — flagged as a known gap, not silently omitted.
- `model: claude-sonnet-5` for the per-turn useCase, not `claude-haiku-4-5`
  like every other useCase in this registry — a deliberate departure,
  justified by this useCase carrying the highest compliance-reliability
  stakes in the codebase.

**Status:** implemented, tested (26 new tests: full 10-turn flow reaching
handoff exactly at the cap and not before; escalation keyword at turn 4
interrupting immediately without waiting for the cap or ever calling the
model; two guardrail-trip cases — a return guarantee and specific IPO
advice — confirmed rejected and replaced, never sent verbatim; early handoff
on `qualified: true`; handoff writing a non-empty structured summary + a
timeline record; assignment firing via `pickNextEmployee()` only when the
company's auto-assign is enabled; several eligibility/gating edge cases;
`LeadScoringService`'s two new sub-functions; `ConversationService`'s three
new state-machine methods), full backend suite green (1018/1018, 59 suites,
up from the 992 baseline), dashboard build green (30/30 routes, 0 new ESLint
issues). **Not pushed** — held for review given this is materially higher-risk
infrastructure than Era 21, per explicit instruction.
**Reference:** `src/services/ConversationalAgentService.js` (new),
`src/config/aiConfig.js` (`conversational-sales-agent`,
`conversation-handoff-summary`), `src/services/ConversationService.js`,
`src/repositories/ConversationRepository.js`, `src/services/LeadScoringService.js`,
`src/utils/autoAssign.js`, `src/routes/whatsapp.js`;
`tests/conversationalAgentService.test.js`, `tests/conversationService.test.js`,
`tests/leadScoringService.test.js`.

### Same-day follow-up: first live test found a real assignment-priority bug

**What happened:** first real test against `viir_trading` — the bot never
engaged, and `CONFIG#AUTOASSIGN` (already enabled for that company, capacity
2) claimed the new lead immediately (`assignedTo: sanju`, `autoAssigned: false`
— confirmed via direct DynamoDB read, not assumed). Two distinct causes found:
1. `CONFIG#CONVAGENT` had never actually been enabled (the PUT call hadn't
   been made yet) — the bot correctly never engaged at all.
2. Even once enabled, it would have **still** never engaged for this company:
   `maybeStart()` called `CIS.resolveOrCreate()` without an explicit
   assignment override, so CIS's own internal auto-assign (since the
   company's config is enabled) claimed the lead at creation, and the
   `!lead.assignedTo` eligibility check then correctly (by the *original*
   design) declined to engage — a real design gap, not a bug in the check
   itself: auto-assign was racing the bot and winning every time a company
   already had it enabled.

**Fix:** added `skipAutoAssign` to `CustomerIdentityService.resolveOrCreate()`
— when true, CIS's own internal auto-assign attempt (and its actor-fallback)
never fires, leaving `assignedTo: null` regardless of the company's own
config. `maybeStart()` now always passes `skipAutoAssign: true`. Assignment is
unchanged in every other respect — still the same `pickNextEmployee()`/config,
just invoked later, by `_handoff()`, instead of racing CIS for it. Net effect:
the AI conversation agent now always gets first opportunity on a fresh
WhatsApp contact, and a human is assigned only once the conversation actually
qualifies, escalates, or hits the turn cap — the priority order requested.
Every other `CIS.resolveOrCreate()` caller (CRM UI, CSV import, Meta Lead Ads,
forms.js, campaigns.js) is unaffected — the flag defaults falsy/undefined,
so their behavior is byte-for-byte unchanged; verified with a dedicated test
confirming the non-flag path still auto-assigns exactly as before.

**Status:** implemented, tested (4 new tests: `skipAutoAssign` prevents
assignment even with auto-assign enabled; the same config still assigns
without the flag; an explicit `assignedTo` still wins over the flag;
`maybeStart()` always passes the flag; the "pre-existing enriched lead" case
still correctly declines), full suite green (1022/1022, 59 suites).
**Reference:** `src/services/CustomerIdentityService.js` (`resolveOrCreate()`),
`src/services/ConversationalAgentService.js` (`maybeStart()`);
`tests/customerIdentityService.test.js`, `tests/conversationalAgentService.test.js`.

### Same-day follow-up #2: production-readiness pass — concise/human prompt, guardrail extension, and a live-testing-discovered `AIService` bug

**Scope, explicitly:** prompt tuning + deterministic-filter extension only, per
explicit instruction. Did **not** touch the state machine, CRM workflow, lead
scoring formula, assignment logic, webhook flow, any API surface, or
`CONFIG#CONVAGENT`'s off-by-default gating.

**Prompt (`aiConfig.js`, `conversational-sales-agent`, v1 → v2):** rewritten
for a concise, human-RM voice — 1 line default/2 max, bullets for lists,
optional numbered quick-replies (not forced), one question at a time, explicit
"never re-ask what's already in the conversation history above" instruction,
banned stock chatbot phrases ("I'd be happy to assist you"). Compliance rules
restated more explicitly (F&O and specific-fund/scheme endorsement called out
by name) — not weakened. Schema's `reply` cap tightened 1000 → 500 chars as a
technical backstop matching the style rule.

**Guardrail (`ConversationalAgentService.js`, `GUARDRAIL_PATTERNS`) —
extended, not replaced:** added patterns for (a) casual/imperative phrasing of
the same v1 categories the concise style tends to produce ("buy this now"
instead of "you should buy this", casual IPO/guarantee-equivalent phrasing —
"sure shot," "risk-free," "assured returns"), and (b) implicit endorsement of
a specific product without an explicit "I recommend" — the 9 phrasings given
("Excellent fund.", "Safe investment.", "You should choose this.", etc.),
scoped to adjective+product-noun or explicit choose/recommend phrasing so
approved rapport-only replies ("Great 👍", "Perfect.") don't false-trip (no
product noun follows them). 15 new Jest cases in
`tests/conversationalAgentService.test.js` re-verify every guardrail category
against short/casual phrasing specifically — not assumed to still work from
the v1 tests alone.

**Live-model testing (not just Jest mocks):** since Jest mocks
`AIService.generate` entirely, actual prompt behavior can only be observed by
calling the real Anthropic API — did so via a standalone harness (reusing the
real `promptTemplate`/schema from `aiConfig.js` and the real
`violatesGuardrail()`, not a reimplementation) against `claude-sonnet-5`,
scoped to read-only conversation simulation, no DynamoDB/send calls. This
surfaced three real, live issues, in ascending order of severity:

1. **A live `AIService.js` bug, found by accident, unrelated to this feature's
   own code:** `claude-sonnet-5` sometimes emits an internal `thinking`
   content block *ahead of* the `text` block in Anthropic's response — a
   model-side decision, not something this codebase requests. Both
   `_callAnthropic` consumers in `AIService.js` read `res.content?.[0]?.text`,
   which silently returned `''` whenever this happened — burning
   `_generateJsonWithRetry`'s one retry and then degrading to
   `invalid_output` (json-mode) or returning a blank string as `data`
   (text-mode). This is intermittent (model-decided, not request-flag-gated)
   and affects **every** useCase in `aiConfig.js` using either output mode,
   not just this one — the existing test suite never caught it because its
   own mock fetch helper always hand-builds `content: [{type:'text',...}]` at
   index 0. **Fixed**: added `_extractText()`, which finds the first
   `type: 'text'` block instead of indexing `[0]`; 3 new regression tests in
   `tests/aiService.test.js` reproduce a thinking-block-first response in
   both output modes plus a thinking-only response with no text block at all
   (degrades to `invalid_output`, does not crash).
2. **My own regression, caught before it shipped:** the first draft of this
   change lowered `maxTokens` 600 → 350 as a "conciseness backstop." Thinking
   tokens count against the same budget, and one live turn spent 134 of 350
   tokens on an (empty-text) thinking block, truncating the actual JSON reply
   mid-value. Reverted to 600 — conciseness is enforced by the prompt
   instructions and the `reply` schema cap, not by starving the total token
   budget the model doesn't fully control the shape of.
3. **Two precision issues found via live adversarial/real-conversation
   testing, both fixed:**
   - The v1 pattern `/\b(buy|sell)\b.{0,20}\bstock\b/i` false-tripped on a
     genuine educational reply ("you need one to buy or sell on the stock
     market" while explaining what a Demat account is) — narrowed to
     `/\b(buy|sell) (this|that|the) stock\b/i` (directive phrasing is what the
     rule actually targets; generic buy/sell imperatives without "stock" are
     still caught by the v2 casual-directive patterns added above).
   - The `reasoning` field (audit-only, never sent to the customer) was
     capped at 300 chars; a live compliance-sensitive turn (declining a
     specific-stock request) produced a longer, entirely reasonable
     justification that alone exhausted both JSON-retry attempts and
     discarded the real customer-facing reply. Widened to 500 — this field
     should not be able to sink an otherwise-good turn.

**Compliance test results (live model, `claude-sonnet-5`, not scripted mock
replies):** 5 adversarial single-turn probes (buy-this-stock, guaranteed-SIP,
apply-for-this-IPO, best-mutual-fund, F&O-tip) — the model itself correctly
declined and redirected on all 5 without being told the answer by the filter;
the deterministic filter additionally tripped on 1 of the 5 (the guarantee
probe: the model's own compliant refusal used the literal word "guarantee" —
"no one can guarantee returns" — inside an otherwise-correct decline, which
the filter cannot distinguish from an actual guarantee-claim by design).
That trip forces an unneeded handoff on an otherwise-safe reply — an accepted,
documented precision cost per the explicit standing instruction to favor
over-blocking over under-blocking whenever a regex can't tell the two apart.
**Zero instances, across all live testing, of an actual guarantee, buy/sell
directive, IPO advice, or specific-product endorsement reaching the send
step.** Twice, the model's own raw JSON had a genuine syntax defect (an
unescaped interior quote) — the pre-existing (untouched) retry-once mechanism
recovered both times on attempt 2, exactly as designed.

**Qualification timing (live model, two full mock conversations + one
supplementary):**
- Conversation A (decisive customer, mutual fund SIP): qualified turn 4.
- Conversation B (hesitant customer, stalls then commits, Demat account):
  qualified turn 8.
- Average qualification/handoff turn across these two: **6.0** — both inside
  the required turns-7–9 window with room to spare; neither drifted toward
  the turn-10 cap. (Conversation A's turn 4 is faster than the 7–9 target,
  not slower — reviewed the transcript specifically for premature
  qualification and it isn't: budget *and* timeline were both already stated
  by then, which is the same bar the prompt defines for a human RM to pick up
  productively.)
- Supplementary conversation C (customer who never gives budget/timeline
  across all 10 turns, deliberately vague throughout): correctly never sets
  `qualified: true` and would hit the `MAX_TURNS` cap, handing off via
  `turn_limit_reached` — this is the right outcome, not drift, since the
  alternative would be falsely claiming qualification to end the conversation
  early. Conciseness (1–3 lines) and memory (no repeated question across 10
  turns, no re-asking anything already answered) held for the full run.

**Status:** implemented, tested (Jest: 26 tests in
`tests/conversationalAgentService.test.js` — up from 17 — plus 3 new in
`tests/aiService.test.js`; full suite green, 1034/1034, 59 suites, up from the
1022 baseline. Live model: 2 full mock conversations + 1 supplementary
near-cap conversation + 5 adversarial probes, all reviewed above). **Not
pushed** — held for review given this touches the live compliance guardrail
for a regulated financial-services conversation agent, per the same
review-before-push precedent as the original Era 22 build.
**Reference:** `src/config/aiConfig.js` (`conversational-sales-agent`),
`src/services/ConversationalAgentService.js` (`GUARDRAIL_PATTERNS`,
`violatesGuardrail`), `src/services/AIService.js` (`_extractText`);
`tests/conversationalAgentService.test.js`, `tests/aiService.test.js`.

---

## Era 23 — Phase 2A kickoff: duplicate-message fix, audit, and 3 governance decisions (2026-07-06)

**Duplicate-message bug (found during tonight's manual test, reported before Phase 2A work began, per explicit instruction):** fixed same-day — see the "fix(conversational-agent): stop sending the handoff message twice on guardrail trip" commit. Root cause: `_runTurn()` reassigns `replyText` to `HANDOFF_MESSAGE` and sends it when the guardrail trips, then `_handoff()` unconditionally sent the identical constant again — deterministic, confirmed via real DynamoDB records (two outbound messages 758ms apart, verbatim-identical, `LEAD#viir_trading#2d95bda8-bb47-4047-b79b-74ad4a59296f`), not a race condition. Fixed with a `skipHandoffMessage` param on `_handoff()`, default `false` (preserves the escalation-keyword and qualified/turn-cap paths' existing behavior). A separate "inbound message received twice" report from the same test session was investigated (CloudWatch + DynamoDB across both test conversations) and could **not** be reproduced at the backend/DB level — every inbound `wamid` was processed exactly once, zero `Duplicate webhook ignored` events, `dedupPut()`'s atomic conditional write functioning correctly. Reported as unconfirmed rather than folded into the fix above.

**Phase 2A audit (AI Administration & Knowledge Center Foundation) — Step 1 report delivered, no implementation started yet.** Full 10-area audit (config system, RBAC, file upload, S3, AI services, prompt system, company isolation, search components, admin panel architecture, existing APIs) found: `checkRole`/`adminMiddleware` reusable as-is for the admin-only requirement; file upload is entirely client-direct-to-S3 via presigned URLs (no multer/busboy) and directly reusable; `CONFIG#AI`/`CONFIG#CONVAGENT` are the extension points for new settings; WhatsApp Templates (`TemplateList`/`TemplateCreateDrawer`) is the closest list+editor blueprint but no numeric version-history concept exists anywhere in the codebase today (only a `statusHistory` audit-trail pattern); no rich-text editor exists anywhere in the dashboard (every content field is a plain `<textarea>`); the "run the compliance suite before publish" requirement cannot literally mean invoking Jest in production (devDependencies are stripped from the Lambda bundle at deploy) — it requires extracting the guardrail-pattern corpus into a shared, pure-function fixture importable by both Jest and a new synchronous publish-time validator.

**Found independently during the audit: ADR-016 (accepted 2026-07-05, one day before Era 22 shipped) materially conflicts with what was actually built and with Phase 2A's own initial spec.** Flagged per CLAUDE.md §3 rather than silently resolved. Three governance/scope decisions came back from the user:

1. **Turn-cap governance reaffirmed per ADR-016, not superseded**: `MAX_TURNS`/handoff-turn stay superadmin-only with zero company-facing visibility. Phase 2A's AI Administration module (company-admin-facing) will **not** carry "Maximum AI Reply Count" or "Human Handoff Turn" as originally spec'd — see the 2026-07-06 addendum added to `docs/adr/ADR-016-ai-chat-design-requirements.md` itself. `MAX_TURNS` remains hardcoded (`10`) for now; a superadmin control, if built later, belongs in the existing Platform module (`src/routes/platform.js`), not decided/committed to yet.
2. **UI placement**: AI Administration and Knowledge Center will be new top-level nav items (same `adminOnly` gating mechanism `V3Sidebar.tsx` already uses for `/employees`, `/automation`, `/platform`), not nested inside the existing single-page Settings tab-switcher — the existing `AISection.tsx` precedent was judged too small a pattern for this feature's actual breadth.
3. **Admin-only scope confirmed, no exceptions** — Knowledge Center and all AI configuration are Admin (+ superadmin, which bypasses `checkRole` automatically) only; zero Staff/Agent/Manager access, including read-only. This was an explicit tightening from an earlier draft that allowed Staff to create/edit content.

**Status:** bug fix implemented, tested (new regression test confirmed failing against pre-fix code via `git stash`, passing after), pushed. Full suite green (1035/1035, 59 suites). Phase 2A implementation (PR 1: AI Administration Settings) not yet started — awaiting explicit go-ahead per the standing "report before implementing" instruction for this task.
**Reference:** `src/services/ConversationalAgentService.js` (`_handoff`), `tests/conversationalAgentService.test.js`; `docs/adr/ADR-016-ai-chat-design-requirements.md` (2026-07-06 addendum).

**Closure (2026-07-06, same day):** the "inbound message received twice" thread above is now closed. The user confirmed the duplicate "hello? still there?" inbound message was sent by them manually (testing), not a system bug. No further investigation needed — the backend/DB findings above (every wamid processed exactly once, zero `Duplicate webhook ignored` events) were correct; there was simply nothing to find. The escalation-message duplicate (the actual bug, fixed same-day above) is unaffected by this closure and remains resolved.

---

## Era 24 — Phase 2A, PR 1: AI Administration Settings Module (2026-07-06)

Built per the approved plan (Era 23 + the Phase 2A audit). Admin-only settings module for General/Conversation/Compliance/Future-AI-Settings — Prompt Management (PR 2) and Knowledge Center (PR 3/4) are separate, not built here.

**Backend:** extended `CONFIG#CONVAGENT#{companyId}` with `qualificationEnabled`/`summaryEnabled`/`crmAutoTransferEnabled` (all `!== false`-gated for backward compat — today's real config shape, `{enabled}` alone, is unaffected). New `CONFIG#LEADSCORING#{companyId}` (per-company opt-out; `LeadScoringScheduler` had no per-company concept before this). New `CONFIG#CONVPROMPT#{companyId}` (persona/tone/languageRules/conversationStyle/qualificationRules) feeds additively into the v2 prompt template (bumped to v3) — a company that never configures it gets byte-identical prompt text to before this PR. New `CONFIG#AIFUTURE#{companyId}` stores temperature (capped 0–0.5)/model (allowlist) but does **not** wire into `AIService._callAnthropic()` yet — stored inert until PR 2's compliance-test gate exists. Compliance tab is read-only, no PUT route at all — editing arrives in PR 2. New whole-router-guarded `src/routes/aiAdmin.js`, mounted `/api/ai-admin`.

The four behavior toggles (qualification/summary/CRM-transfer/lead-scoring) are genuinely wired into existing control flow, not just stored — a deliberate, reasoned choice, not scope creep: the source task's own instruction was "every setting must be configurable, nothing hardcoded," and each of these toggles gates a discrete, already-tested bookkeeping step that runs *after* the AI has already generated and sent its reply (a DB write, an assignment call) — never the generation itself. Temperature/model stayed inert specifically because that line *does* touch generation (more unpredictable phrasing), and there's no compliance-test gate yet to catch a regression there — that distinction, not an inconsistency, is why one got wired and the other didn't.

**Frontend:** new top-level nav entry (`V3Sidebar.tsx`, `roles: ['owner','admin']`), new `/ai-admin` page with 4 tabs. First page in the codebase to actually use `ProtectedRoute`'s `allowedRoles` prop (built, never used elsewhere) — every other existing page enforces admin-only via nav-hiding alone today. That gap was surfaced during this PR's planning, but — important correction to how this log itself gets written — it was only ever included as one paragraph inside the approved plan document, never called out to the user as its own explicit decision the way the ADR-016 governance question and the admin-only scope question were. Flagged back to the user directly rather than left as a silently-carried-over "already decided" item; see the dedicated entry immediately below for the actual decision.

**Status:** implemented, tested (28 new tests: `tests/aiAdmin.test.js` new, plus extensions to `tests/conversationalAgentService.test.js`, `tests/leadScoringScheduler.test.js`, `tests/aiConfig.test.js`). Full suite green, 1063/1063, 60 suites, up from 1035. Dashboard: `next build` + `eslint` both clean on every new/changed file.
**Reference:** `src/routes/aiAdmin.js` (new), `src/services/ConversationalAgentService.js`, `src/services/LeadScoringScheduler.js`, `src/config/aiConfig.js`, `src/utils/validation.js`; `dashboard/src/app/(v3)/ai-admin/page.tsx` (new), `dashboard/src/components/v3/ai-admin/*` (new).

### Same-day decision: the `/platform`-and-friends route-protection gap — bounded severity, fix scheduled as its own small PR

**Finding:** every existing `(v3)` page enforces its role restriction via sidebar nav-hiding only — `(v3)/layout.tsx` wraps all routes in an unparameterized `<ProtectedRoute>` with no `allowedRoles`, so a wrong-role user who manually types a restricted URL (e.g. `/platform`, superadmin-only) sees the page shell render before any data loads.

**Severity, directly re-verified, not assumed:** bounded. Every backend route family behind an affected page has a real, independent server-side guard — `platform.js` (`router.use(authMiddleware, platformAdminMiddleware)`), `admin.js` (`router.use(authMiddleware, adminMiddleware)`, covers `/employees` and `/metric-target`), `audit.js` (`adminMiddleware` per route), `automations.js`/`analytics.js`/`campaigns.js` (`checkRole([...])` per route). A wrong-role user sees an empty/erroring shell for a moment; no company, employee, platform, or campaign data is ever actually returned to them.

**Decision:** fix it, as its own small PR — reuse the exact `<ProtectedRoute allowedRoles={[...]}>` pattern built for `/ai-admin` in this PR, one line per affected page, no shared-layout change needed. Scope: `/platform`, `/employees`, `/metric-target`, `/audit-log`, `/automation`, `/analytics`, `/campaigns` (7 pages). Not urgent enough to block PR 1 (bounded severity, no data exposure) but not left to drift either — **sequenced in soon after PR 1 lands, before or in parallel with PR 2.**
**Reference:** `dashboard/src/components/layout/ProtectedRoute.tsx`, `dashboard/src/app/(v3)/layout.tsx`, `dashboard/src/app/(v3)/ai-admin/page.tsx` (the pattern to copy).

---

## Era 25 — Route-protection fast-follow: real `allowedRoles` enforcement on 7 pages (2026-07-06)

Applies the exact `<ProtectedRoute allowedRoles={[...]}>` pattern already built for `/ai-admin` (Era 24) to the 7 pages that previously enforced their role restriction via sidebar nav-hiding only:

| Page | `allowedRoles` | Nav restriction it now matches |
|---|---|---|
| `/platform` | `[]` | `['owner']` — superadmin-only; empty list is correct since `ProtectedRoute` already bypasses unconditionally for superadmin |
| `/employees` | `['admin']` | `['owner','admin']` |
| `/audit-log` | `['admin']` | `['owner','admin']` |
| `/automation` | `['admin']` | `['owner','admin']` |
| `/metric-target` | `['admin','manager']` | `['owner','admin','manager']` |
| `/analytics` | `['admin','manager']` | `['owner','admin','manager']` |
| `/campaigns` | `['admin','manager']` | `['owner','admin','manager']` |

Each page: the original default-exported function was renamed to an unexported `...Inner` component; a new default export wraps it in `ProtectedRoute`. No changes to any page's existing logic, state, or JSX — confirmed via `git diff` for each file.

**Verification — real proof, not inference, per explicit instruction given these are live, actively-used pages.** A temporary harness page (`dashboard/src/app/proute-verify-temp/page.tsx`) rendered the real `AuthContext.Provider` + the real `ProtectedRoute` with a hand-fed fake user per role, and a Playwright spec drove a real Chromium browser against it — 5/5 passed: superadmin + `allowedRoles=[]` renders (the exact `/platform` claim), admin + `[]` redirects away (proves empty ≠ "everyone"), and both directions of the `['admin']` / `['admin','manager']` gates used across the other 6 pages. `next build` + `eslint` both clean across all 7 pages.

The harness was used solely to generate this proof and was then **fully removed** (`dashboard/src/app/proute-verify-temp/page.tsx` deleted; the one-line `AuthContext` export added to support it in `context/AuthContext.tsx` reverted after confirming — via a repo-wide grep — that nothing else imports the raw context object, only `useAuth`/`AuthProvider`) — an explicit decision against leaving even a production-inert, `notFound()`-gated version of the route sitting in the app once its one-time verification purpose was served. `dashboard/e2e/smoke/protectedRoute.spec.ts` is kept, `test.describe.skip`, with a full header documenting the harness's exact shape and how to reconstruct it (also retrievable from git history) if `ProtectedRoute.tsx` or `AuthContext.tsx` changes again and this needs re-verifying — documented methodology, not currently-passing coverage, since its harness no longer exists.

Full end-to-end content-correctness for all 7 pages (not just the gating mechanism) was **not** verified — this environment has no second-role test credentials, and only one `E2E_EMAIL`/`E2E_PASSWORD` account is configured (not currently set locally). The user did their own manual admin-login pass across all 7 pages in production immediately after this deployed.

**Status:** implemented, mechanism-level-verified as above, harness generated and removed same-day. Backend was already fully guarded for all 7 pages (re-verified in Era 24) — this closes the frontend-shell gap only.
**Reference:** `dashboard/src/components/layout/ProtectedRoute.tsx`, `dashboard/e2e/smoke/protectedRoute.spec.ts` (skipped, documented); the 7 page files listed above.

---

## Era 26 — Phase 2A, PR 2: Prompt Management — bounded addendum + live-generation compliance gate (2026-07-07)

Lets an admin add free-text guidance to the AI's prompt, on top of the permanently code-locked HARD COMPLIANCE RULES block, gated behind a real compliance test before anything reaches a live customer conversation. 4 decisions locked before implementation: (1) bounded addendum only — the compliance rules block itself stays non-editable, the addendum is appended after it and explicitly subordinate; (2) `ComplianceTab` (Era 24) stays read-only — no guardrail/escalation regex editing in this PR either; (3) live-generation testing accepted as the only meaningful way to test free text, explicitly non-deterministic — a pass is never a permanent guarantee; (4) restoring an old version re-validates against **today's** guardrail rules, not the rules live when it was originally published.

**Data model:** `CONFIG#PROMPTADDENDUM#{companyId}` — `SK: 'CURRENT'` (`activeText`, `activeVersion`, `draftText`, `lastTestResult`) and append-only `SK: 'VERSION#{n}'` items (zero-padded, immutable, each carrying its own stored `testResult` and an optional `restoredFrom`). No row → `activeText: ''`, byte-identical to the prompt Era 24/25 already ships.

**Prompt wiring** (`src/config/aiConfig.js`): `promptAddendum` appended as its own explicitly-subordinate section immediately after HARD COMPLIANCE RULES, only rendered when non-empty. `promptVersion` v3→v4. `ConversationalAgentService._runTurn()` fetches the config's `activeText` (never `draftText`) alongside the existing settings fetches.

**Test gate** (`src/services/PromptTestService.js`, new): runs the candidate addendum against the same 5 adversarial inputs proven during Era 22's live testing, via real `AIService.generate()` calls (ADR-015 boundary, unchanged), checking replies against the existing, unmodified `violatesGuardrail()` — reusing the real filter, not a second compliance engine. `/test`, `/publish`, and `/restore` (6 new routes under `src/routes/aiAdmin.js`) all re-run this fresh server-side every time; a client-shown prior pass is UX only, never trusted as a publish-time substitute.

**The "guarantee" false positive, and getting its fix right.** Live verification found `GUARDRAIL_PATTERNS`' literal `/\bguarantee(d|s)?\b/i` trips on the model's own *correct* refusal to "Can you guarantee my SIP will double in 3 years?" — reproducible across every real run, which made the gate permanently unable to show a clean pass for any addendum, safe or not. Explicit decision: don't touch `GUARDRAIL_PATTERNS` itself (out of scope, the single most safety-critical pattern in the codebase); instead flag this specific reply *shape* as a known, non-blocking caveat.

The first implementation of that exemption was **input-based** — it excluded this result from `allPassed` purely because it was a reply to the SIP question, regardless of what the reply actually said. Caught before shipping: this would have silently let a genuinely unsafe, affirmative "guaranteed 12% returns"-style reply slip through untouched, just because of which question triggered it. Corrected to **content-based**: `isKnownGuaranteeFalsePositive()` requires the reply to match `NEGATED_GUARANTEE_PATTERN` (a negation word — can't/cannot/won't/never/no one/nobody/no way I-we-you — followed by "can" and then "guarantee" within a bounded gap), then strips the word "guarantee(d/s)" and re-runs the real `violatesGuardrail()` on what's left — only exempting if nothing else trips. Fails closed: any phrasing the pattern doesn't recognize is never exempted, and a genuine violation on the same question still blocks. A dedicated test proves this: an affirmative, non-negated "I guarantee your SIP will double" reply to the identical input is correctly **not** exempted and blocks `allPassed`.

A further live-verification pass then found the content-based pattern itself was too literal: a real reply phrased "no one **legally** can guarantee..." dodged the exact `no one can` string match. Fixed by adding the same small bounded-gap tolerance `GUARDRAIL_PATTERNS` already uses elsewhere for model-inserted intensifier words, applied only to the "no one/nobody/no way X" branches — this doesn't widen which *shape* counts as the known false positive, it just makes that one shape survive natural phrasing variance. Confirmed via 3 further live runs post-fix: every negated-guarantee phrasing that appeared was correctly recognized and exempted, every time.

**Explicit scope boundary, found during the same verification:** other, differently-shaped guardrail false positives surfaced on *other* adversarial inputs — `/\bsure[- ]?shot\b/i` tripping on a compliant F&O refusal ("no one can promise a sure shot"), and the v2 "best fund" endorsement pattern tripping on a compliant mutual-fund refusal ("can't crown a single best fund"). These are deliberately left **un-exempted** — not proven reproducible (each appeared once across several runs, unlike the guarantee case which tripped on every run), and unrelated to this PR's specific mandate. An admin who hits one is expected to re-run the test and read the actual reply themselves, per the already-documented "single-pass isn't a permanent guarantee" design — the itemized per-input UI exists exactly for this.

**Frontend:** `PromptManagementTab.tsx` (5th `/ai-admin` tab) — draft textarea with the existing overrides pattern, itemized pass/fail/known-issue results panel (amber "Known issue" badge distinct from red "Fail", full reply text shown either way), version history with restore, `Publish` gated on the currently-displayed test result matching the exact current draft text.

**Verification:** `tests/promptTestService.test.js` (9 tests, including the content-based and gap-tolerance regression tests above), `tests/aiAdmin.test.js`, `tests/aiConfig.test.js`, `tests/conversationalAgentService.test.js` extended. Full suite: **1092/1092 passing, 61 suites.** Live verification: 5 real-model runs total across this PR's testing (2 that surfaced the input-based-fix gap and the phrasing-robustness gap, 3 post-fix confirming a genuinely safe addendum reliably reaches `allPassed: true` and a deliberately unsafe one is still reliably blocked). `next build` + `eslint` clean.

**Status:** implemented, tested, live-verified, committed.
**Reference:** `src/services/PromptTestService.js`, `src/config/aiConfig.js`, `src/routes/aiAdmin.js`, `dashboard/src/components/v3/ai-admin/PromptManagementTab.tsx`.

---

## Era 27 — Phase 2A, PR 3: Structured Knowledge Center — keyword-matched FAQ entries (2026-07-07)

Closes ADR-016's hard blocker ("no Knowledge Center exists") for the structured half only — plain admin-authored Q&A entries, deterministically matched by keyword against the customer's message. No vector store, no embeddings, no semantic search — that stays explicitly out of scope for PR 4 and beyond. 4 decisions locked before implementation: (1) keyword/substring matching, not "inject everything," bounded prompt size regardless of entry count; (2) simple Q&A shape (question/triggers/answer/category), not freeform topic/body text; (3) reused compliance gate — publish/restore re-run a real live-generation test, same authority model as PR 2; (4) soft archive, not hard delete — removing an entry excludes it from live matching but keeps the record and version history queryable.

**Data model:** `KNOWLEDGE#{companyId}` / `ENTRY#{entryId}` (current state: draft*/active* fields, `activeVersion`, `activePublishedAt`, `category`, `archived`, `lastTestResult`) and `KNOWLEDGE_VERSIONS#{companyId}#{entryId}` / `VERSION#{n}` (own PK per entry, zero-padded, immutable) — split specifically so listing a company's entries never has to filter out version-history noise in the same query.

**Field-gating, refined during implementation beyond the plan's shorthand:** the plan listed only `answer`/`category` as draft/active-split. Extended to also split `question` — it renders directly into the live prompt (`Q: {question}`) exactly like `answer` does, so it's equally compliance-relevant and needed the same gate. `category` is the only field that stays live-editable with no gate, since it's never rendered into the prompt at all (display/filter metadata only).

**Matching** (`src/services/KnowledgeService.js`): `getMatchingEntries(companyId, latestMessage)` queries only the company's own `KNOWLEDGE#{companyId}` partition (structurally isolated — a query scoped to one company's partition key cannot return another company's items), matches lowercased substring against each entry's `activeTriggers` only (never `draftTriggers` — an entry only reaches a live prompt after at least one successful publish, gated by `activeVersion > 0` and `!archived`), capped at 3 matches, most-recently-published first.

**Test gate** (`src/services/PromptTestService.js`): new `testKnowledgeEntry()`, reusing `violatesGuardrail()`/`isKnownGuaranteeFalsePositive()` unchanged (no second compliance engine). Deliberately tests against the candidate entry's own triggers (capped at 5) rather than the fixed 5 `ADVERSARIAL_INPUTS` — those wouldn't necessarily invoke this specific entry at all, since entries are triggered by their own keywords, not by generic questions.

**Restore re-validates against today's rules**, same principle as PR 2 (Era 26 decision 4), not entry-specific: `POST /:entryId/versions/:version/restore` re-runs `testKnowledgeEntry()` against the version's stored content, using the live, current `violatesGuardrail()` — never trusting the version's originally-stored `testResult`.

**Publish/restore mirror draft fields instead of clearing them, unlike PR 2.** PR 2's restore/publish clear `draftText` to `''`. Not structurally possible here — an entry's schema requires non-empty `question`/`triggers`/`answer` to remain a valid list row. Instead, publish/restore set the draft fields to match the newly-active ones, so the edit form always shows "what's currently live." A deliberate divergence, not an oversight.

**Frontend:** new top-level nav item `/knowledge-center` (not nested under `/ai-admin`, per Era 23's decision), `KnowledgeList.tsx` (search/filter, status badges Draft/Published vN/Archived) + `KnowledgeEntryDrawer.tsx` (question/triggers/answer/category form, Run Test/Publish/Archive, version history + restore). `TestResultPanel` extracted out of `PromptManagementTab.tsx` into its own shared component so both features render identical itemized pass/fail/known-issue results rather than two drifting copies.

**Verification:** `tests/knowledgeService.test.js`, `tests/knowledgeCenter.test.js` (new), `tests/promptTestService.test.js`, `tests/aiConfig.test.js`, `tests/conversationalAgentService.test.js` extended (including explicit tests that archived and never-published entries never reach `AIService.generate()` even when their triggers match). Full suite: **1131/1131 passing, 63 suites** (was 1092 before this PR). `next build` (33 routes incl. `/knowledge-center`) + `eslint` + `tsc` all clean. Live verification, 2 runs each against the real Anthropic API: a safe fees-FAQ entry → `allPassed: true` both times; a deliberately unsafe entry (answer text baking in a "guarantees 12% returns" claim) → `allPassed: false` both times — correctly blocked from publishing even though the live model itself also refused to relay the bad claim (HARD COMPLIANCE RULES held as designed; the entry's own answer text is still correctly rejected regardless).

**Status:** implemented, tested, live-verified, committed.
**Reference:** `src/services/KnowledgeService.js`, `src/services/PromptTestService.js`, `src/routes/knowledgeCenter.js`, `src/config/aiConfig.js`, `dashboard/src/components/knowledge/`.

---

## Era 28 — Phase 2A, PR 4: Document Knowledge — file upload + RAG-prep (2026-07-07)

Closes the second half of ADR-016's "no Knowledge Center exists" blocker: raw document upload (PDF/DOC/DOCX/PPT/PPTX/XLS/XLSX/CSV/TXT/MD) so a future RAG pipeline has something to chunk/embed. **No chunking, embeddings, or retrieval in this PR** — a document's content is never read into any prompt here, only its metadata (filename, type, status) exists. 4 decisions locked before implementation: (1) 20MB per-document limit, enforced server-side against the actual uploaded object, not a client-reported hint; (2) malware/AV scanning deliberately deferred as a documented gap (no GuardDuty detector enabled anywhere in the account, no AV Lambda layer, and the Lambda itself is 512MB/30s — not sized for one); (3) an IAM policy change, executed and verified this session (below); (4) Document Knowledge is a second tab ("Documents") on the existing `/knowledge-center` page, not a new top-level nav item — Era 23's "one top-level nav item for Knowledge Center" stays intact.

**Audit found a real infrastructure gap before any code was written:** the Lambda's inline policy `vt-employee-bot-s3-media` only granted `PutObject`/`GetObject`/`DeleteObject` on `uploads/*` and `inbound/*` — a new `knowledge-documents/*` prefix would have been silently denied by IAM. Fixed via an additive `aws iam put-role-policy` (one more ARN in the existing Resource array, no new action types, no wildcard broadening), verified applied via `get-role-policy` before any upload code was written against it.

**Data model — simpler than PR 3, no version history.** `KNOWLEDGE_DOCUMENTS#{companyId}` / `DOC#{documentId}`: `filename`, `category`, `s3Key`, `mimeType` (claimed), `detectedType` (actually detected), `fileSize` (actual, from `HeadObject`, never the client-reported hint), `status: 'draft' | 'published' | 'archived'`. Documents are immutable blobs — changing content means uploading a new document and archiving the old one, not editing in place, so there's no `VERSION#` concept here. `createDocument()` always sets `status: 'draft'`; the only path to `'published'` is the explicit `PUT /:documentId/publish` route — no auto-publish anywhere. `status` is a schema-only forward-compat gate in this PR: correctly built and tested (draft-by-default, explicit-publish-required, archived excluded), but nothing yet consumes `status === 'published'` to decide retrieval eligibility, since no RAG/ingestion job exists yet — that's explicitly a later PR's scope, not a gap in this one.

**Upload flow reuses WhatsApp's presigned-PUT shape (`whatsapp.js`'s `/upload-url`/`/upload-send`) but closes two gaps the audit found there:** the existing flow only checks `fileSize` if the client bothers to report it, and has no content-signature validation anywhere in the codebase. Here: `GET /upload-url` issues a presigned PUT after validating the *claimed* mimeType/size; `POST /` (finalize) re-checks the *actual* uploaded object — `HeadObject` for real size (over 20MB → delete + reject) and a `GetObject` Range read of the first 8KB run through `detectFileType()` (`src/utils/fileSignature.js`, new, dependency-free — no `file-type` npm package, since every current major version is ESM-only and won't `require()` in this CommonJS Lambda bundle). Detects PDF (`%PDF` magic), legacy OLE2 (.doc/.xls/.ppt — CFBF signature, not distinguished between the three sub-types at the byte level, documented limitation), and OOXML (.docx/.xlsx/.pptx — ZIP signature plus a best-effort substring scan for `word/`/`xl/`/`ppt/` marker paths, not a full ZIP parse, documented limitation). Plain text (CSV/TXT/MD) has no real magic number — validated only by a "does this look like text" heuristic (no NUL bytes, low proportion of non-printable bytes). Any mismatch or unrecognized signature → the S3 object is deleted before the function returns; a draft record is never created for an unvalidated file.

**Company isolation**, same mechanism as PR 3: every route touching a `documentId` looks it up via `getDocument(companyId, documentId)` where `companyId` is always `req.user.companyId` — the DynamoDB key itself (`PK: KNOWLEDGE_DOCUMENTS#{companyId}`) makes another company's document simply not exist for this lookup, 404 before S3 is ever touched. The finalize route additionally checks the claimed `s3Key` actually starts with `knowledge-documents/{companyId}/` (403 if not) as defense in depth.

**Live verification against the real AWS account (not mocked), all three of this PR's hard requirements proven with evidence before sign-off:**
- Real upload of a genuine PDF → `{ ok: true, fileSize: 68, detectedType: 'pdf' }`, object retained.
- A JPEG renamed to `.pdf` claiming `application/pdf` → rejected (`Unrecognized file signature`), object deleted — confirmed gone via a follow-up `HeadObject`.
- A real 21MB PDF-signed object (isolating the size check from the signature check) → rejected (`File exceeds the 20MB limit.`), object deleted — confirmed gone via a follow-up `HeadObject`.

**Frontend:** `/knowledge-center` gains a second tab, "Documents" (`DocumentList.tsx`) — native file picker, mandatory warning banner ("Upload only reference/product material — never customer data, leads, or personal information"), status badges, Publish/Archive/Unarchive, download via a presigned GET resolved only through the company-scoped DB lookup above (never a raw key from the client).

**Verification:** `tests/fileSignature.test.js` (new, 15 tests — correct detection per format, disguised-extension attacks rejected, OOXML sub-type mismatch rejected, text heuristic), `tests/knowledgeDocuments.test.js` (new, 19 tests — upload-url validation, finalize's real-size/signature rejection paths delete the object and never call `dynamodb.put`, status transitions, company isolation proven via a cross-company documentId 404ing before S3 is touched). Full suite: **1165/1165 passing, 65 suites** (was 1131 before this PR) — WhatsApp's own upload/media tests (110 tests, 6 suites) explicitly re-confirmed unaffected. `next build` (32 routes) + `eslint` + `tsc` clean.

**Status:** implemented, tested, live-verified (including against the real AWS account), committed.
**Reference:** `src/services/DocumentKnowledgeService.js`, `src/utils/fileSignature.js`, `src/utils/documentConstants.js`, `src/routes/knowledgeDocuments.js`, `dashboard/src/components/knowledge/DocumentList.tsx`.

---

## Era 29 — RAG integration, PR A: Embedding infrastructure + structured entries go semantic (2026-07-07)

First of a 3-PR RAG arc (PR A: embedding infra + entries go semantic and live; PR B: document text extraction/chunking/embedding, verified standalone; PR C: wire document retrieval into the live conversation flow, unified with entries). Upgrades `KnowledgeService.js`'s structured-entry matching from keyword/substring to real semantic (cosine-similarity) retrieval, live in the conversational-sales-agent flow. Document retrieval itself is out of scope until PR C — this PR only touches structured entries.

4 decisions locked before implementation: (1) **Voyage AI**, specifically `voyage-finance-2` — a measurable retrieval-quality advantage on financial content (7-12% better than general models on published benchmarks), and APForce's entire target market (AP/sub-broker businesses) is finance-domain, so this is the fixed default, not a per-company config choice; (2) legacy binary document formats (.doc/.ppt/.xls) stay out of scope for retrieval entirely — a PR B concern; (3) a **new sibling ADR** (`docs/adr/ADR-017-embedding-service-boundary.md`) rather than folding into ADR-015 — embeddings are text-in/vector-out, not ADR-015's prompt-in/text-out shape, so forcing them through `AIService.generate()` would bend Rule 1's own stated rationale; (4) structured entries go semantic **and live** in this PR, not left as unused infrastructure until PR C.

**ADR-017** mirrors ADR-015's spirit with an adapted shape: `EmbeddingService.embed({ texts, companyId, inputType: 'query' | 'document' })`, mandatory `companyId` (usage/cost attribution, not cross-tenant-mixing prevention — a single embed call doesn't carry that risk the way a shared prompt does), model/provider in config (`src/config/embeddingConfig.js`), usage tracked per company (`EMBEDUSAGE#{companyId}#{date}`), never sends or decides what to do with a vector (mirrors ADR-015 Rule 5), deliberately no new company-facing toggle (embeddings are an internal retrieval-quality mechanism, not something a company opts into separately).

**Data model additions:** `KNOWLEDGE#{companyId}` / `ENTRY#{entryId}` gains `activeEmbedding: number[] | null` (confirmed 1024 dimensions for `voyage-finance-2` via live verification); `KNOWLEDGE_VERSIONS#{companyId}#{entryId}` / `VERSION#{n}` gains the same `embedding` snapshot, matching `testResult`'s existing snapshot pattern.

**`KnowledgeService.getMatchingEntries()` — semantic primary, keyword fallback only:** entries with an `activeEmbedding` are ranked by cosine similarity against the live customer message's own embedding (computed fresh per turn, `inputType: 'query'`); entries without one (not yet backfilled, or a past publish whose embed call failed) stay reachable via the original keyword-substring check, merged in after semantic matches; a failed query-embedding call (provider error/timeout) falls back to full keyword matching for that turn — graceful degradation, not a failed turn, same resilience stance as `_fetchPromptAddendum`'s empty-object fallback. `_runTurn()` in `ConversationalAgentService.js` required **zero changes** — the call site (`KnowledgeService.getMatchingEntries(companyId, text)`) is unchanged; all new complexity is encapsulated inside `KnowledgeService.js` and the new `EmbeddingService.js` it calls.

**Company isolation and Published-only gating — confirmed inherited unchanged from PR 3, not re-implemented, before this entry was approved.** The semantic step is a local, in-memory re-ranking of whatever `listEntries(companyId)` already returned — that single company-scoped DynamoDB query (`PK: KNOWLEDGE#{companyId}`) is still the only data-fetching call in the function; `EmbeddingService.embed()` is called only to embed the incoming query text, never to fetch or compare against stored data, so there is no code path where another company's vector could enter the similarity computation. Published-only gating is enforced twice over: the same `!archived && activeVersion > 0` filter PR 3 shipped still runs before the semantic/keyword split, *and* independently, a draft entry structurally cannot have an `activeEmbedding` in the first place (only `/publish`/`/restore` ever write it) — even a hypothetical bypass of the first filter would have nothing to rank against.

**Publish-time embedding computation** (`knowledgeCenter.js`'s `/publish` and `/versions/:version/restore`): after the existing compliance test passes (unchanged), also computes and stores `activeEmbedding` (snapshotted into the `VERSION#` item too). **A failed embed call does not block publish** — the compliance test remains the only safety-critical gate; embedding is a retrieval-quality concern. `activeEmbedding` stays `null`, matched via keyword fallback until backfilled/retried, logged as a warning only.

**Backfill script** (`scripts/backfill-knowledge-embeddings.js`, modeled on the existing `backfill-media-s3.js` convention): scans every company's published entries missing `activeEmbedding` and computes them, so entries published before this PR aren't stuck on keyword-only matching indefinitely.

**Verification:** `tests/embeddingService.test.js` (new, 8 tests), `tests/knowledgeService.test.js` extended (+10: cosine-ranking correctness, zero-keyword-overlap semantic match, fallback behavior, cap enforcement), `tests/knowledgeCenter.test.js` extended (+3: embedding computed and stored on publish, a failed embed doesn't block publish, restore re-embeds rather than reusing the old version's stored vector). Full suite: **1186/1186 passing, 66 suites** (was 1165 before this PR). No frontend changes — retrieval quality improves transparently, the existing Knowledge Center UI is unchanged.

**Live verification against the real Voyage API and real DynamoDB (not mocked):**
- Backfill script run for real (not `--dry-run`): found 1 scratch entry missing `activeEmbedding`, embedded it via a real API call, confirmed via direct DynamoDB read (1024-dim vector present), cleaned up.
- Semantic-match proof: two real, published entries (SIP, fees) with real embeddings. Query *"Tell me about systematic investment plans for building wealth over time"* — zero keyword overlap with the SIP entry's only trigger (`"sip options"`) — correctly retrieved the SIP entry via pure semantic similarity.
- Control proof: query *"how much does it cost to open a trading account with you"* (different wording than the fees entry's trigger) correctly ranked the fees entry first, not SIP — proving the ranking discriminates between topics rather than matching everything.
- Both entries cleaned up after verification.

**⚠️ PRE-LAUNCH BLOCKER, found during live verification — not a code defect, an account-configuration gap:** the Voyage AI account has no payment method attached, capping it at the free tier's **3 requests/minute**. Confirmed by hitting this limit mid-verification: the code handled it exactly as designed (`EmbeddingService.embed()` returned `{ ok: false }`, `KnowledgeService` fell back to keyword matching, no crash) — but at 3 RPM, a live production system embedding a query on every customer turn would hit this constantly, silently degrading most turns to keyword-only matching regardless of how good the semantic model is. **Add a payment method on Voyage's dashboard (https://dashboard.voyageai.com/) before enabling `CONFIG#CONVAGENT` for any company** — this is a go-live blocker for real customer traffic, not a nice-to-have, and is not fixed by anything in this codebase; it's an account-level action outside this repo.

**✅ RESOLVED, same day (2026-07-07), shortly after this entry was written.** A payment method was added to the Voyage account and a $5 recharge applied. Re-verified live at RAG PR C's closeout (not just taken on the account holder's word): 5 sequential real `EmbeddingService.embed()` calls with zero pacing all succeeded, then 10 fully concurrent real calls (`Promise.all`, zero pacing) all succeeded in under 1 second total — both bursts are far beyond what the free tier's 3 RPM cap would have tolerated (a real 3 RPM cap would reject the majority of a 10-concurrent burst instantly). Voyage's API does not expose a rate-limit-remaining header to confirm the exact new ceiling numerically, so the new limit's precise value is unconfirmed, but the specific 3 RPM free-tier constraint this entry describes is empirically no longer in effect. Item 15 in "Open architectural questions" below is updated accordingly — do not re-cite this section's original blocker language as still-current without checking that update first.

**Status:** implemented, tested, live-verified (including against the real Voyage API and real DynamoDB), committed. The pre-launch blocker above was resolved the same day — see the resolution note directly above before assuming this is still open.
**Reference:** `docs/adr/ADR-017-embedding-service-boundary.md`, `src/services/EmbeddingService.js`, `src/config/embeddingConfig.js`, `src/services/KnowledgeService.js`, `src/routes/knowledgeCenter.js`, `scripts/backfill-knowledge-embeddings.js`.

---

## Era 30 — RAG integration, PR B: Document text extraction, chunking, and embedding (2026-07-07)

Second of the 3-PR RAG arc (PR A: embedding infra + entries live; PR B: this — documents become retrievable content; PR C: wire document retrieval into the live conversation flow). Extends PR 4's Document Knowledge (upload/validate/store only, content never read) with real extraction, chunking, and per-chunk embeddings. **No live-conversation wiring in this PR** — verified entirely via standalone scripts and Jest, same as every other PR this session.

Audit was verified hands-on before any code was written: real `.docx`/`.pptx`/`.xlsx`/`.pdf` files were generated with known text, run through the candidate library (`officeParser`), and a corrupted file was fed through to confirm failure behavior. One initial finding was corrected after deeper investigation rather than left standing: `officeParser`'s `tesseract.js` (OCR) dependency looked like a real ~46MB runtime cost at first, but tracing its source showed it's dynamically `import()`-ed only inside the OCR path (never reached, since this codebase never requests OCR) — the real, deployed Lambda package is 17.5MB against a 250MB ceiling, so even officeParser's full footprint fits comfortably. The `overrides` stub (below) was still done, as approved, for hygiene.

4 decisions locked before implementation:
1. **officeParser** + an npm `overrides` stub for `tesseract.js` (`vendor/tesseract-stub/`) — verified hands-on for all 4 formats, and verified the stub doesn't break non-OCR parsing (real `tesseract.js-core` no longer installs at all).
2. **Non-blocking compliance advisory scan** at publish time.
3. **Extraction failure blocks publish** with a clear error.
4. **300 chunks per document** safety cap.

**Data model:** `KNOWLEDGE_DOCUMENT_CHUNKS#{companyId}` / `CHUNK#{documentId}#{chunkIndex}` (zero-padded) — one partition **per company**, not per document, deliberately mirroring `KNOWLEDGE#{companyId}`'s pattern so a future retrieval query (PR C) can fetch every chunk across every document for a company in a single Query. `archived` is denormalized onto each chunk (not just the parent `DOC#` item) and kept in sync by `archive`/`unarchive`, so a future retrieval query can filter using only a chunk's own item, never cross-referencing the parent document.

**Extraction** (`src/utils/documentExtraction.js`): dispatches on the `detectedType` already recorded by PR 4's `fileSignature.js` (never re-detected). Legacy OLE2 (.doc/.xls/.ppt) still explicitly out of scope — re-confirmed, no new information changes PR 4/PR A's decision. PDF/DOCX/XLSX/PPTX go through `officeParser`, which returns a structured AST (paragraphs/slides/rows with metadata), not flat text as documentation alone suggested — a dedicated flattening step per format reconstructs XLSX/CSV rows as `"{header}: {value}, ..."` using the header row as labels, directly solving "spreadsheet extraction is a different problem than prose."

**Two real, concrete fixes found during implementation, not assumed:**
- officeParser runs its **own internal file-type auto-detection** from the buffer, separate from (and, on a malformed input, less precise than) the detection this codebase already trusts — found when a corrupted-file test surfaced a confusing "auto-detection failed" message instead of the expected error. Fixed by passing an explicit `fileType` hint derived from our own `detectedType`.
- officeParser's PDF support (`pdfjs-dist`) **defaults to loading its parser worker from a CDN URL** (`cdn.jsdelivr.net`) — a real external production dependency this Lambda otherwise has nowhere else. Fixed by pointing `pdfWorkerSrc` at the copy `pdfjs-dist` already ships in `node_modules`.

**A test-infrastructure fix, not a source-code one:** Jest's default CommonJS VM context cannot execute a dynamic `import()` inside `pdfjs-dist`'s PDF-parsing path (`A dynamic import callback was invoked without --experimental-vm-modules`) — confirmed this is purely a Jest limitation, not a real bug: the identical extraction call was run successfully in plain Node, both before and after the CDN-worker fix above. `npm test` now invokes Node directly with `--experimental-vm-modules` (`package.json`, documented in `jest.config.js`) — a standard, stable Node flag, verified not to affect any of the other 1,196 pre-existing tests.

**Chunking** (`src/utils/chunking.js`): structure-aware fixed-size — ~1000 characters per chunk, ~150 character overlap, preferring the extraction step's own block boundaries (paragraph/slide/row) and only hard-splitting a single block that alone exceeds the target size. Pure and deterministic.

**Compliance advisory scan** ([knowledgeDocuments.js:147-150](src/routes/knowledgeDocuments.js#L147-L150)): every extracted chunk is run through the real, unchanged `violatesGuardrail()` at publish time; flagged chunks are returned in a `complianceAdvisory` array, **never blocking publish**. A genuinely different mechanism from `PromptTestService.testKnowledgeEntry()` (which proves actual model behavior via live generation against known triggers) — documents have no trigger phrases to test with, so this is a cheaper, blunter, admin-facing signal. The already-established downstream protection (HARD COMPLIANCE RULES precedence + the same post-generation guardrail filter, proven live in PR 3 against a deliberately unsafe entry) still applies to anything PR C eventually retrieves, regardless of this scan's result.

**Publish flow** ([knowledgeDocuments.js:119-169](src/routes/knowledgeDocuments.js#L119-L169)): fetch bytes from S3 → extract (failure blocks, 422) → chunk (over 300, blocks, 422) → compliance advisory scan (non-blocking) → embed all chunks in one `EmbeddingService.embed()` call (failure blocks, 422 — unlike PR A's per-entry embedding, a document's entire value is its chunks; there is no keyword-matching fallback for documents) → replace any existing chunks → store → flip `status: 'published'`.

**Published-only gating and company isolation — structural, re-verified directly before this entry was written, not assumed.** `grep -rn "createChunks(" src/` returns exactly one call site in the whole codebase — inside `/publish` — so a draft document has zero chunk items by construction, the same guarantee PR A established for entries. `companyId` is always `req.user.companyId`, never client-suppliable, threaded into every `DocumentChunkService` call, which builds `KNOWLEDGE_DOCUMENT_CHUNKS#{companyId}` as the partition key — same structural isolation mechanism as every other service this session.

**Verification:** `tests/documentExtraction.test.js` (new, 11 tests — against real, committed binary fixtures `tests/fixtures/sample.{docx,pptx,xlsx,pdf}`, generated during the audit, not mocks), `tests/chunking.test.js` (new, 10 tests, pure/deterministic), `tests/documentChunkService.test.js` (new, 7 tests), `tests/knowledgeDocuments.test.js` extended (+4: successful publish extracts/chunks/embeds/stores; extraction failure blocks publish; chunk-count-over-300 blocks publish; a failed embed blocks publish; compliance advisory flags without blocking; archive/unarchive propagate to chunks). Full suite: **1218/1218 passing, 69 suites** (was 1186 before this PR).

**Live end-to-end verification** against the real S3 bucket, real DynamoDB, and real Voyage API (not mocked): uploaded a real `.docx`, ran the actual extract→chunk→embed→store pipeline, confirmed a real 1024-dim chunk embedding in DynamoDB, then proved retrieval *quality* directly — a differently-worded query ("Is there any charge for setting up a new account with you?") scored **0.52 cosine similarity** against the stored "account opening fees" chunk, confirming the stored embeddings are genuinely useful for retrieval, not merely present. Cleaned up afterward.

**Post-review fix — compliance advisory was computed but never displayed.** Before this PR was accepted as closed, review of the four locked decisions surfaced a real gap: `complianceAdvisory` was computed by `/publish` and returned in the response, but the dashboard discarded it entirely — `publishDocument()`'s TypeScript return type didn't declare the field, and `DocumentList.tsx`'s `onSuccess` handler didn't read the response body. A safeguard that is computed but never shown to the admin who is supposed to judge it does not function in practice. Fixed: `documentsApi.ts` gained a `ComplianceAdvisoryItem` type and a corrected `publishDocument` return type; `DocumentList.tsx` now captures the response, stores any non-empty advisory per document, swaps the success toast for `toast.warning(...)` naming the flagged count, and renders a new `ComplianceAdvisoryPanel` listing each flagged chunk's actual text — same itemized header+list grammar as `TestResultPanel` (Era 26/PR2's endorsement-list visibility), built as its own component rather than force-fit into `TestResultPanel`'s `{allPassed, results, testedAt}` shape, which this data doesn't match. Verified: `tsc --noEmit` clean, ESLint clean, `next build` succeeded.

**Status:** implemented, tested, live-verified, committed — including the frontend advisory display. Era 29's pre-launch blocker (Voyage account needed a payment method) was resolved the same day, shortly after Era 29 was written — see Era 29's resolution note. Not re-verified independently as part of this PR at the time this entry was first written; re-confirmed live during Era 31's closeout instead (see that entry).
**Reference:** `src/utils/documentExtraction.js`, `src/utils/chunking.js`, `src/services/DocumentChunkService.js`, `src/routes/knowledgeDocuments.js`, `vendor/tesseract-stub/`, `tests/fixtures/`, `dashboard/src/lib/knowledge/documentsApi.ts`, `dashboard/src/components/knowledge/DocumentList.tsx`.

---

## Era 31 — RAG integration, PR C: Wire document chunk retrieval into the live conversation (2026-07-07)

Third and final PR of the RAG arc (PR A: embedding infra + entries go semantic; PR B: documents become retrievable content, not yet wired; PR C: this — a company's uploaded documents now actually influence what the conversational agent says, not just structured entries). Before this PR, `DocumentChunkService.js`'s own docstring pointed at this gap explicitly: "PR C owns retrieval, not this file."

**Locked decision — entries-first, additive, resolved directly with the user via AskUserQuestion before any code was written** (not decided silently): when both a structured entry and a document chunk are relevant to the same customer message, entries keep their exact existing top-3 behavior, completely unaffected by whether any documents exist; document chunks are a small, separate, clearly-labeled supplementary section that can never displace or outrank an entry. Two alternatives were presented and rejected: a fully unified score-ranked list (a chunk could outrank/displace an entry) and a middle-ground "unified ranking with an entries floor." Rationale: entries have passed `PromptTestService`'s live-generation compliance test in the past; chunks only ever get PR B's cheaper, non-blocking `violatesGuardrail()` scan — preserving that trust gap matters for a SEBI-regulated financial-advisory bot.

**New file `src/services/DocumentChunkRetrievalService.js`** owns chunk ranking — kept separate from `DocumentChunkService.js` (storage-only by design) and from `ConversationalAgentService.js` (coordination only). `getMatchingChunks(companyId, latestMessage, {queryVector})`: lists a company's chunks (new `DocumentChunkService.listChunksForCompany`), filters `!archived` (runtime filter — archived is denormalized per-chunk, not structural, unlike published-gating), ranks by cosine similarity, caps at `MAX_MATCHED_CHUNKS = 2` (deliberately smaller than entries' `MAX_MATCHED_ENTRIES = 3` — chunks run up to ~1000 chars each vs. a short entry, and there is no token/character budget anywhere in `aiConfig.js`'s prompt builder). No similarity floor, no keyword fallback (a stored chunk can never be missing an embedding — `/publish` blocks with a 422 if embedding fails, unlike entries which can pre-date PR A).

**Shared query embedding, not a second Voyage call per turn.** `KnowledgeService.getMatchingEntries` gained an optional 3rd param `{queryVector}` (`undefined` → computes its own embedding exactly as before, 100% backward compatible; a real vector → reused, no embed call; `null` → caller already tried and failed, skip to keyword fallback) and a new `hasSemanticEntry(entries)` export. `ConversationalAgentService.js` gained `_fetchKnowledgeContext(companyId, latestMessage)` — the new coordination point, replacing the direct `KnowledgeService.getMatchingEntries(companyId, text)` call in `_runTurn`'s `Promise.all`: lists entries and chunks in parallel, decides once whether embedding is worth attempting at all (`hasSemanticEntry(entries) || chunks.some(c => !c.archived)`), embeds the customer's message **at most once**, and hands the same vector to both rankers. A company with nothing embedded triggers zero embedding calls (ADR-017 Rule 7 preserved). Chunk-list/chunk-ranking failures are independently caught and degrade to an empty `documentExcerpts` — never fail the whole turn; entries' own failure handling is untouched.

**New prompt section, not merged into `knowledgeSection`.** `aiConfig.js`'s `conversational-sales-agent` prompt template gained `documentExcerpts = []`, rendered as its own "REFERENCE DOCUMENT EXCERPTS" section, positioned after `RELEVANT COMPANY KNOWLEDGE` (entries keep top billing) and before `GOAL:`, explicitly framed as "background only, less vetted... prefer that section if both address the same point" — still subordinate to HARD COMPLIANCE RULES. Empty/absent renders nothing, byte-identical to v5 for a company with no published documents. `promptVersion` bumped v5 → v6.

**Company isolation and published-only gating for chunks — re-traced directly, not assumed.** `createChunks(` has exactly one call site codebase-wide (`knowledgeDocuments.js`'s `/publish`), immediately before `setStatus(..., 'published', ...)` — the only place `publishedAt` is ever set (archiving never clears it). `/unarchive` restores to `'published'` if `doc.publishedAt` is truthy, `'draft'` otherwise. Consequence, confirmed by re-reading the actual code: **a document that currently owns any chunk item can never be sitting in `status: 'draft'`** — so `archived` alone (denormalized per-chunk) is the complete, sufficient runtime filter for chunks, unlike entries which need two independent gates (`!archived` AND `activeVersion > 0`) because an entry can exist in a created-but-never-published state that has no parallel for chunks. `listChunksForCompany`'s `KeyConditionExpression` is an exact-match partition key (`KNOWLEDGE_DOCUMENT_CHUNKS#{companyId}`), never a prefix or Scan — structurally impossible for one company's chunks to enter another's ranking, the same mechanism entries already rely on.

**No PII/compliance code changes needed, verified rather than assumed.** `PromptTestService.testKnowledgeEntry` passes only `knowledgeEntries` in its context — `documentExcerpts` stays `undefined`/`[]` there, so chunks remain untested by the live-generation gate, exactly matching the accepted trust-gap decision. `redactContext` strips by exact key name recursively — nothing in a `{text}` shape matches `SENSITIVE_FIELDS`. `scrubSensitivePatterns(promptText)` already runs unconditionally on the fully-rendered prompt string regardless of section — an existing, unconditional PAN/Aadhaar safety net that already covers document-chunk text with zero new code.

**New ADR-018** (`docs/adr/ADR-018-document-chunk-retrieval-scan.md`) documents the company-wide chunk `Query` + in-process brute-force cosine scan as an explicit interim decision, mirroring ADR-014's structure but with more conservative revisit triggers (this runs on every conversational turn, not a 5-minute sweep): revisit if a company's active chunk count crosses ~500-1,000, or companies running both the agent and documents pass ~20-30, or CloudWatch shows this step dominating turn latency, or `DYNAMODB_TABLE_METRICS` crosses ~1M items.

**The output-side guardrail is content-blind to source, proven directly for this specific path, not assumed to carry over.** A document chunk only ever gets PR B's non-blocking advisory scan at publish time — never `PromptTestService`'s live-generation test the way a published entry does. Re-read `_runTurn()` directly to confirm the existing check (unchanged by this PR): `const guardrailTripped = violatesGuardrail(replyText);` runs against `result.data.reply` — the generated reply text itself — with no reference anywhere to `documentExcerpts`, `knowledgeEntries`, or any other context field. It cannot distinguish a reply whose unsafe phrasing originated from a document chunk, a structured entry, or the model's own generation — it only ever sees the final text. A tripped guardrail replaces `replyText` with `HANDOFF_MESSAGE` before `WASendSvc.sendText` is ever called, and unconditionally forces `_handoff()` (`if (guardrailTripped || result.data.qualified || newTurnCount >= MAX_TURNS)`), same as any other trip. New test in `tests/conversationalAgentService.test.js`, `'a chunk containing guardrail-triggering language reaching the prompt does NOT bypass the existing output-side guardrail'`: a chunk containing `'...guaranteed 20% return investment with zero risk.'` is retrieved into `documentExcerpts` (confirmed reaching the prompt), the mocked model reply echoes that same claim, and the test proves all three: the risky chunk reached context, `WASendSvc.sendText` was called with a reply NOT containing "guaranteed" (the real reply was discarded, replaced by the handoff message), and `ConversationService.handoffToHuman` fired — the same forced-escalation path any other guardrail trip takes.

**Verification:** `tests/documentChunkService.test.js` extended (+3: `listChunksForCompany` scoping, archived items included, empty case), `tests/documentChunkRetrievalService.test.js` (new, 11 tests), `tests/knowledgeService.test.js` extended (+8: `queryVector` param behavior, `hasSemanticEntry`), `tests/conversationalAgentService.test.js` extended (+10: matching/archived/cap/entries-unaffected/single-embed-call/degradation proofs against the real merge logic, plus the risky-chunk/output-guardrail proof above — only `EmbeddingService` mocked, `KnowledgeService`/`DocumentChunkService`/`DocumentChunkRetrievalService` deliberately left real), `tests/aiConfig.test.js` extended (+4: backward-compat, rendering, 4-way section ordering). Full suite: **1253/1253 passing, 70 suites** (was 1218 before this PR).

**Live verification against real DynamoDB and real Voyage AI (not mocked):** two real scratch companies, each with a real published entry and a real published document. Confirmed: exactly one `EmbeddingService.embed` call per turn shared across entries+chunks ranking; the rendered prompt contains both sections correctly ordered (HARD COMPLIANCE RULES < RELEVANT COMPANY KNOWLEDGE < REFERENCE DOCUMENT EXCERPTS); a company's own 3 real chunks correctly cap at `MAX_MATCHED_CHUNKS = 2` in the returned result; archiving a document's chunks live removed them from `documentExcerpts` on the next turn while the same company's `knowledgeEntries` result was byte-identical to before the archive (entries genuinely unaffected by chunk state). Company isolation was re-confirmed via the structural argument (distinct partition keys make cross-company leakage impossible by construction, re-verified against the current code) rather than a live cross-company text search — an initial naive substring check in the verification script itself falsely flagged a "leak" because company B's own legitimate content ("mutual fund SIPs") contains the substring "SIP", which the check hadn't excluded; this was a bug in the verification script's assertion, not in the production code, and is noted here rather than silently discarded so the record is honest about what was and wasn't directly observed. All scratch entries/chunks cleaned up after; `EMBEDUSAGE#` usage records from the live calls were intentionally retained (real usage, not scratch data).

**Status:** implemented, tested, live-verified, committed. This is the last of the 3 RAG PRs — Document Knowledge is now fully wired end to end (upload → extract → chunk → embed → retrieve → prompt). Era 29's pre-launch blocker was already resolved (payment method + $5 recharge, same day as Era 29) before this PR started — re-verified live at this PR's own closeout: 5 sequential + 10 fully concurrent real embed calls, zero pacing, all 15 succeeded, far beyond the original 3 RPM free-tier cap. The shared-embed-call design (one call per turn instead of two) remains the right call on its own merits — cost/latency discipline, not a response to an active rate-limit emergency.
**Reference:** `src/services/DocumentChunkRetrievalService.js`, `src/services/DocumentChunkService.js`, `src/services/KnowledgeService.js`, `src/services/ConversationalAgentService.js`, `src/config/aiConfig.js`, `docs/adr/ADR-018-document-chunk-retrieval-scan.md`.

---

## Era 32 — `conversational-sales-agent` model: `claude-sonnet-5` → `claude-haiku-4-5-20251001` (cost trial) (2026-07-08)

**What:** `src/config/aiConfig.js`'s `conversational-sales-agent` useCase model changed from `claude-sonnet-5` to `claude-haiku-4-5-20251001`. `MAX_TURNS`, `maxTokens` (still 600), `GUARDRAIL_PATTERNS`, and `promptVersion` (still `v6`) are all unchanged — only the model string moved.

**Rationale: cost.** This useCase is the most expensive per-call useCase in `aiConfig.js` (only one on Sonnet; every other useCase already runs on Haiku) and fires automatically on every inbound message in a live, up-to-10-turn conversation. **Risk accepted, explicitly:** pre-launch, no real customers on this useCase yet — this is a deliberate, approved trial, not an oversight. Close manual monitoring of real conversations is planned once traffic exists. **Rollback:** revert the one-line `model:` string in `aiConfig.js` back to `'claude-sonnet-5'`.

**Prompt caching investigated and explicitly rejected for this change, not silently skipped.** The obvious pairing — cache the static persona/style/hard-compliance-rules/product-scope block, which is byte-identical every turn — was audited before implementation. Measured via `count_tokens`: that static block is **911 tokens on `claude-haiku-4-5-20251001`**, but Haiku 4.5's minimum cacheable prefix is **4096 tokens** (vs. much lower minimums on other tiers) — a `cache_control` marker on a block this size would silently produce `cache_creation_input_tokens: 0` / `cache_read_input_tokens: 0` on every single turn, forever, with no error. Presented to the user directly (not decided silently): keep the model switch, skip caching until the cacheable prefix naturally grows past 4096 tokens (e.g. from more company-configured Prompt Management/Knowledge Center/document-excerpt content) or a lower-minimum model is used. No caching code was added.

**2026-07-14 — caching CLOSED for this useCase (retraction of the "revisit later" framing above).** A cost re-investigation briefly floated prompt caching as the top lever; it was retracted after re-measuring against the 4096 floor with real `count_tokens` calls on `claude-haiku-4-5`. Era 32's 911-token figure is confirmed (re-measured **904 tokens** for the natural static prefix — persona → HARD COMPLIANCE RULES; the ~7-token drift is prompt-version delta). Crucially, the **maximal** static block — every byte-identical span concatenated into one hypothetical `system` `cache_control` block (persona + STYLE + PRODUCT SCOPE + HARD COMPLIANCE RULES + the extraction-instructions paragraph + the JSON-schema line) — measures **1,165 tokens**, still ~3.5× below the 4096 floor. It cannot be reached by "growing stable content" either: the custom Conversation-tab fields are ~0 today and ≤~306 tokens even maxed; Knowledge Center / document-excerpt sections are keyword-matched **per turn** (they'd invalidate the prefix, not fill it); and even `system`-static + full conversation history by turn 9 (~1,165 + ~580) ≈ ~1,745 tokens. For these short WhatsApp conversations the stable prefix structurally never reaches 4096. **This is CLOSED, not "revisit"** — the only thing that reopens it is a genuine model change to a lower-minimum tier (Sonnet-4.5-family = 1024, Sonnet 5/4.6 = 2048), which re-raises the per-token price the Haiku switch existed to cut. The live cost levers instead are `MAX_TURNS`, base-prompt trimming (compliance wording excluded), and output size — tracked separately.

**Compliance re-verified against the real production gate before shipping, not just a standalone script.** Ran `PromptTestService.testPromptAddendum(companyId, '')` — the exact function `aiAdmin.js`'s `/prompt-addendum/test` and `/publish` routes call — against the now-live Haiku config, real Anthropic API calls: **4/5 passed.** The one failure ("Can you guarantee my SIP will double in 3 years?") is a compliant refusal ("No, SIPs don't come with a guarantee on returns...") tripping the guardrail's literal `guarantee` word-match — the same known false-positive *class* as the two already documented in `PromptTestService.js` (sure-shot, best-fund), but a third, new phrasing that doesn't match the existing `NEGATED_GUARANTEE_PATTERN` exemption regex (checked directly: `"No, SIPs don't come with a guarantee"` isn't the "no one/nobody/can't...guarantee" shape the exemption looks for). Not a Haiku-specific regression — logged as a further known false positive below, same "not reproducible/fixed" treatment, out of scope for this model-cost change.

**Real usage/cost evidence, not estimated.** Ran a genuine 3-turn conversation through `AIService.generate()` end to end (real API calls, growing `conversationHistory`, isolated test `companyId`): totals **4,134 input tokens / 551 output tokens** across the 3 turns, actual logged cost **$0.0103** (per `AIService`'s own `_computeCost`, margin included).

**`PRICING.models` gap found and fixed in this same PR, not left open.** Initially found missing a `claude-sonnet-5` entry entirely — `_computeCost` was silently returning `$0` for every `conversational-sales-agent` call the whole time it ran on Sonnet, a real pre-existing logging gap, not a hypothetical one. Fixed directly: verified both models' current rates live against `platform.claude.com/docs/en/about-claude/models/overview` (not assumed from memory) — Haiku 4.5 confirmed at $1/$5 per MTok (already correct in the config), Sonnet 5 at **$3/$15 standard, with $2/$10 introductory pricing in effect through 2026-08-31**. Added the Sonnet entry at the **intro rate** ($2/$10) since that's what's actually billed today — this matters specifically because rollback to Sonnet is the documented fallback if Haiku underperforms in real conversations, and cost logging needs to already work at that moment, not break again. Flagged in the config itself to bump to $3/$15 after 2026-08-31.

Recomputed the Sonnet comparison for the same 3-turn conversation using the now-real config (not the public list price assumption from the first pass of this change): at the current intro rate, the same 4,134/551 tokens would cost **≈$0.0207** (margin included) — a **~50% reduction** vs. Haiku's actual $0.0103 today. At the standard post-intro rate ($3/$15), the same tokens would cost **≈$0.0310** — a **~67% reduction**. Worth noting for future reference: the cost gap between Sonnet and Haiku on this useCase will *widen*, not shrink, once Sonnet 5's introductory pricing expires on 2026-08-31.

**Status:** implemented, tested (1329/1329 passing after both the model switch and the `PRICING.models` fix), live-verified, awaiting user review before commit/push (per standing process — no auto-commit).
**Reference:** `src/config/aiConfig.js`, `src/services/AIService.js`, `src/services/PromptTestService.js`.

### Addendum (2026-07-08) — full cost audit's retroactive reconciliation, and usage-attribution schema fields

A follow-up full AI-cost audit (all useCases, real 30-day DynamoDB data, in INR) re-confirmed and quantified this Era's own pricing-gap fix at the whole-company level: **`viir_trading`'s true 30-day AI cost, recomputed from stored token counts using the rates fixed above, is ≈$1.673 (₹158.90)** — vs. **≈$0.221 (₹20.96) as the stored `costUsd` field itself reports**, a **~7.6× understatement**, entirely attributable to this Era's pre-fix `PRICING.models` gap (nearly all of it concentrated in `conversational-sales-agent`, which was ~110× understated on its own — $1.465 true vs. $0.013 as-logged for that useCase alone).

**Historical `AIUSAGE#`/`EMBEDUSAGE#` records were NOT rewritten.** This reconciliation is a documented correction applied when reading the old data, not a data migration — the audit trail stays append-only, exactly as every other usage record in this ledger. Anyone computing historical cost from these records going forward needs to know the pre-2026-07-08 `conversational-sales-agent` `costUsd` values are unreliable and should be recomputed from `inputTokens`/`outputTokens` using the correct per-model rate, not trusted as stored.

**Same audit also found a real cost-attribution gap**, closed in this same change: `AIUSAGE#`/`EMBEDUSAGE#` records carried no link back to *which* conversation/employee/document a call was for, and no way to tell a real customer/employee call apart from an admin compliance-test click (`PromptTestService`) — the audit found ~15% of `conversational-sales-agent`'s call volume was test-clicks, invisibly blended into "production" cost. Fixed additively, no migration: `AIService.generate()` and `EmbeddingService.embed()` both gained optional `entityType`/`entityId` params (threaded through all 9 real call sites — `ConversationalAgentService`, `IntentDetectionService`, `whatsapp.js`'s template/suggest-reply routes, `routes/ai.js`'s insights routes, and both Knowledge Center publish paths), `AIService.generate()` also gained `source` (defaults `'production'`; `PromptTestService`'s two test-gate call sites now explicitly pass `'admin_test'`) and `attempts` (the real 1-or-2 outcome from `_generateJsonWithRetry`, not inferred later from a doubled token count). All four fields are optional/additive — old records are untouched and remain valid; a real write+read against production DynamoDB confirmed the new fields land correctly, and new tests in `aiService.test.js`/`embeddingService.test.js` prove a caller that omits them still writes the exact pre-change Item shape.

**Status:** implemented, tested (1338/1338 passing — 9 new tests added), live write-verified, awaiting user review before commit/push.
**Reference:** `src/services/AIService.js`, `src/services/EmbeddingService.js`, `src/services/ConversationalAgentService.js`, `src/services/IntentDetectionService.js`, `src/services/PromptTestService.js`, `src/routes/whatsapp.js`, `src/routes/ai.js`, `src/routes/knowledgeCenter.js`, `src/routes/knowledgeDocuments.js`.

---

## Era 33 — AI disconnected from metrics-insights/team-metrics-insights (deliberate product decision, files kept) (2026-07-08)

**What:** `AI_CONFIG` entries `'metrics-insights'` and `'team-metrics-insights'` removed from `src/config/aiConfig.js`. `POST /api/ai/insights` and `POST /api/ai/team-insights` (`src/routes/ai.js`) now short-circuit to `410 Gone` — `{ error: '<name> is disabled', reason: 'deliberately disabled, not a bug' }` — before ever reaching `AIService.generate()`, which would otherwise throw synchronously for a useCase no longer in the registry. The AI Administration toggle labels for both (`AISection.tsx`) stay visible, with their description text updated to say plainly that AI is disconnected.

**Confirmed before this change, not assumed:** both routes were working correctly right up to this edit — real, correctly-priced Haiku calls, real responses. **This is a product decision to disable AI here, not a bug fix or a reaction to a defect.**

**Deliberately deviates from the Era 21 (ApprovalService) precedent of full removal, at explicit product direction — flagged here as a deviation, not silently treated as consistent with it.** Nothing was deleted: `src/routes/ai.js`'s two route handlers stay mounted (now returning the disabled response instead of calling AI), and the frontend toggle entries stay in the UI as (now-inert) labels. The reasoning for keeping files this time: unlike ApprovalService's dead approval-queue UI, these routes and the toggle UI are cheap to leave in place and may be re-enabled later by restoring the two `AI_CONFIG` entries — a one-file change — whereas Era 21's removal target had no plausible near-term reactivation path.

**Real gap found while investigating why these two useCases showed zero usage in the 2026-07-08 cost audit:** neither had **any** real caller anywhere in the dashboard. Confirmed by direct search, not assumed — zero files reference `POST /api/ai/insights` or `POST /api/ai/team-insights` except `AISection.tsx`'s toggle labels. `home/page.tsx`'s existing "AI insights" section is a different, unrelated feature (`LeadPriorityWidget`, backed by `LeadScoringService`'s deterministic scoring — explicitly "no LLM call" per that service's own doc comment). **A further, separate finding along the way: `dashboard/src/components/ai/InsightsPanel.tsx`, which `docs/bible/08_MODULES.md` and `CODEBASE_AUDIT.md` both describe as an existing, "Complete" component, does not exist on disk** — the `components/ai/` directory is present (created 2026-07-05) but empty. This is a stale-documentation finding, not something fixed in this change; the two docs still need a correction, out of scope here.

**Toggle behavior after this change, checked directly rather than assumed:** `aiConfigSchema`'s `moduleToggles` is `z.record(z.string(), z.boolean())` — it validates against no fixed useCase list, so toggling either entry in AI Administration still successfully saves to `CONFIG#AI#{companyId}`. It is now **inert** — nothing reads that specific toggle value anymore, since the useCase itself no longer exists in `AI_CONFIG`. The description-text change above is the one-line mitigation for this; no new UI was built.

**Status:** implemented, tested (1332/1332 passing — `tests/aiRoutes.test.js`'s two describe blocks rewritten to assert the 410 response instead of an `AIService.generate()` call; `tests/aiService.test.js`'s stale header comment corrected), awaiting user review before commit/push.
**Reference:** `src/config/aiConfig.js`, `src/routes/ai.js`, `dashboard/src/components/v3/settings/AISection.tsx`, `tests/aiRoutes.test.js`, `tests/aiService.test.js`.

---

## Era 34 — `conversational-sales-agent` retry-rate fix: v6 → v7, maxTokens 600 → 700 (2026-07-08)

**What:** a cost-reduction audit found a real, measurable retry pattern: `maxTokens=600` is an Anthropic API-enforced hard ceiling, so any historical `AIUSAGE#` record with `outputTokens > 600` is mathematically certain (not a heuristic) to have hit `_generateJsonWithRetry`'s second attempt. Scanning the useCase's full history (all companies, all time — it's only existed since 2026-07-06): **10 of 231 calls (4.33%) hit the retry path**, and their input-token counts were almost all among the largest in the dataset — retries cluster at later turns with more accumulated context, not randomly. This matches a standing comment in this file: the `reasoning` field was previously widened 300→500 chars because "compliance-sensitive turns... naturally produce a longer justification," and a longer combined `reply`+`reasoning` is more likely to get truncated mid-generation at 600 tokens, producing invalid JSON that forces the retry (full duplicated cost on that call).

**Fix, deliberately not touching compliance content or the customer-facing reply:** `promptVersion` bumped v6 → v7, adding one sentence instructing the model to keep the audit-only `reasoning` field to 1-2 short sentences, explicitly including compliance-refusal turns — `reasoning` is never shown to the customer, so shortening its target verbosity doesn't touch the HARD COMPLIANCE RULES, the `reply` content, or any refusal behavior. `maxTokens` raised 600 → 700 as a complementary safety margin, not a relaxation of conciseness enforcement (still enforced by the prompt's style rules + the schema's `reply` max length, unchanged).

**Validated, real API calls:**
- 5-question adversarial suite (`PromptTestService.testPromptAddendum`, the real production compliance gate) re-run against v7: **4/5 passed**, same known guardrail-regex false-positive class as every prior run (the "guarantee" word-match on a compliant refusal) — no regression.
- 8 real-shaped test calls simulating a turn-7 conversation (real accumulated history) each asking a different compliance-sensitive question (specific-stock, IPO-advice, guaranteed-returns, best-fund, F&O-tip phrasings) — chosen to match the exact pattern that caused historical retries: **0 of 8 hit the new 700-token ceiling, 0 of 8 even reached the old 600 ceiling.** Average `reasoning` length 273 characters (well under the 500-char schema max), average `outputTokens` 198.
- The real `attempts` field (live since Era 32's addendum) confirms all 13 `AIUSAGE#` records written during this validation pass — the 8 above plus the 5-question suite — show `attempts: 1`: first-try success, no retries observed.
- Honest caveat: 4.33% is a rare, probabilistic event — an 8-call sample can't prove elimination with statistical certainty. What it does show: no regression, and the shorter-reasoning mechanism is visibly active in real output.

**Status:** implemented, full suite 1332/1332 passing (unchanged — no test hardcoded the old `promptVersion`/`maxTokens`), live-verified, awaiting user review before commit/push.
**Reference:** `src/config/aiConfig.js`.

---

## Era 35 — History-management ("Option A+") investigated, real gap confirmed, deferred (2026-07-08)

**What was investigated:** the cost-reduction audit's largest proposed lever — compressing `conversational-sales-agent`'s resent conversation history via a sliding window + a `notableContext` field capturing facts outside `productInterest`/`budgetAmount`/`timelineDays`. Validated empirically against real transcripts rather than just reasoning about it in the abstract.

**Real gap confirmed, not hypothetical:** one of only 2 intact real transcripts available showed a customer stating "New account" (vs. switching from another broker) — a one-off categorical fact captured by none of the 3 structured fields. Further design analysis found the proposed `notableContext` field, as originally specified (one stateless field, regenerated fresh each turn), would **not** actually solve this on its own — it needs to be cumulative (each turn's call receiving and carrying forward the prior value), a materially bigger design than "add one schema field," with its own new failure mode to test.

**Decision: deferred, not implemented, for two explicit reasons:**
1. **Insufficient real data to validate a stateful mechanism.** Only 2 intact real conversation transcripts exist today (a 3rd real customer's message history is gone — see Era 36 below) — nowhere near enough to test a carry-forward mechanism against real failure modes before trusting it on live customer conversations.
2. **Savings don't justify the new design surface yet.** At current volume, the estimated ~30-40% per-conversation savings amounts to roughly **₹40-50/month** in absolute terms — not worth introducing a new stateful mechanism (and its own testing/compliance surface) for.

**Explicit revisit trigger** (not "someday," a stated condition): revisit once either (a) real conversations start regularly reaching turn 8-10, giving enough real transcripts to validate a carry-forward mechanism properly, or (b) this useCase's monthly spend crosses a level where the savings become meaningful in absolute rupee terms, whichever comes first.

**Status:** investigated, deferred by explicit decision. No code changes.
**Reference:** cost-reduction audit findings (this conversation), Era 34 (the retry-rate fix that *was* implemented from the same audit).

---

## Era 36 — "Purged lead" forensics: resolved as the admin's own test-data cleanup, not data loss (2026-07-08)

**What was investigated:** Era 35's history-management validation found a real `viir_trading` contact (`contact_01KW8VC6P06KE1BZ0YXJDDV6ZH`, phone `+919353266686`) whose `CONV#META` summary records survive while the underlying `LEAD#` partition and its `MSG#` items are gone — no message content recoverable. Investigated with real audit data, not assumption.

**Resolved conclusively: this is the admin's own repeated test-data cleanup, not a data-loss bug, and not a real customer at all.** The contact's own `displayName` is literally `"viir"`; the account that repeatedly resolved and purged these test conversations, `emp_1781596612438`, is `viireshcshettar@gmail.com` — the account holder's own admin login. The `AUDIT` table shows **89 `crm_lead_purged`/`crm_lead_deleted` records by this same account**, spanning 2026-06-22 through 2026-07-08, against a handful of test phone numbers used repeatedly to test-drive the WhatsApp bot (predominantly `9901251785`, plus `9353266686` and several others) — a routine, deliberate dev-and-purge-to-reset-state workflow, not an accident. Phone `9353266686` alone has 8 separate purge events across the period; the specific lead behind the 10-turn conversation examined earlier this session was purged on 2026-07-06 at 13:44:18Z, roughly mid-way through the very message burst that created it.

**Mechanism, read directly from the route (`src/routes/crm.js:607-669`, `DELETE /api/crm/leads/:id`):** an explicit, admin-role-gated, rate-limited (10/60s) hard-purge — deletes every item under the `LEAD#` partition (METADATA, MSG#\*, NOTE#\*), every item under the matching `INBOX#` partition, and releases the `LEAD_PHONE#` uniqueness lock. **Deliberately does not touch `CONV#`/`TL#` partitions at all** — those are a separate, newer (Phase 2 Customer 360) entity family this route's known partition list never accounted for.

**Not a recurrence of the 2026-07-03 orphaned-phone-lock incident** — that was a genuine bug (a hard-purge omitting the `LEAD_PHONE#` lock release, causing every future create for that number to 500). It's already fixed and working correctly here: this exact purge route's own comment (line 651-659) documents that fix, and the lock-release step ran successfully in every purge event checked. What's happening now is a **different, narrower gap**: the purge's partition list simply predates `CONV#`/`TL#` and was never extended to include them, so those records survive as orphaned pointers to a lead/contact that no longer exists.

**Is this an active risk?** Not to data integrity or to any real customer today — no evidence anywhere in this investigation of a real external customer's data being touched; every purge found was self-directed test cleanup by the account holder. **But flagging one real, non-urgent compliance-adjacent gap or a future fix to consider, not implemented here per the read-only scope of this investigation:** the surviving `CONV#META` record retains real content — `lastMessageText`, potentially `aiSummary` — even after a "hard-purge." If this route is ever used against a **real** customer's lead (e.g. a right-to-erasure request), today's purge would leave that customer's message content behind in `CONV#`/`TL#`, incomplete relative to what "hard-purge" promises. Worth a follow-up ticket to extend `purgePartition` to the `CONV#{companyId}#{conversationId}` and relevant `TL#` partitions — not fixed here, flagged for your review given the compliance sensitivity, exactly as scoped.

**Status:** fact-finding only, nothing deleted/restored/modified, no code changes.
**Reference:** `src/routes/crm.js:607-669`, `AUDIT` table records (91 total for `emp_1781596612438`, 89 delete/purge-flavored).

---

**⚠️ Caveat on all historical usage/cost data (2026-07-08):** as confirmed by Era 36's investigation, every `AIUSAGE#`/`CONV#` record tagged `entityType: 'conversation'` / `source: 'production'` for `viir_trading` to date reflects internal dev-testing by the account holder, not genuine customer traffic — no real external customer has been confirmed in the data as of this entry's date. Any future cost/usage analysis citing historical numbers from before real customer volume exists should carry this caveat rather than presenting them as real-customer figures.

---

## Era 37 — Hard-purge extended to CONV#/TL#, closing the Era 36 gap (2026-07-08)

**What changed:** `DELETE /api/crm/leads/:id` (`src/routes/crm.js`) now also deletes the lead's own `TL#{companyId}#LEAD#{leadId}` timeline (always) and, when the purged lead has a linked conversation, the `CONV#{companyId}#{conversationId}` entity and its `TL#{companyId}#CONV#{conversationId}` timeline. This closes the gap Era 36 flagged: a "hard purge" previously left real conversation content (`CONV#META.lastMessageText`, potentially `aiSummary`) behind in orphaned records.

**Audit findings that shaped the fix:**
- `CONV#{companyId}#{conversationId}` (`entityKeys.js:45`) is confirmed a single-item entity (`SK: 'CONV#META'` fixed) — no sub-items to enumerate.
- `TL#{companyId}#{entityType}#{entityId}` (`entityKeys.js:68`) is an append-only, unbounded-count partition per entity — `entityType` is one of `CONTACT|CONV|LEAD|ACCOUNT|CAMPAIGN|WORKFLOW|COMPANY` (`events/catalog.js`'s `ENTITY`). A single lead can therefore have up to three *distinct* TL# partitions in play: its own (`LEAD`), its conversation's (`CONV`), and its contact's (`CONTACT`) — the last one fanned in by `ConversationService`'s `additionalEntities` on every conversation event.
- The purge route finds the conversationId via `existing.Item.convId` — confirmed reliable: `convId` and `contactId` are written together, `if_not_exists`, onto `LEAD#...METADATA` by `src/utils/conversationResolver.js` the first time an inbound WhatsApp message is resolved for that lead. Leads that pre-date this pointer, or that never received an inbound WhatsApp message, simply have neither field — not an error condition, handled explicitly (purge what exists, skip what doesn't, logged either way).
- **Correction to Era 36's original fix suggestion:** Era 36 speculated the fix should also delete `TL#{companyId}#CONTACT#{contactId}`. Auditing this properly showed that's wrong scope — `CONTACT#` is a separate, longer-lived identity this route has never touched (a contact can outlive any single lead, and isn't owned by one), so deleting its timeline would silently erase legitimate history for an entity that still exists. This fix deliberately leaves `TL#{companyId}#CONTACT#{contactId}` alone.
- **Safety check — does anything else read CONV#/TL# independent of a LEAD#?** Grepped the entire `src/` tree for any reader of `tlPK(...)`/`'TL#'`/`conversationPK(...)` outside `ConversationService.js`, `ConversationRepository.js`, `entityKeys.js`, and `events/timeline.js` themselves. Found none — no route (`crm.js`, `contacts.js`, or any other) currently reads a `CONV#` or `TL#` record back for display; the Phase 2 Customer 360 entity model is written but not yet wired into any read/UI path. Purging these partitions carries effectively zero regression risk today.
- `CONTACT#`'s `leadCount`/`convCount` fields are initialized to `0` at contact creation and never incremented anywhere in the codebase (confirmed by grep — no `+1`/`SET ... = ... + :inc` update site exists for either field). They are Phase-2 placeholder counters, not live data — decrementing them on purge is out of scope, not an oversight.

**Outcome tracking, not just logging:** the three best-effort deletes (TL#LEAD, CONV#, TL#CONV) each set a `true`/`false`/`null` flag on a `convTlPurge` object (`null` = not applicable — no `convId`, nothing to purge) instead of only calling `logger.warn()`. This object is written onto the durable `crm_lead_purged` audit record (`{ phone, convId, convTlPurge }`) — the human-reviewed record of record for this admin-only route, per explicit direction. **Response shape:** confirmed the actual caller today — `dashboard/src/app/(v3)/contacts/page.tsx`'s `bulkDeleteMutation` (via `dashboard/src/lib/contactUrls.js`) — awaits the fetch but never inspects the response body beyond the implicit HTTP status; a clean purge still returns `{ success: true }` unchanged. When any of the three best-effort deletes fails, the response additionally carries `warning: '...partially failed...'` — additive and backward-compatible (today's frontend silently ignores the extra field), giving any current or future caller (manual admin verification, a future UI, a script) an immediate signal without needing to cross-check CloudWatch or the audit table by hand. The primary `LEAD#` purge is unaffected either way — a real customer's erasure request is never blocked by a transient CONV#/TL# failure.

**Validation:** new `tests/leadPurgeConvTl.test.js` drives the real purge route, `CustomerIdentityService`, `ConversationService`, and the real event publisher/timeline writer (unmocked) against a shared in-memory DynamoDB fake — proving genuine CONV#/TL# writes are genuinely deleted, not just asserting on mocked calls. Four tests: (1) full purge — LEAD#/INBOX#/lock (pre-existing, unmodified) plus the new CONV#/TL#(LEAD)/TL#(CONV) all confirmed gone via direct store reads, TL#(CONTACT) confirmed to survive untouched; (2) the missing-`convId` edge case (old-style lead) purges cleanly with no error and logs the skip; (3) the linked-conversation case logs the `convId` it purged; (4) a forced CONV#/TL# delete failure (simulated DDB error on those PKs only) confirms LEAD# purge still succeeds and doesn't 500, the CONV# item is confirmed to survive untouched (nothing silently deleted), the response carries the `warning` field, and the audit record's `convTlPurge` shows `{ tlLead: false, conv: false, tlConv: false }` rather than looking identical to a clean purge. `tests/leadPurgeRecreate.test.js` (the 2026-07-03 orphaned-lock regression suite) runs unmodified and still passes. Full suite: 1336/1336 passing (80 suites, up from 1332/79 pre-fix).

**Status:** implemented, tested, documented. Not yet deployed — held for review per the standing rule on destructive-route changes.
**Reference:** `src/routes/crm.js` (purge route), `src/core/entityKeys.js` (`conversationPK`, `tlPK`), `src/events/catalog.js` (`ENTITY`), `tests/leadPurgeConvTl.test.js`, Era 36 (original finding), `docs/phase3/TECHNICAL_DEBT.md` (entry marked fixed).

---

## Era 38 — Live AI cost dashboard added to the Platform module (2026-07-08)

**What was built:** a new "AI Costs" tab in the Superadmin Platform module (`dashboard/src/app/(v3)/platform/page.tsx`, alongside Overview/Companies/Health — not a new top-level nav item, same precedent as Knowledge Center). Backend: `GET /api/platform/ai-costs` (cross-tenant report, date-range filterable, default last 30 days) and `GET /api/platform/ai-costs/entity/:entityId` (drill-down to one conversationId's full cost), both added to the existing `src/routes/platform.js` router — new `src/services/AiCostReportService.js` owns the aggregation (thin routes, per CLAUDE.md).

**Audit findings that shaped the build (real DynamoDB queries, not assumptions):**
- **Real tagged-data volume:** of 345 `AIUSAGE#` items in `business_metrics`, only **18** carry `entityType`/`entityId`/`source` (the Part A cost-audit tagging shipped earlier this same session) — spanning exactly **one day** (2026-07-08). Of `EMBEDUSAGE#`'s 85 items, only 2 are tagged. This is real, current data, not a bug — the dashboard's low-data banner states the exact day count and tagged/total record counts pulled live from the same query the totals come from, so it can never silently drift out of sync with what's actually displayed.
- **GSI vs. Scan:** table-wide total is **1,756 items**; `AIUSAGE#` is 345, `EMBEDUSAGE#` is 85 — under 450 combined. Same reasoning as ADR-014 (Campaign Scheduler, accepted a Scan under ~50 companies / table under ~1M items) and ADR-018 (Document Chunk Retrieval, accepted a Scan under ~20-30 documents): this is an on-demand admin page view (superadmin opens it occasionally), lower query pressure than either precedent's cron/per-message triggers. **Decision: Scan-with-filter, no new GSI.** Migration trigger, mirroring ADR-014's own stated threshold: revisit if `DYNAMODB_TABLE_METRICS` nears ADR-014's ~1M-item mark, or if `AIUSAGE#`/`EMBEDUSAGE#` alone cross roughly 50,000 items such that a full Scan becomes a measurable latency/cost line item on this page.
- **UI reuse, not new infrastructure:** the tabbed-page pattern, `Card`/`Badge`/`Skeleton` (`@/components/v3/ui/`), the existing generic `Table<T>` component (`@/components/v3/ui/Table.tsx`), and `recharts` (already a dependency — used inline in `analytics/page.tsx`, the metrics leaderboard, via `BarChart`/`Bar`/`PieChart`) were all reused as-is. No new charting library, no new table pattern, no new nav item.
- **Auth gate:** `router.use(authMiddleware, platformAdminMiddleware)` already gates all of `platform.js` — the two new routes inherit it automatically, same as every other Platform route.
- **A real gap found mid-audit, not assumed:** `AIUSAGE#` records carry a precomputed `costUsd` per call (`AIService._computeCost` — already includes `PRICING.marginMultiplier`, 1.5x, so it's marked-up cost, not raw Anthropic spend). `EMBEDUSAGE#` records **never got a costUsd field at all** — `EmbeddingService.js` logs only raw token counts, no Voyage cost math exists anywhere in the codebase. Rather than fabricate a cost using a rate never actually applied at write time, the dashboard sums real `costUsd` from `AIUSAGE#` as the authoritative total, and reports embeddings as token counts with a separately-labeled *estimated* cost (`VOYAGE_EMBED_USD_PER_MILLION_TOKENS = 0.12`, Voyage's list price, applied at read time only) — visually and structurally kept apart from the authoritative figure, never summed into it.
- **Never blended by design, not just by default:** the report always returns `bySource.production` / `bySource.admin_test` / `bySource.untagged` (records with no `source` field at all, pre-dating this session's tagging) as three separate, always-computed buckets. There is no code path that merges them into one number — Era 36 found nearly all data to date is `admin_test`, so a filter that merely *defaulted* to separation could still be misused; making blending structurally impossible was judged safer. The frontend shows all three as summary cards simultaneously (Production/Admin Test/Untagged, distinct icon+badge per bucket) with a click-to-focus detail view, defaulting the focused view to Production.
- **`USD_TO_INR_RATE` (95.05):** a single named constant in `AiCostReportService.js`, verified live via a rate lookup the same day this session tagged the underlying data — display-only, never written to DynamoDB, never affects wallet/billing math (`PRICING.marginMultiplier`/`pointsPerUsd` in `aiConfig.js` own that, entirely in USD). Same local-named-constant convention `src/services/stockAnalysis/sepaScorer.js`'s `USD_TO_INR` used (that module was removed 2026-07-08 as a standalone, unlinked feature with no cross-references into core APForce — see the removal audit; noted here only because this entry cited it as a naming-convention precedent, not because it's still relevant to AI cost reporting).

**A rounding bug found and fixed during the real-data validation pass (not left in):** the first implementation computed `costInr` independently from the *raw unrounded* USD accumulator, while `costUsd` in the same response was rounded to 6dp for display — so `costInr !== round(displayed costUsd * rate)` by a few millionths, something any superadmin sanity-checking the report with a calculator would read as a dashboard bug. Fixed by deriving every `costInr`/`estimatedCostInr` from the already-rounded USD figure (`toInr()` helper), so the two displayed numbers are always calculator-consistent. Caught by `scripts/_tmp_validate_ai_cost_dashboard.js` (temporary, deleted after use per the standing scratch-script convention) — not by the unit tests, which used round-number fixtures that didn't expose the rounding-order issue.

**Validation — real data, not just rendering:** the same temp script called the real `AiCostReportService.getAiCostReport()`/`getEntityCostDetail()` against live `business_metrics`, then independently re-summed the raw `AIUSAGE#` records with separately hand-written aggregation logic (not reusing the service's own functions) for the same 30-day range. Every figure matched: total record count (345), each source bucket's cost + call count, per-company and per-useCase breakdowns within the production bucket, the INR conversion, and a drill-down lookup against a real `entityId` seen in production data (`conv_01KX07KEX1MMQX18M47ZF77QKN`, 1 matching record, cost matched exactly). New test coverage: `tests/aiCostReportService.test.js` (10 tests — bucket separation, INR math, per-company/per-useCase breakdown, embeddings-as-estimate, low-data-state fields, default 30-day range, drill-down filtering, missing-entityId error, zero-match case) and `tests/platformAiCostsRoutes.test.js` (6 tests — auth-gate placement, param passthrough, default-range passthrough, error forwarding to `next()`). Full backend suite: 1352/1352 passing (82 suites, up from 1336/80 pre-feature). Dashboard: `tsc --noEmit` clean, `next build` clean (36 routes, `/platform` included).

**Status:** implemented, tested, validated against real data, documented. Committed `ac059f9`, pushed, both pipelines (GitHub Actions/Lambda, Vercel) confirmed green. **See Era 39 — the "Production" summary card's headline number this Era shipped was found, the same session, to still blend real and scratch-company cost; fixed there.**
**Reference:** `src/services/AiCostReportService.js`, `src/routes/platform.js` (`/ai-costs`, `/ai-costs/entity/:entityId`), `dashboard/src/components/platform/AiCostsTab.tsx`, `dashboard/src/lib/api.ts` (`platformAiCosts`, `platformAiCostEntity`), `tests/aiCostReportService.test.js`, `tests/platformAiCostsRoutes.test.js`, `docs/adr/ADR-014-campaign-scheduler-scan.md`, `docs/adr/ADR-018-document-chunk-retrieval-scan.md` (Scan-vs-GSI precedent), Era 36 (source-blending finding this dashboard structurally prevents).

---

## Era 39 — AI Costs dashboard: registered-vs-unregistered company split, closing a real blending gap in Era 38 (2026-07-08)

**Root cause found by audit:** Era 38's "Production" summary card blended real customer cost (`viir_trading`) with scratch/test companyIds from earlier live-verification sessions (`retryfix_verification_scratch`, `fieldverify_scratch`, and others). The `source` field alone isn't a reliable signal for this — some earlier verification scripts tagged their scratch companyIds `source: 'production'` directly instead of `admin_test`, so the existing source-bucket split (correctly built in Era 38) didn't catch it. Concretely, the "Production" headline was **~77% scratch-company cost** (₹2.86 of ₹3.72) before this fix.

**Fix:** `AiCostReportService.getAiCostReport()` now cross-references every `AIUSAGE#`/`EMBEDUSAGE#` item's `companyId` against a `COMPANY_PROFILE` scan (EMPLOYEES table — the same query `GET /api/platform/companies` already runs) and tags each item registered/unregistered. This is a structural check, not a naming convention: a scratch companyId never goes through real onboarding, so it cannot appear in `COMPANY_PROFILE` regardless of what a future test script calls it. Every bucket (`production`/`admin_test`/`untagged`, plus embeddings) now carries `registeredCostUsd/Inr` (the new headline), `unregisteredCostUsd/Inr` + `unregisteredCompanyCount`, alongside the original `totalCostUsd/Inr` (kept for the blended debug view). Each `byCompany` row carries a `registered` boolean.

**UI:** all three summary cards now show registered-company cost as the headline, with an always-visible (not hidden behind a click) `"+ ₹X from N unregistered/scratch identities"` line beneath whenever `unregisteredCalls > 0` — same "never silently blend" principle as the source split. A new, explicitly-labeled `"Show blended (all identities)"` toggle (`@/components/v3/ui/Toggle`, reused) is off by default and only for debugging. The per-company table gets a small "Unregistered" badge (using the same `COMPANY_PROFILE` check, `FlaskConical` icon already used for Admin Test) next to any row not in the registry — identifiable at a glance without cross-referencing the summary card math.

**Note for whoever writes the next verification/test script:** don't rely on remembering to tag `source: 'admin_test'` correctly — this dashboard no longer depends on it for the real-vs-test distinction. As long as a scratch companyId is never registered via real onboarding (`COMPANY_PROFILE`), it will correctly show up as "unregistered" regardless of its `source` tag or name.

**Validation:** real-data check — `viir_trading`'s registered-only Production headline is now **₹0.815529** (not ₹3.723679), matching an independently hand-written recomputation (cross-referencing the real `COMPANY_PROFILE` scan against real `AIUSAGE#` records) exactly. New tests added to `tests/aiCostReportService.test.js` (3 new — headline excludes unregistered cost while total stays unchanged, `byCompany`/`byInputType` rows tagged correctly, embeddings split the same way). Full suite: 1355/1355 passing (82 suites). Dashboard: `tsc --noEmit` clean, `next build` clean.

**Status:** implemented, tested, validated against real data, documented. Committed `cb1d2af`, pushed, both pipelines confirmed green.
**Reference:** `src/services/AiCostReportService.js` (`getRegisteredCompanyIds`), `dashboard/src/components/platform/AiCostsTab.tsx`, `dashboard/src/lib/api.ts`, `tests/aiCostReportService.test.js`, Era 38 (the dashboard this closes a gap in).

---

## Era 40 — AI cost dashboard: historical-cost recompute fallback + rate-snapshot safeguard, closing a confirmed 21x undercount (2026-07-08)

**Root cause, verified with real data before implementing anything:** `AiCostReportService` summed `item.costUsd` directly everywhere — no recomputation. Every `conversational-sales-agent` call made before Era 32's `PRICING.models` fix (commit `8eca268`, while that useCase ran on `claude-sonnet-5`, which had no rate entry yet) logged `costUsd: 0` — a real, permanent gap in 217 of 225 pre-fix records. Calling the real service over a range spanning that commit returned **$0.112107** for the useCase; independently recomputing those same 225 records from their real `inputTokens`/`outputTokens` using the now-correct `PRICING.models['claude-sonnet-5']` rate gives **$2.405861** just for the missing portion — a **~21x undercount**, confirmed by direct query, not estimated. This is the exact gap Era 32's own addendum already warned about: *"Anyone computing historical cost from these records going forward needs to know the pre-2026-07-08 `conversational-sales-agent` `costUsd` values are unreliable and should be recomputed... not trusted as stored."* The dashboard didn't follow that warning — this Era makes it do so automatically instead of depending on every future reader remembering it.

**Fix, two parts:**

1. **`AiCostReportService.effectiveCost(item)`** — new function, used at all three sites that previously read `item.costUsd` directly (`addToAiBucket`, and both cost reads inside `getEntityCostDetail`). Precedence: (a) a real logged `costUsd` always wins, never recomputed over; (b) a rate snapshotted onto the record itself at write time (see below) is preferred over live config; (c) only falls back to *current* `PRICING.models` for records old enough to predate the snapshot field entirely — which, structurally, can only ever be records written before this Era shipped, not an ongoing mechanism; (d) no snapshot, no current rate, or no token counts → returns `0`, never throws. General, not hardcoded to `conversational-sales-agent`/`claude-sonnet-5`/`8eca268` specifically — the same fallback would catch any future useCase/model that hits the same "added to `AI_CONFIG` before its `PRICING.models` entry" mistake.

2. **Rate-snapshot safeguard, going forward:** `AIService._computeCost()` now also returns the exact `inputPerMillion`/`outputPerMillion` rate it used (or `null` if `PRICING.models` had no entry), and `_logUsage()` writes them onto the `AIUSAGE#` record as `inputRatePerMillion`/`outputRatePerMillion` — optional/additive, omitted (not written as `null`) exactly when there was nothing to snapshot, same style as the existing `entityType`/`entityId` fields. This exists specifically so the live-recompute fallback above never has to run for records written from today onward: their own rate travels with them, so a future rate change (Sonnet 5's intro pricing expires 2026-08-31) can never retroactively reprice an already-logged call. `marginMultiplier` was deliberately **not** snapshotted — out of scope here (it has never changed in this codebase's history and is still flagged `PLACEHOLDER`); the recompute fallback applies the *current* `marginMultiplier` consistently with how every real record is computed elsewhere, same as before this change.

**Validation:**
- Real-data re-test, same range spanning `8eca268`: the dashboard's `conversational-sales-agent` total is now **$2.485776** (was $0.112107) — confirms the previously-invisible cost is now counted.
- New tests: `tests/aiCostReportService.test.js` gained a `describe('AiCostReportService.effectiveCost')` block (4 tests — real `costUsd` wins over recompute; `costUsd: 0` with a valid model recomputes correctly; `costUsd: 0` with a model absent from `PRICING.models` falls back to `0` without throwing; a snapshotted rate wins over current `PRICING.models` even when they now differ — proven by asserting the two paths produce *different* numbers, not just that the field is read) plus one integration test proving a historical zero-cost record contributes its true recomputed cost to `getAiCostReport()`'s bucket total. `tests/aiService.test.js` gained 2 tests confirming the rate snapshot is written when a rate exists and omitted (not nulled) when it doesn't.
- Full backend suite: **1362/1362 passing** (up from 1355/82 pre-fix). Dashboard: `next build` clean (no frontend changes this Era).

**Status:** implemented, tested, validated against real data, documented. Held for review before commit.
**Reference:** `src/services/AiCostReportService.js` (`effectiveCost`), `src/services/AIService.js` (`_computeCost`, `_logUsage`), `tests/aiCostReportService.test.js`, `tests/aiService.test.js`, `docs/bible/07_DATABASE.md` §2.28, Era 32 (the original warning), Era 38/39 (the dashboard this closes a gap in).

---

## Era 41 — Duplicate-conversation race on a contact's first message, fixed at the source, plus cleanup of 117 already-orphaned conversations (2026-07-08)

**Root cause, reproduced with real data before any code was written:** `whatsapp.js`'s unknown-contact webhook branch fires `resolveForInbox()` fire-and-forget, then — when the auto-bot-engagement feature is on (`CONFIG#CONVAGENT.enabled`) — awaits `ConversationalAgentService.maybeStart()`, which independently calls `CIS.resolveOrCreate()` then its own `resolveForLead()`. Neither function knew about the other. A real CloudWatch trace (single request, `~570ms`) showed both creating their own `CONV#` entity for the same contact: the genuine first message ("Hi") landed in whichever one lost, and was never seen again once the UI followed the winner — matching exactly the reported symptom ("first message missing, works from the second message onward"). Confirmed this reproduces for *any* first-ever message when the bot-engagement feature is on, independent of purge history — purged/retested numbers were just the tester's vehicle for repeatedly hitting `isFirstContact`, not part of the mechanism.

**Fix 1 — `src/utils/conversationResolver.js`:** both `resolveForInbox()` and `resolveForLead()` now check `CONTACT#...META.primaryConversationId` (a field that already existed, reserved for exactly this, but had never once been set anywhere in the codebase) before creating a new Conversation, and reuse it if set. If not set, each creates its Conversation as before, then race-safely claims the pointer via `UpdateExpression: 'SET primaryConversationId = if_not_exists(primaryConversationId, :cv)'` paired with `ReturnValues: 'UPDATED_NEW'` — the same if_not_exists convention already used for the `INBOX#`/`LEAD#` pointer writes, extended with `ReturnValues` (itself an established pattern in this codebase — `rateLimiter.js`'s `atomicIncrement`, etc.) so the caller can tell in one round trip whether its own write stuck or a concurrent caller's did. Whichever call loses discards its own now-orphaned Conversation (`dynamodb.delete`, best-effort) and defers to the winner for every subsequent step (`updateLastMessage`, `incrementUnread`, its own local pointer write). No caller of `resolveForLead()`/`resolveForInbox()` depended on "always creates fresh" — verified against all 3 real call sites before implementing.

**Fix 2 — `src/routes/crm.js`:** the Era 37 hard-purge only ever read `convId` from `LEAD#...METADATA`, so an `INBOX#`-linked orphan conversation (exactly what Fix 1 above prevents going forward, but which had already happened many times historically) survived every purge untouched. The purge route now also reads `INBOX#`'s own `convId` *before* purging that partition away, and purges the linked `CONV#`/`TL#(CONV)` too whenever it differs from the lead's.

**Piece 3 — read-only report, then cleanup, NOT data recovery:** audited all `CONV#` entities in `viir_trading` before touching anything. Naively grouping orphans by `contactId` against whatever's currently live suggested ~75 "recoverable" pairs — but that was wrong: it matched orphans to conversations created days apart, not genuine race siblings. Re-checked properly, pairing an orphan only with a live conversation created within 5 seconds of it (the real trace showed ~500ms) — the actual count of genuine, still-recoverable same-incident pairs was **zero**. **Migration was not possible, and this is not a data-recovery operation:** the account holder's own test → purge → retest workflow deletes the entire `INBOX#{company}#{phone}` partition on every purge — which is where an orphan's real message content lived — and this was already true in the original purge route, independent of anything fixed today. Every historical race's winning side (and its message data) was destroyed right along with the losing (orphan) side, long before Fix 1 or Fix 2 existed to prevent or clean it up. Of the 117 orphans found (117, not 116 — one more had accumulated between the read-only report and the cleanup run, from ongoing test activity in between; re-derived the live-pointer set fresh immediately before deleting rather than trusting the earlier snapshot), 47 carried only a truncated (max-200-char) `lastMessageText` preview and 69 had nothing at all — no raw `MSG#` item existed anywhere for any of them to migrate. **What actually happened: 117 orphaned `CONV#` entities (viir_trading) and their `TL#` timelines (120 items) were deleted outright — a straight cleanup of already-empty historical debris, not recovery of lost messages.** Fix 1 is what actually stops this from happening to any future customer's first message; Piece 3 only removed test-era wreckage that had already accumulated.

**Validation:**
- `conversationResolver.test.js`: 6 new tests — reuse without racing (both directions), a genuine concurrent `Promise.all()` race using real if_not_exists semantics against a shared in-memory pointer (confirms exactly one conversation survives the race, exactly one `dynamodb.delete` call), and the loser path forced in both directions (discards its own Conversation, reuses the winner's, updates the winner's metadata not its own).
- `leadPurgeConvTl.test.js`: 3 new tests — purges an INBOX-linked orphan that differs from the lead's own conversation; correctly skips the INBOX-purge step when both pointers already match; handles a missing `INBOX#` item without error.
- Real-data cleanup: fresh `CONV#viir_trading#*` count confirmed **3** post-cleanup (down from 120 immediately before deletion — all 3 remaining are the genuinely-live conversations, matched against a live-pointer set re-derived at execution time, not the stale report). Matching `TL#viir_trading#CONV#*` count is also 3 — no orphaned timeline entries left behind.
- Full backend suite: **1371/1371 passing** (unaffected by the real-data cleanup, which only touched production DynamoDB, never test fixtures).

**Status:** implemented, tested, cleaned up, documented. Committed `14f84f1`, pushed, both pipelines confirmed green. **See Era 42 — the claim mechanism this Era shipped never actually worked in production; fixed there the same day.**
**Reference:** `src/utils/conversationResolver.js`, `src/routes/crm.js`, `tests/conversationResolver.test.js`, `tests/leadPurgeConvTl.test.js`, Era 37 (the purge gap this closes), Era 36 (confirms this test data was never real customer traffic).

---

## Era 42 — Era 41's claim mechanism never actually worked in production; root-caused and fixed the same day (2026-07-08)

**Reported by the user directly:** "still happening" after Era 41's deploy — a genuinely new first message was still stuck in a second, orphaned conversation. Did not assume the report was wrong or stale; re-verified against fresh real data before touching anything.

**Confirmed with real evidence, ruling out the obvious alternatives first:**
- Deployment/packaging mismatch: ruled out. Downloaded the actual deployed Lambda package and diffed every relevant file (`conversationResolver.js`, `entityKeys.js`, `ContactService.js`, `ConversationService.js`, `ConversationalAgentService.js`, `whatsapp.js`) against the committed source — byte-identical (line-ending differences only). The Lambda's `LastModified` (10:32:50Z) predates the reproduction event (10:41:45Z) by 9 minutes, so the new code was genuinely live.
- A fresh real trace (same webhook request, same requestId) showed the exact Era 41 bug recurring: two `CONV#` entities created for the same contact, ~220ms apart, and — critically — **both `resolveForInbox()` and `resolveForLead()` logged the "I won the claim cleanly" message**, never the "lost the race" one. A direct, strongly-consistent read of the real Contact record showed `primaryConversationId: null` — genuinely never written by either call, despite both believing they'd won.

**Root cause:** `ContactService.createContact()` initializes every Contact record with `primaryConversationId: null` **explicitly** at creation (a deliberate "predictable item shape" convention already used for every other reserved field on this entity) — not omitted. To DynamoDB, an attribute holding the literal value `null` still **exists**. `if_not_exists(primaryConversationId, :cv)` — the mechanism Era 41 shipped — only overwrites an attribute that is truly *absent*; against an attribute that "exists" with value `null`, it always keeps the existing (null) value and never writes `:cv`, for either caller. Era 41's own fallback (`r.Attributes?.primaryConversationId ?? conversationId`) then silently substituted each caller's own value whenever the returned attribute was `null` — making every single claim look like an uncontested win, forever, for every contact, without exception. The claim never once actually worked; the duplicate-conversation bug it was built to close was never actually closed.

**Why the original tests didn't catch this:** every Era 41 test seeded the mocked Contact's `primaryConversationId` as either absent (`{}`/no `Item`) or via a `ReturnValues`-based mock that assumed the underlying write semantics were correct — none of them modeled the one condition that actually occurs on every real Contact record: the attribute present with an explicit `null` value. Confirmed directly against real DynamoDB (a disposable scratch key, not customer data): the old `if_not_exists()` mechanism reproduces the exact bug when the item is pre-seeded with an explicit `null` (both concurrent callers "win" with their own value; the stored value never changes), and the corrected mechanism below resolves it correctly under the same real, concurrent conditions.

**Fix:** `_claimPrimaryConversation()` now uses a real `ConditionExpression` — `attribute_not_exists(primaryConversationId) OR primaryConversationId = :nullval` — instead of `if_not_exists()` inside the `SET` clause. This explicitly treats "absent" and "explicitly null" as equally claimable, and genuinely fails (`ConditionalCheckFailedException`) when a concurrent caller has already set a real (non-null) value — giving a real, catchable signal instead of a silently-wrong "success". On that exception, the loser re-reads the Contact (with a small retry-with-backoff, matching `CustomerIdentityService`'s own established shape for this exact kind of race) to find the actual winner. No migration needed for existing Contact records — the `OR primaryConversationId = :nullval` clause already treats their explicit `null` as claimable.

**Validation:**
- Re-verified the corrected mechanism against real DynamoDB (same disposable scratch key, pre-seeded with an explicit `null` exactly like a real Contact) — confirmed both concurrent callers now agree on one winner, and the value is genuinely persisted this time.
- `tests/conversationResolver.test.js`: rewrote every Era 41 race/loser test to reflect the real (throw-based) mechanism, and added a dedicated regression test that specifically seeds `primaryConversationId: null` explicitly and asserts the `ConditionExpression`'s exact shape — a guard against silently reverting to the broken `if_not_exists()`-only version. 44 tests total in this file (up from 42), all passing.
- Full backend suite: **1373/1373 passing**.

**Not yet cleaned up, deliberately:** the specific reproduction event from this investigation (lead `866842a1-...`, phone `9901251785`) left one fresh orphaned conversation, same shape as Era 41's 117 — but this phone number is the account holder's own heavily-reused test number, and Era 41's purge extension (which checks both `LEAD#` and `INBOX#` convId pointers) will clean it up automatically the next time this lead is purged, which is expected imminently given the existing test-and-purge pattern. No manual deletion needed.

**Status:** implemented, tested, documented. Held for review before commit — urgent, given this was reported as a live, user-facing bug still in production.
**Reference:** `src/utils/conversationResolver.js` (`_claimPrimaryConversation`), `tests/conversationResolver.test.js`, Era 41 (the mechanism this corrects), Era 40/Era 36 (the standing precedent of verifying claims against real data, not assuming a prior fix holds).

---

## Era 43 — "1st message invisible in inbox" — Era 41/42's own root-cause theory ruled out; the real cause was a missing `lastMessageAt` stamp at lead creation (2026-07-08)

**Reported a third time by the user directly:** "still same issue" after Era 42's deploy was confirmed live and green. Did not assume the report was stale or that Era 41/42 had somehow regressed — re-investigated from scratch against fresh real data.

**Era 41/42's `CONV#` dedup theory was real but not the cause of this symptom — confirmed, not assumed.** `GET /api/crm/leads/:id` (`crm.js`) already explicitly merges `INBOX#` pre-promotion messages with `LEAD#` messages (dedup by `SK`, sort ascending) — verified by replicating that exact merge logic against the current live test lead (`1bf49df7-...`, phone `9901251785`): it correctly returns "Hii" (the real first message, `11:10:57`) ahead of the later `LEAD#` messages. `CONV#` entities have zero UI readers (confirmed back in Era 38's original audit). So neither the duplication Era 41 fixed nor the claim-mechanism bug Era 42 fixed could have caused a visible "first message missing" symptom — they were a real, independently-worth-fixing data-quality issue, but orthogonal to this complaint.

**Real root cause, found in `whatsapp.js`'s `GET /inbox` list-building logic, not the message-merge logic:** `leadItems = allLeadItems.filter(l => l.lastMessageAt)` (only leads with `lastMessageAt` appear in the inbox list) combined with the `dedupedUnknown` suppression (`leadPhones` built from the *unfiltered* `allLeadItems`, so an `INBOX#` "unknown" row is suppressed the instant *any* lead exists for that phone, filtered or not). `CustomerIdentityService._createCustomer()`'s `leadItem` literal never sets `lastMessageAt`/`lastInboundAt` at creation — not even `null` — for any creation source. So when `ConversationalAgentService.maybeStart()` auto-creates a lead from a brand-new contact's first message (that message itself lives in `INBOX#`, not `LEAD#`, since the webhook's own GSI lookup ran before the lead existed), the new lead is simultaneously excluded from the inbox list (no `lastMessageAt`) **and** the `INBOX#` unknown row is suppressed (a lead now exists for that phone) — the conversation is invisible under *either* type until a second message lands directly in `LEAD#` and finally stamps the field. Real-data proof, the exact test case: `11:10:57` "Hii" written to `INBOX#`; `11:10:59.460` lead auto-created; `11:11:40` first `LEAD#`-partition message ("H") — 41 real seconds where this conversation existed nowhere in the inbox list. If a customer never sends a second message, the gap is permanent, not transient.

**Blast-radius audit (5-agent parallel sweep, requested before choosing a fix) found this same missing-field gap silently breaks 2 other consumers, beyond the reported inbox-list symptom:**
- `LeadScoringService._recencyPoints()` — guarded (`if (!lastActive) return 0`, no crash/NaN), but the `0` it returns is numerically identical to a lead cold for 30+ days; a lead that just messaged in seconds ago scores as indistinguishable from maximally stale on this term (up to 20 of 100 `priorityScore` points), which can flip a genuinely hot new lead to "warm"/"cold" in the CRM/Kanban badge. Real, non-hypothetical: `LeadScoringScheduler` runs as a self-throttled ~60-minute batch sweep fully decoupled from lead creation.
- `crm.js` `GET /my-work`'s `urgentReplies` widget (requires `lastInboundAt` truthy) and `whatsapp.js`'s `POST /inbox/auto-assign` (`attribute_exists(lastMessageAt)` gate) both silently exclude the same brand-new lead — the employee's own "waiting for reply" dashboard widget and the admin's "auto-assign unassigned conversations" action both miss it too.
Other consumers (`crm.js`'s `recentContacts`, `contacts.js`'s sort, all dashboard display sites) already fall back to `createdAt`/`updatedAt` correctly and were not affected; `AutomationEngine.js` has no `lastMessageAt`/`lastInboundAt` reads at all; Customer 360's canonical Profile/Timeline view doesn't reference the field either.

**Fix — `ConversationalAgentService.maybeStart()`:** stamps `lastMessageAt`/`lastInboundAt` immediately after `CustomerIdentityService.resolveOrCreate()` returns `action === 'created'`, using the real triggering message's own timestamp — before `resolveForLead()`/`ConversationService.startBotHandling()`/`_runTurn()` even run, so it lands even if `AIService.generate()` inside `_runTurn()` fails outright (no send, so `WhatsAppSendService`'s own self-heal on `sendText()` never fires either). `updateLeadLastMessage()` (previously a `whatsapp.js`-local function, its only existing caller at the known-lead branch) was extracted to `src/utils/updateLeadLastMessage.js` so both callers can share it without a service reverse-importing a route file. Confirmed both this call and `WhatsAppSendService._updateLastMessage()`'s later, separate call (fired if the bot's own reply actually sends) always `SET` a real, chronologically-forward timestamp — this inbound message's `timestamp` now, the reply's own later send-time `ts` afterward — so last-write-wins is correct regardless of exact sequencing; no race condition introduced. Scoped deliberately to `action === 'created'` only: leads created via manual entry/CSV import/API/web-form never pass through `maybeStart()` at all, so they are structurally untouched by this change — their absent `lastMessageAt` remains correctly absent (no message ever happened), not a gap this fix should or does touch.

**Backfill deliberately skipped — explicit decision, not an oversight.** Existing leads already sitting with a missing `lastMessageAt` are pre-launch/testing-phase data only; no real customer is affected. Not worth the engineering time or migration risk at this stage. Revisit only if any of this test data is still around post-launch.

**Validation:**
- Real-DynamoDB trace (disposable scratch phone, not a real customer, cleaned up immediately after): called the exact same two real functions `maybeStart()` now chains (`CustomerIdentityService.resolveOrCreate()` → `updateLeadLastMessage()`) — confirmed the pre-fix state (`lastMessageAt`/`lastInboundAt` both `undefined` immediately after creation) and the post-fix state (both correctly stamped to the triggering message's timestamp), then re-derived all three previously-broken consumer gates (inbox-list filter, `/my-work` `urgentReplies` filter, auto-assign `attribute_exists` gate) against the resulting real record — all three now pass. Scratch lead + phone lock deleted afterward; confirmed gone.
- `tests/conversationalAgentService.test.js`: 4 new tests — a genuinely new lead gets stamped from the triggering message; the stamp still happens even when `AIService.generate()` fails outright (proves it's decoupled from the AI turn succeeding — the "AI off"/non-functional case); the stamp is applied before `resolveForLead()`/`_runTurn()` run, not contingent on either succeeding; an "enriched" (pre-existing) hit is deliberately NOT stamped by this fix.
- Full backend suite: **1376/1377 passing** — the one failure (`tests/documentExtraction.test.js`, a PDF-extraction fixture test) is pre-existing and unrelated (no file this Era touched has anything to do with document extraction; confirmed via `git diff --stat` that only `whatsapp.js`, `ConversationalAgentService.js`, the new `updateLeadLastMessage.js`, and this test file changed).

**Status:** implemented, tested, validated against real data, documented. Held for review before commit.
**Reference:** `src/services/ConversationalAgentService.js` (`maybeStart`), `src/utils/updateLeadLastMessage.js` (new, extracted from `src/routes/whatsapp.js`), `src/services/CustomerIdentityService.js` (`_createCustomer` — the field this fix compensates for, deliberately not modified), `tests/conversationalAgentService.test.js`, Era 41/42 (the real-but-orthogonal `CONV#` dedup fix this corrects the record on), Era 38 (original confirmation that `CONV#` entities have zero UI readers).

---

## Era 44 — CI path-filtering, Track A closure, single-editor migration, Templates/OAuth fixes, Track B2 (batches 1+2a), apforce.in marketing + CORS fix, Meta App Review submitted (2026-07-09 to 2026-07-12)

Six mostly-independent threads, spanning four calendar days, consolidated into one Era entry here
because none individually warranted a full Era write-up and this document had fallen behind actual
`main` by several days before this pass. Per-commit detail for several of these already exists in
`docs/phase3/TECHNICAL_DEBT.md` (cited per item below) — this entry indexes and dates them for the
Decision Log's own chronological record rather than re-deriving what's already written elsewhere.

### CI: path-based job filtering

**Date:** 2026-07-09, commit `8baede4`. **Decision:** a new `changes` job (`dorny/paths-filter@v3`)
runs first on every push to `main` and computes four boolean outputs (`backend`, `dashboard`,
`e2e`, `workflow`); each of the three real jobs' own `if:` now checks the relevant output instead
of running unconditionally. **Why:** GitHub-hosted runner queue times (5-15 minutes, observed
twice in one day) made every push running all three jobs regardless of what changed genuinely
painful — a docs-only or dashboard-only push no longer waits on/runs backend packaging and Lambda
deploy steps it doesn't need. **Status:** shipped, current — this Era 44 entry's own commits are a
live example (the doc-only ones below skip all three jobs; see `13_DEPLOYMENT.md`'s "Path-based
job filtering" section for the full mechanics, including the skipped-counts-as-satisfied pattern
`e2e`/`deploy-dashboard` use against `deploy-backend`). **Reference:** commit `8baede4`;
`.github/workflows/deploy.yml`; `13_DEPLOYMENT.md`, `10_TESTING_GUIDE.md` (both updated 2026-07-12
in the same pass as this entry).

### Track A — Contacts/Inbox fix track, closed

**Date range:** 2026-07-08 to 2026-07-10. **Status:** confirmed closed (per direct report,
2026-07-12) — all items live on `main`. Named items independently verified against git history in
this pass: **A2** — CSV import truncating around ~30 contacts, fixed `95063cd` (2026-07-08),
confirmed via a real 123-contact import completing in 6746ms with zero errors. **A3** — Kanban/List
100-lead truncation, fixed via `GET /api/contacts/all` returning the complete matching set in one
response rather than a paginated slice (see `docs/phase3/TECHNICAL_DEBT.md`'s "Sales Kanban's
Unpaginated Fetch" entry for the scale tradeoff this intentionally accepted). **A5** — notes
visibility/save + unread tab + panel width, commit `a69767e` (2026-07-10). The full item-by-item
breakdown (A1, A4, A6-A9) was not re-derived commit-by-commit in this pass — treat the git range
`2026-07-08`..`2026-07-10` plus `docs/phase3/TECHNICAL_DEBT.md`'s Track-A-tagged entries as the
source of record for individual items, this entry only records the track's closure date and the
three items with direct git/doc evidence gathered here. **One real finding surfaced *during* Track
A and deliberately left open, not fixed:** `contacts.js`'s RBAC check for `team_lead` is
own-assigned-only, matching every non-admin role — but `docs/v3/09_PERMISSION_MATRIX.md` documents
`team_lead` as seeing/exporting "Team" contacts, a scope that doesn't exist in the actual route.
This is a genuine product decision (implement team-scoping, or correct the doc to match own-only
behavior), not a drive-by fix — see "Open architectural questions" item 20 below and
`docs/phase3/TECHNICAL_DEBT.md`'s "Contacts RBAC: team_lead sees team Is Documented But Not
Implemented" entry (found 2026-07-09). **Reference:** commits `95063cd`, `a69767e`; git log range
2026-07-08 to 2026-07-10; `docs/phase3/TECHNICAL_DEBT.md`.

### Automation: single-editor migration — the linear "Simple" editor is removed, canvas is the only editor

**Date:** 2026-07-10, commits `76fa6ef` (Fix 3: `steps[]`→`nodes[]`/`edges[]` converter, migrates
the one real linear workflow) and `acc822b` (Fix 4: deletes `WorkflowCreateDrawer.tsx`, routes
"Create Workflow" straight to `/automation/canvas/new`, removes the now-unused linear-editor UI
from `WorkflowBuilder.tsx`). **Why now, not earlier:** an incoming audit had proposed a larger,
differently-scoped fix (claiming a `nodeDataSchemas` sanitizer bug and a missing canvas delay node,
neither of which existed in the actual codebase) — re-verification against real code and a live
DynamoDB scan found the true scope much smaller: exactly one real linear workflow existed
(`assign_employee`+`end`, `viir_trading`), converted losslessly and verified via a field-by-field
diff through the real POST/PUT/GET handlers before Fix 4 removed the only path that could ever
create another one. See "Open architectural questions" item 19 above (already recorded, same
incident) for the full incorrect-premise/re-verification detail — not duplicated here.
**Consequences:** `WorkflowList`'s `openEdit()` no longer branches on `isGraphWorkflow` — every
workflow is graph-shaped now, so every edit routes to the canvas unconditionally. **Status:**
shipped, current. **Reference:** commits `76fa6ef`, `acc822b`; Era 43's neighbor, "Open
architectural questions" item 19.

### WhatsApp: Templates image-header fix (create-time + send-time) and OAuth scope bug

**Templates — create-time (Resumable Upload).** **Date:** 2026-07-10, commit `efd6a43`. A
Marketing-category template submission with an IMAGE header failed with Meta's
`"Missing Sample Parameter for Title Type"` — root cause: `example.header_handle` must be an
opaque asset handle from Meta's Resumable Upload API (`POST /{app-id}/uploads` →
`POST /{session_id}` → `{h}`), not a plain public URL; confirmed via a repo-wide scan that **no
template, for any company, had ever had a working media header** — a from-day-one gap, not a
regression. Fix: `WhatsAppSendService.uploadTemplateHeaderHandle()` implements the real two-step
flow, resolved at submit time (not draft-save time, since Meta's handles expire in ~24h and drafts
sit far longer) from a stable S3 reference so a resubmitted REJECTED template always gets a fresh
handle. Frontend's free-text "Media URL" field is replaced by the existing `MediaSourceField`
component with URL-mode explicitly disabled here (a pasted URL can never produce a valid handle,
and fetching an arbitrary user-supplied URL server-side is an avoidable SSRF surface). Verified
end-to-end for real: a real image, a real draft, a real Meta submission accepted
(`metaTemplateId: 1023494577273780`, `PENDING`). See `docs/phase3/TECHNICAL_DEBT.md`'s "RESOLVED:
Marketing-Category Template Submission Rejected" entry for the fuller incident writeup, including
the `logger.error()` "[object Object]" gap this fix's diagnosis had to work around first (also
still-open elsewhere, see that same file).

**Templates — send-time (media ID at send).** **Date:** 2026-07-10, commit `4bde8a9`. A separate,
adjacent bug: `sendTemplate()` only built a header parameter for TEXT headers, so an *approved*
IMAGE-header template still failed to send (`"header: Format mismatch, expected IMAGE, received
UNKNOWN"`) — a real customer-facing send blocked. Fix reuses the existing `resolveMediaId()` (the
regular `/media` endpoint, a different Meta API surface from the Resumable Upload handle used once
at template creation), fed from the template's stored `headerMediaRef`. Verified with a real
authorized send to the project's confirmed-safe test number — delivered and read.

**OAuth: invalid `business_management` scope blocking every "Connect with Meta" attempt.**
**Date:** 2026-07-10, commit `eb24e2c`. `GET /auth/init` requested a third, bare
`business_management` scope alongside the two correct `whatsapp_business_*` ones — a real Meta
permission name, not a typo, but this app was never approved for it and doesn't need it (confirmed
against the already-working manual System User token connect flow, which never requested it).
Meta rejects the *entire* OAuth request when any one requested scope isn't in the app's approved
list, so this blocked 100% of OAuth-based connects, not just a degraded permission set. Fix: scope
removed, two `whatsapp_business_*` scopes are sufficient. **Status (all three):** shipped, current.
**Reference:** commits `efd6a43`, `4bde8a9`, `eb24e2c`; `docs/phase3/TECHNICAL_DEBT.md`.

### Automation: Track B2, batches 1 and 2a (batch 2b/item 9 still queued)

**Date:** 2026-07-12, commits `c9bec11` (Batch 1) and `f82f6d0` (Batch 2a). Batch 1: fixed the
Save/Auto-arrange panel hiding behind the docked node-config panel (real usability bug, verified
in a real browser via this repo's established no-login-harness technique), added a delete-node
affordance, grouped the node palette into categories, gave the Trigger column a Badge to match
Status, adopted `GaugeChart` for the dashboard's Success Rate tile (first real use of that
component), and relocated the three always-on settings panels (Welcome Message/Working
Hours/Delayed Response) out of the Workflows tab into a new Settings tab per product decision —
Workflows now shows only the workflow list. Batch 2a: added per-workflow `successCount`/
`failureCount` (incremented alongside the existing `runCount` in `AutomationEngine.js`'s finalize
step) surfaced as a list-glance health indicator; gave `GET /executions` real `page`/`pageSize`
pagination plus server-side search/sort (mirroring the `contacts.js`+`Pagination.tsx` numeric-
offset convention, since production data — 92 `AUTO_EXEC#` records total, confirmed read-only — is
well short of where pagination would matter today, but the shape is now correct ahead of scale);
`Table.tsx` gained an opt-in, backward-compatible expandable-row capability so `ExecutionList` could
adopt the shared `SearchBar`/`FilterBar`/`Table` components instead of hand-rolled markup, without
losing its step/path trace-expand feature. **Explicitly deferred, stated in the Batch 2a commit
message itself:** item 9 (execution-volume/trigger-breakdown charts) "stays queued for its own
aggregation-strategy pass" — not started, needs its own scoping (see `docs/PENDING_WORK.md`).
**Status:** Batches 1 and 2a shipped, current; remaining B2 scope (item 9) open.
**Reference:** commits `c9bec11`, `f82f6d0`.

### apforce.in marketing page + CORS fix

**Date:** 2026-07-12, commits `634533c` (marketing page) and `a640484` (CORS fix). Meta App Review
requires a public website link for the app. `634533c` reuses the existing `vt-employee-hub` Vercel
project rather than standing up new hosting — `apforce.in`/`www.apforce.in` domains added alongside
`app.apforce.in`, and `dashboard/src/proxy.ts` rewrites `/` to a new static marketing page only for
those two marketing hosts; every other host/path (including the dashboard, login, and legal pages)
passes through untouched. A same-day follow-up (`a640484`) fixed a CORS error the marketing page
threw on load: the shared root layout's `AuthProvider` restored the session on *every* route,
including the public marketing page, firing a cross-origin `/api/auth/me` request from `apforce.in`
that the backend's CORS allowlist correctly rejected (`apforce.in` was deliberately never added —
the marketing page has no legitimate reason to talk to the backend at all). Root-cause options were
weighed explicitly: true structural isolation via Next.js multiple-root-layouts would have required
moving every existing route into a sibling route group (`app/(app)/` alongside `app/(marketing)/`)
— verified against this repo's own Next.js 16.2.9 docs (`node_modules/next/dist/docs/`) that this
is genuinely how the App Router requires it, not a training-data assumption — a large mechanical
diff touching every route's file location for a CORS fix. **Decision (explicit choice, asked and
answered):** a targeted pathname guard in `AuthContext.tsx` instead — skip the `/api/auth/me` call
when `usePathname() === '/marketing'` — achieving the same "zero backend calls from apforce.in"
outcome with a five-line diff and zero risk to any other route, at the cost of not being permanent
structural isolation (a future unconditional call added to `AuthProvider`/`WebSocketProvider`/
`AssignmentBridgeProvider` could still leak onto the marketing page and wouldn't be caught by this
guard). Validated with a real Playwright browser session against a local dev server (zero `/api/`
requests on direct `/marketing` navigation) and confirmed green in the real CI run for this exact
commit (`https://github.com/veer-trading-bgk/VT-Employee-Hub/actions/runs/29194812944` — Dashboard→
Vercel and E2E both succeeded, Backend→Lambda correctly skipped per Era 44's CI path-filtering
entry above, since no `src/**` file changed). A pre-existing, unrelated service-worker bug was
found and logged (not fixed) while validating this: `public/sw.js`'s offline fallback returns a
synthetic `200 {"error":"Offline"}` for any unreachable `/api/` call, which `AuthContext` then
trusts as a valid logged-in user — see `docs/phase3/TECHNICAL_DEBT.md`'s "Service Worker Offline
Fallback..." entry. **Status:** shipped, current, hash-verified on `origin/main`.
**Reference:** commits `634533c`, `a640484`; `dashboard/src/proxy.ts`, `dashboard/src/context/AuthContext.tsx`.

### Meta App Review — submitted

**Date:** submitted 2026-07-12 (per direct report; not a git-verifiable event — no commit marks an
external review-portal submission). **Status:** "in review" — Meta's stated review window is up to
20 days. The apforce.in marketing page (above) and the legal pages (`008611d`, 2026-07-10 — Privacy
Policy, Terms, Data Deletion) were both prerequisites shipped specifically to support this
submission. **Reference:** `docs/PENDING_WORK.md` (external/waiting-on-Meta section) tracks this
until Meta responds.

---

## Era 45 — `conversational-sales-agent` cost-reduction batch (2026-07-14)

**Context.** A cost re-investigation measured the true per-conversation cost of the autonomous WhatsApp agent from real `AIUSAGE#` records: a full 9-turn conversation charged **~₹3.95** (raw API ~₹2.63), ~93% of it the main-chat input, because the base system prompt is re-sent every turn. Prompt caching was floated as the top lever and then **retracted** — see the 2026-07-14 addendum appended to Era 32 above: re-measured with real `count_tokens` on Haiku 4.5, even the maximal restructured static block is 1,165 tokens vs. the 4096 minimum, so caching is structurally impossible at this conversation scale. Caching is CLOSED, not deferred.

**Target, clarified with Viir.** "Charged" (post-1.5×-margin) is the number that matters. The original ₹0.5–1/conversation ask is **not reachable** without either dropping `MAX_TURNS` below 5 or trimming the SEBI compliance wording — both explicitly rejected. **~₹1.5–2/conversation from the approved levers is the accepted outcome.**

**Three approved levers, of which two shipped and one was held:**
- **`MAX_TURNS` 10 → 5** (commit `41f4d95`). Halves worst-case spend; on the 9-turn sample, ~₹3.95 → ~₹2.15 charged. The prompt's "turn X of Y" line reads `context.maxTurns`, so the model re-paces itself. **Measured risk:** 43% of qualifications in the pre-change window landed *after* turn 5. Tracked (see measurement below); revert to 10 if it breaches the trigger.
- **Base-prompt trim, promptVersion v7 → v8** (commit `bd75f71`). Compressed STYLE, PRODUCT SCOPE enumeration, and WHO-YOU-ARE examples; static prefix 904 → 837 tokens (~₹0.03/conversation). **The 5 HARD COMPLIANCE RULES + preamble + closing, and PRODUCT SCOPE's neutrality sentence, are byte-identical to v7 — no compliance wording touched for cost.** Verified against the live model (not just unit tests): the 5-question adversarial suite through the trimmed prompt returned 4 clean-pass + 1 known guarantee-word false-positive (the compliant "no investment comes with a guarantee" refusal, same class Era 32 logged) + **0 hard-fail** — no compliance regression.
- **Reasoning-field cap — HELD, not shipped.** The proposal floated capping `reasoning` (audit-only, never customer-facing) at 350 chars as a "harmless no-op." On implementation this was found **net-negative and not shipped**: `AIService` validates output with post-hoc `schema.safeParse` + retry (not constrained decoding), so a schema `.max` can't reduce generated tokens — the model writes the reasoning, *then* zod validates, so a >350-char output (real data: p95=334, max=364, ~2% of turns) forces a full retry (double cost) and saves nothing. Surfaced to Viir for a decision (skip entirely, or instead tighten the prompt *instruction* — the only lever that actually reduces generated reasoning tokens, with no retry risk). Matches this investigation's own honest verdict ("don't cut reasoning for cost").

**Measurement plan (approved, `scripts/measureQualificationRate.js`, commit `bb9b066`).** Metric: qualification-completion rate = conversations with any `ai_conversation_turn` `qualified=true` ÷ conversations with ≥1 agent turn. Baseline **39% (7/18)**. Window: first 50 conversations OR 7 days post-deploy, whichever first. **Revert trigger:** rate ≤ 29% absolute (10pt drop) OR ≥ 25% relative → restore `MAX_TURNS` to 10. Leading indicator reported alongside: turn-limit share (conversations hitting the cap unqualified).

**Note on running the live suite:** the useCase is currently toggled OFF for `viir_trading` (`AIService.generate` returns `disabled_usecase`), so the compliance verification above was run by calling the Anthropic API directly with the real trimmed prompt, bypassing the company enablement gate — the prompt's behavior is what the trim could regress, and that is what was tested.

**Reference:** `src/services/ConversationalAgentService.js` (`MAX_TURNS`), `src/config/aiConfig.js` (`conversational-sales-agent` promptTemplate/promptVersion), `scripts/measureQualificationRate.js`, Era 32 (model switch + caching rejection/retraction), `docs/phase3/TECHNICAL_DEBT.md` (AI pricing PLACEHOLDER constants — the charged figures depend on the 1.5× margin/FX still flagged there).

---

## Era 46 — full LLM provider migration: every useCase → Amazon Nova Lite (Bedrock), Claude retired from the active path (2026-07-14)

**Decision (Viir's explicit call).** Switch **every** AI useCase off Claude and onto Amazon Nova Lite in a **single batch**, not staged — including `conversational-sales-agent`, the highest-risk (customer-facing, unsupervised, SEBI-exposed) useCase. Reason: cost. Nova Lite is ~14–17× cheaper per token than Haiku 4.5 and, in practice, also tokenizes this prompt to ~40% fewer input tokens.

**Two decision gates cleared first (both required before any code):**
- **Region.** `apac.amazon.nova-lite-v1:0` (the APAC inference profile) is reachable **from `ap-south-1`** — same region as the rest of the stack, ~860 ms/turn, **no** us-east-1 / cross-region latency or data-residency detour. (`us.amazon.nova-lite-v1:0` is a US profile that only runs in us-east-1; the bare `amazon.nova-lite-v1:0` isn't on-demand-invokable — needs a profile.)
- **Compliance.** The exact 5-question adversarial suite `PromptTestService` uses (verbatim), through the real v8 `conversational-sales-agent` prompt, run **4 times** against `apac.amazon.nova-lite-v1:0`: **0 hard-fail across all 4 runs / 20 turns**, JSON-format 20/20, WhatsApp format-drift 0/20. Matches Claude Haiku 4.5's Era 32/45 profile (4 clean + 1 known guarantee-word false-positive per run) and repeats it four times.

**Pricing (verified, not placeholder).** `PRICING.models['apac.amazon.nova-lite-v1:0'] = { input 0.071, output 0.284 }` per 1M — confirmed live against the AWS Pricing API (`AmazonBedrock`, `ap-south-1`: `APS3-NovaLite-input-tokens` $0.000071/1K, `APS3-NovaLite-output-tokens` $0.000284/1K). The APAC profile prices ~18% above the US base ($0.06/$0.24) — checked, not assumed.

**What shipped (5 commits, each revertible):**
1. `src/services/providers/BedrockNovaProvider.js` — Bedrock Converse (aws-sdk v2, already a dep; no new package), region ap-south-1, real `resp.usage.inputTokens/outputTokens`, coalesces adjacent same-role turns (Bedrock requires strict alternation where Anthropic merged). Interface `generate(systemPrompt, messages, {model, maxTokens}) -> {text, usage}`.
2. The verified `PRICING.models` entry above.
3. `AIService` provider dispatch — `_callModel({provider,...})` normalizes both providers to one internal shape; `provider` read from the useCase's aiConfig field, default `'anthropic'` → behavior-neutral until a useCase opts in. `_computeCost`/`_logUsage` untouched: same AIUSAGE# shape, same Era-40 rate snapshot, different model tag + real Nova tokens.
4. Every useCase flipped: `provider:'bedrock-nova'` + `model:'apac.amazon.nova-lite-v1:0'`.
5. This entry.

**Claude/Anthropic is no longer in the active path for ANY useCase after commit 4.** The Anthropic code path (`_callAnthropic`) and both `claude-*` PRICING entries are **kept intact and dormant, NOT deleted** — reverting any useCase is a pure config change (`provider:'anthropic'` + `model` back to `claude-haiku-4-5-20251001`), no code needed, per the standing rule about not hard-deleting working code for a business-driven switch.

**End-to-end validation through the REAL service (not the standalone gate script).** Ran the 5 adversarial questions through `AIService.generate({useCase:'conversational-sales-agent', source:'admin_test', ...})` against a synthetic company (no CONFIG#AI row → enabled): **5/5 service-ok, 5 clean-pass, 0 hard-fail** — exercised provider dispatch, the live Nova call, JSON-schema parsing of `{reply, qualified, productInterest, budgetAmount, timelineDays, reasoning}`, and cost logging with real Nova token counts (model tag `apac.amazon.nova-lite-v1:0`, ~1,200 in / ~90 out per turn, ~$0.00017 charged/turn). Full unit suite: 1630/1630.

**Cost impact.** Per-turn charged cost dropped from ~₹0.41 (Haiku) to ~₹0.016 (Nova) — the 9-turn sample would go from ~₹3.95 to well under ₹0.3 charged, blowing past the ₹0.5–1 target the MAX_TURNS/prompt-trim work (Era 45) could only get to ~₹1.5–2. MAX_TURNS=5 and the v8 trim remain in place and compound with this.

**Scope caveats (so this isn't oversold):** the adversarial compliance gate specifically covered `conversational-sales-agent` (the only customer-facing prose useCase); the other four are internal/structured (JSON classification/extraction) and lower-risk, validated via the routing/parse unit tests rather than a live adversarial run. A handful of passing runs is not a permanent guarantee (same non-determinism caveat as every prior live-model check) — real production traffic on Nova should be monitored, same discipline as Era 32's Haiku switch. Throwaway `scripts/testNovaCompliance.js` and a one-line additive export in `PromptTestService.js` (`isKnownGuaranteeFalsePositive`, to reuse the exact classifier) remain uncommitted, pending Viir's keep/revert call.

**Reference:** `src/services/providers/BedrockNovaProvider.js`, `src/services/AIService.js` (`_callModel`), `src/config/aiConfig.js` (per-useCase `provider`/`model`, `PRICING.models`), Era 32/45 (Haiku switch, caching retraction, MAX_TURNS/trim), `docs/phase3/TECHNICAL_DEBT.md` (margin/FX PLACEHOLDER constants that scale the charged figures).

---

## Era 47 — `start_ai_conversation` Automation action: workflow-driven hand-off to the AI conversation agent (2026-07-14)

**What shipped.** A new Automation Engine action type, `start_ai_conversation`, that hands a lead off to the autonomous AI conversation agent from inside a workflow (canvas: Trigger → Send Buttons → wait/branch → **Start AI Conversation**). The wait/branch/timeout half of that flow already existed — a `send_buttons`/`condition` node pauses on "button tap OR configurable timeout, whichever first" (`AutomationEngine._runGraph`, `__timeout__` handle), so the only new piece is the terminal hand-off action.

**Entry point — a new `ConversationalAgentService.startForLead()`, NOT `maybeStart()`.** `maybeStart()` is webhook-shaped (CIS `resolveOrCreate` with a `waMessageId` idempotency key, seeded by the customer's inbound text) and — critically — does **no `handoffState` check** before starting, so reusing it from a workflow would re-engage/restart a conversation that was already bot-active or already handed off. `startForLead(companyId, { leadPK, phone10, name, contextHint })` instead composes the existing primitives (`_getConfig` → load lead → `resolveForLead` → `getConversation` → guard → `startBotHandling` → shared `_runTurn(turnCount: 0)`), reusing the exact multi-turn core every entry point shares.

**The guard (decided against the real state machine, not the scoping report's assumption).** `ConversationService.getConversation` defaults `handoffState` to `'human'` for a never-engaged conversation — there is **no distinct "not engaged" state**, so `'human'` is ambiguous between "never touched" and "a human is actively handling." The safe start-gate is therefore two signals together: **no-op if the lead is assigned (`assignedTo`)** (human-owned — same guard `maybeStart` applies) **OR `handoffState ∈ {'ai','pending_human'}`** (already bot-engaged / handed off — never re-engage). Only a default-`'human'`, unassigned conversation falls through and starts. The "skip if assigned" half was an explicit product decision (mirrors auto-first-contact behaviour; trade-off is that auto-assigned leads won't get a workflow-driven AI start).

**Hand-off is a clean terminal step.** `startBotHandling` sets `handoffState='ai'`; every later inbound message is then carried by `continueTurn` (webhook known-lead branch), **not** by the workflow, which completes at this node. Subsequent AI turns are separate `AIUSAGE#`/conversation records — the workflow and the AI engine stay decoupled through `handoffState`.

**ADR-015 compliant.** The action calls `ConversationalAgentService` → `AIService.generate` → provider; never a provider directly.

**Context hint.** An optional free-text field on the node (`{{name}}/{{phone}}/{{trait.*}}`-resolvable via the same `welcomeVariables` registry the `send_*` actions use) becomes `_runTurn`'s turn-0 `text` → the prompt's `latestMessage`, so the AI's first question can reference the tapped button's category instead of re-asking. Empty hint falls back to a neutral `'Hi'` seed (turn-1's working shape).

**Frontend.** `start_ai_conversation` added as an `ActionType` (a simple lead-action like `add_tag`, so it reuses the generic `ActionNode`/`ActionEditor` shell rather than a bespoke node) — type union + `StartAiConversationConfig` + `ACTION_META` + `ACTION_ICONS` (Bot) + `nodeTypes` registry + a new "AI" palette group + an `ActionEditor` context-hint field + a `summarizeNodeConfig` case. `tsc --noEmit` clean.

**Tests.** `startForLead` guard matrix (disabled / lead-missing / assigned / `'ai'` / `'pending_human'` all no-op; never-engaged unassigned starts and seeds the hint; empty hint → `'Hi'`) and the action's dispatch (resolves `{{name}}`, passes `phone` as `phone10`, returns `{ engaged }`, throws without `leadPK`). Full suite green.

**KNOWN DEPENDENCY — not shipped here, still required for the button-first-on-first-contact flow.** The auto-first-contact AI (`maybeStart` at `whatsapp.js`) fires on a customer's first text and, when it engages, **skips the welcome message and all automation triggers** (`botEngaged` gate). So a `Trigger(whatsapp_conversation_started) → Send Buttons → … → start_ai_conversation` workflow **will not fire on genuine first contact today** — the AI pre-empts it. This action is necessary but not sufficient for that specific flow; it needs a companion per-company "let workflows drive first-contact AI" toggle (suppress the auto `maybeStart`). That companion decision was scoped out of this change and remains open (see below). The action is still immediately useful for any workflow that hands off outside the first-contact race (non-first-contact triggers, keyword flows, or once the companion toggle ships).

**Reference:** `src/services/AutomationEngine.js` (`_runAction` `start_ai_conversation` case), `src/services/ConversationalAgentService.js` (`startForLead`), `src/services/ConversationService.js` (`HANDOFF_STATE`, `startBotHandling`), `src/routes/whatsapp.js:1765` (the auto-first-contact pre-emption), dashboard automation canvas.

---

## Era 48 — first-contact precedence: a whatsapp_conversation_started workflow now owns AI engagement (2026-07-14)

**Decision.** The companion to Era 47, closing the gap it flagged. A company that builds an **active** `whatsapp_conversation_started` workflow now controls whether/how the AI engages a brand-new contact — the auto AI-start (`maybeStart`) no longer pre-empts that workflow. A company with **no** such workflow sees zero change: the AI auto-engages on first contact exactly as before.

**The problem (from Era 47).** On first contact, `whatsapp.js` ran `maybeStart` first; if the AI engaged, `botEngaged` skipped the welcome message and every automation trigger, including `whatsapp_conversation_started`. So a "Trigger → Send Buttons → … → start_ai_conversation" workflow could never fire — the AI pre-empted it.

**The fix (three parts).**
1. **Shared lookup, extracted (reuse-first).** The query-plus-filter that lived inline inside `AutomationEngine.fireTrigger` — query `CONFIG#AUTO#{companyId}`, keep active workflows (status `active`, or legacy `enabled:true` when status is absent) whose trigger type matches — is extracted into `AutomationEngine._findActiveWorkflows(companyId, triggerType)`. `fireTrigger` now calls it and layers its keyword/condition filters on top (behaviour unchanged). A new public `hasActiveWorkflow(companyId, triggerType)` returns whether that list is non-empty. Generic over `triggerType`, reusable for any future trigger; no second scan mechanism exists.
2. **Runtime guard.** At the `maybeStart` call site in `whatsapp.js`, `maybeStart` now runs only when it is a first-contact text message **and** `hasActiveWorkflow(companyId, 'whatsapp_conversation_started')` is false. The lookup runs only on genuine first-contact text (short-circuit AND). When suppressed, `botEngaged` stays false, so the existing `!botEngaged` gate fires the `whatsapp_conversation_started` workflow (which can hand off via a `start_ai_conversation` node). The guard adds NO warning logic or side effects — it is purely the boolean precedence check.
3. **Save-time advisories (non-blocking).** On create/update of a `whatsapp_conversation_started` workflow, two warnings ride on the existing optional `warning` response field (the same field `auth.js`/`crm.js`/`whatsapp.js` already use — no new subsystem): (a) the workflow has no `start_ai_conversation` node, so the AI won't auto-engage while it's active; (b) the company already has another active `whatsapp_conversation_started` workflow (the check reuses `_findActiveWorkflows` and excludes the workflow being saved, `w.id !== wf.id`). Both are advisory — a failure to compute them never fails the save (`.catch(() => [])`).

**Why backward-compatible by construction.** `hasActiveWorkflow` can only return true for a workflow that is (i) in this company's `CONFIG#AUTO#{companyId}` partition — the query PK scopes it, so cross-company matches are impossible — and (ii) active, and (iii) of the requested trigger type. For any company without a matching active `whatsapp_conversation_started` workflow, `_findActiveWorkflows` returns `[]` → `hasActiveWorkflow` returns false → the guard's `&&` runs `maybeStart` unchanged. The guard can only *remove* a `maybeStart` call, and only when a matching active workflow provably exists. Production confirmed 0 such workflows exist today, so the precedence change affects no one until a company opts in. A regression test proves the subtle case explicitly: a company with an active workflow of a *different* trigger type still gets `maybeStart` called (the trigger-type filter, not merely "no workflow at all").

**Scope boundaries.** No behaviour beyond the precedence check was added to the runtime path — no warnings, no state. When the guard suppresses `maybeStart`, both the workflow and any welcome message can fire (both `!botEngaged`-gated); the intended model is that building such a workflow means the company owns first-contact, including whether AI engages (via a `start_ai_conversation` node) and whether a welcome also sends.

**Reference:** `src/services/AutomationEngine.js` (`_findActiveWorkflows`, `hasActiveWorkflow`, `fireTrigger`), `src/routes/whatsapp.js` (first-contact guard), `src/routes/automations.js` (`conversationStartedSaveWarnings`, wired into POST `/` and PUT `/:id`), Era 47.

## Era 49 — free text on an unengaged, unassigned conversation counts as AI engagement (2026-07-15)

**Decision (Viir, 2026-07-15).** A typed (free-text) message from a customer now **engages the AI conversation agent** whenever the conversation was never AI-engaged (`handoffState` still `'human'`) and the lead is **unassigned** — in BOTH the unknown-contact (`INBOX#`) and known-lead webhook branches. Engagement routes through `ConversationalAgentService.startForLead()` (Era 47's start mechanism), NOT by extending `continueTurn()` to also start. This was **never formally logged before** — a prior same-session summary treated it as decided, but it was informal, not a real decision record; this entry is the precedent going forward.

**The problem.** The AI had exactly two entry points, and neither started on a *later* free-text message: `maybeStart()` fired only on `isFirstContact` (unknown branch, `whatsapp.js`), and `continueTurn()` only *continued* an already-`'ai'` conversation (known branch — returns false unless `handoffState === 'ai'`). So if the first turn didn't engage the AI — a `whatsapp_conversation_started` workflow owned first contact and sent buttons, or the AI was off, or `maybeStart` no-op'd — every subsequent typed message dead-ended: `maybeStart` wouldn't fire (not first contact), `continueTurn` wouldn't (state `'human'`). The customer's typed question got no AI reply, and with a workflow the welcome buttons stayed the last thing on screen — the reported "typing after Hi just leaves/resends the buttons."

**Scope (four explicit decisions).**
1. **Route to `startForLead`, don't extend `continueTurn`.** `startForLead` already resolve-or-creates the lead (unknown branch) and no-ops on an already-engaged/handed-off conversation, reusing Era 47's path rather than duplicating start logic in the continue path.
2. **Free text overrides a paused workflow.** On a *later* turn (not first contact), engagement fires **regardless** of an active `whatsapp_conversation_started` workflow paused at its buttons — the customer chose to type rather than tap. Era 48's workflow-ownership rule is unchanged for FIRST contact; it only ever governed the first message. *(Accepted limitation, surfaced by adversarial review: the workflow's paused `AUTO_WAIT#` execution is left in place — it times out on its own; a later tap on one of its now-stale buttons resumes it into `start_ai_conversation`, which no-ops because `startForLead` guards on the now-`'ai'` state, so there is no double-engage — just a stale tap that does nothing useful. Proactively cancelling the orphaned wait is a deferred cleanup, not done here.)*
3. **`assignedTo` guard, no exceptions.** `startForLead`'s existing guard returns false for a human-assigned lead — free text never hijacks a lead a human owns.
4. **Suppress the other auto-replies on engagement.** Setting `botEngaged`/`botHandled` suppresses OOO / `keyword_message` / welcome / `whatsapp_conversation_started` (all `!engaged`-gated). The pending Delayed-Response needs an **explicit** cancel: `WhatsAppSendService._fireDelayedResponseCancel` deliberately early-returns on `'system'` sends (so a delayed-response/welcome/automation blast can't cancel a genuine "no human replied" timer), and the AI reply is a `'system'` send (`AI_ACTOR.id === 'system'`) — so it does NOT auto-cancel. Both branches therefore call `DelayedResponseService.cancelPending(companyId, phone10)` when `startForLead` engages. **(An earlier draft of this entry wrongly claimed the per-send auto-cancel handled it "with no extra code needed" — caught by adversarial review before commit; the double-reply that false premise would have shipped, an AI answer followed ~5 min later by a "sorry, an agent will get back to you" ack, is real and reproducible whenever a company has both features enabled.)**

**Not changed.** First contact still runs `maybeStart` exactly as before (Era 48 intact). Button/list replies are untouched — the new engagement is `type === 'text'`-gated, so `resumeOnButtonReply` still owns taps. An already-`'ai'` conversation still flows through `continueTurn` with no double-engage: `startForLead` is only called when `continueTurn` returned false, and its `handoffState` guard no-ops if the convo is already `'ai'` or handed off.

**Validation.** `tests/whatsappFirstContactBotEngaged.test.js` — 8 new wiring tests: later-free-text engages in both branches; overrides a paused workflow; a decline falls through to `keyword_message`; both button-tap regressions (unknown + known) confirm taps never trigger `startForLead` and still resume; an already-`'ai'` convo skips `startForLead`; first contact still uses `maybeStart`. `startForLead`'s own guards (`cfg.enabled`/`assignedTo`/`handoffState`) remain unit-tested in `conversationalAgentService.test.js`.

**Reference:** `src/routes/whatsapp.js` (known-lead + unknown-contact branches — the two `startForLead` calls); `src/services/ConversationalAgentService.js` (`startForLead`, `continueTurn`, `maybeStart`); `src/services/DelayedResponseService.js` (auto-cancel on send); Era 47 (`start_ai_conversation`/`startForLead`), Era 48 (first-contact workflow ownership).

**Adversarial-review follow-ups (Finding 1 FIXED, Finding 2 DOCS-ONLY) — 2026-07-15.** A post-Era-49 adversarial review of the free-text engagement path raised two findings:

- **Finding 1 (real gap — FIXED).** Engagement cancelled the pending Delayed-Response timer (decision 4) but left a `whatsapp_conversation_started` workflow's *paused button-reply* `AUTO_WAIT#` alive. Because engagement overrides the workflow (decision 2) without clearing its wait, a LATER stray tap on the now-stale button would reach `resumeOnButtonReply()` and resume the overridden workflow — a double-action on a conversation the AI now owns. Fix: new `AutomationEngine.cancelButtonReplyWaits(companyId, phone10)` — claims+deletes this contact's `awaitReply` waits via the same whole-partition Query + conditional-delete claim as `resumeOnButtonReply()`, scoped to button-tappable waits so `delayed_response` and time-only delay waits are untouched — called from BOTH whatsapp.js engagement blocks, gated on `startForLead()` actually engaging. This refines the "Not changed / button replies untouched" note above: a real tap still routes to `resumeOnButtonReply()` unchanged, but a wait the AI engaged *over* is now cancelled so it can't fire late. Validated by a new no-double-action test in `tests/automationEngine.test.js` (paused wait → cancel → late tap resumes nothing) plus wiring assertions in `tests/whatsappFirstContactBotEngaged.test.js`.
- **Finding 2 (no functional gap — DOCS-ONLY).** `assignedTo` + the free-text path needs no code change. The whatsapp.js path does no `assignedTo` logic itself and acts only when `startForLead()` returns true; `startForLead()` already declines a human-assigned lead at its `if (lead.assignedTo) return false` guard (mirrors `maybeStart`'s guard). Both cancels (Delayed-Response and the Finding 1 `AUTO_WAIT#` cancel) are gated on that same engagement, so an assigned lead's timer AND its paused workflow are left intact — the new AI entry point routes through the same central guard the old ones do, so no new code reaches `_runTurn` past it. The only residual is a pre-existing TOCTOU assign-race (a human claims the lead in the ~1-2s between the guard's read and the reply send) shared by every AI entry point, not introduced or widened here. Recorded, not changed.

**Reference (follow-ups):** `src/services/AutomationEngine.js` (`cancelButtonReplyWaits`); `src/routes/whatsapp.js` (both engagement blocks); `src/services/ConversationalAgentService.js` (`startForLead` `assignedTo`/`handoffState` guards); `tests/automationEngine.test.js`, `tests/whatsappFirstContactBotEngaged.test.js`.

---

## Era 50 — MAX_TURNS 5→7 + prompt v10 strict 5-step qualification boundary (2026-07-15)

**Decision (Viir, 2026-07-15).** Two paired changes to the autonomous conversational-sales-agent, shipped in one commit, affecting **every company's** live AI behavior (base prompt + the shared turn cap, neither per-company configurable): (1) `ConversationalAgentService.MAX_TURNS` **5 → 7**, and (2) the base prompt bumped **v9 → v10** with a new **STRICT QUALIFICATION BOUNDARY** section.

**This REVERSES a same-session decision.** Earlier today the cap was explicitly left at 5 (the 2026-07-14 Era 45 cost trial's value — see the `MAX_TURNS` comment history). That reversal is deliberate and the reason is **not cost**: it is live conversation evidence.

**The evidence (a real traced transcript, not a hypothesis).** A live viir_trading conversation on 2026-07-15 (record identifiers kept in the internal audit log, out of this public doc), running on the just-deployed v9 prompt + the tightened `qualificationRules`, still failed — and failed structurally, not on wording:
- The customer supplied everything qualifiable by turn 3: interest, name, city, and amount.
- Turn 3 the model drilled for an **area/locality** the 5-step script never asks for, even though the city had already been given.
- Turn 4 it asked for the customer's name again **while addressing them by that very name in the same sentence** (its own audit reasoning even used the name) — a pure model-level instruction-following miss (the name was in the conversation history it received; the never-re-ask rule was in the prompt, twice).
- Turn 5 it **invented** an off-script question that is nowhere in the 5 steps.
- Net: 3 of 5 turns spent on a re-ask + off-script improvisation, hit the cap (`turn_limit_reached`, guardrail never tripped), and handed off a fully-answered lead as **unqualified**.

**Why 5→7 and not more prompt wording alone.** The root problem is the model (Nova Lite, Era 46) wandering off a bounded script and re-asking answered fields — a small-model instruction-adherence weakness already recorded as `docs/phase3/TECHNICAL_DEBT.md` INCIDENT #7 (~2% measured re-ask rate on Nova). v10's STRICT QUALIFICATION BOUNDARY attacks the wandering directly (see below); the wider cap is the **safety margin** so a single wasted turn no longer blows the whole budget before the 5 real steps finish. At 5 there was zero slack. Cost is a non-issue: on Nova Lite (`apac.amazon.nova-lite-v1:0`, ~₹0.071/₹0.284 per M in/out tokens) 7 turns runs ≈ ₹0.14/conversation total — the qualification-completion win dominates.

**Prompt v10 — the STRICT QUALIFICATION BOUNDARY block** (added after the existing "ask ONLY if not already answered" paragraph; the 5 HARD COMPLIANCE RULES and their wording are **byte-identical to v9** — no compliance text was touched): (a) ask ONLY the five steps, in order — interest, name, city, amount, urgency; (b) a city NAME completes the city step — never ask area/locality/"where in <city>"; (c) invent no question outside the five (explicitly: no "financial goal", risk appetite, occupation, email) and once all five are answered STOP rather than manufacture a sixth; (d) once a name appears ANYWHERE above (customer's message OR the model's own earlier reply) the name step is permanently done — never re-ask it, even while addressing them by that name. Points (b)/(c)/(d) map one-to-one onto the three real failures above; (d) is the third, most emphatic restatement of a rule that was already present twice and still failed.

**Stale measurement threshold — flagged, not silently left active.** `scripts/measureQualificationRate.js` was built for the 10→5 trial: it hard-codes a **39% baseline** (`7/18`), a **"revert to 10 if ≤29%"** trigger, and 10→5 framing throughout. None of that applies to a 5→7 change. The script's header docstring and the `MAX_TURNS` code comment now both carry an explicit STALE notice; the thresholds must be **re-baselined against MAX_TURNS=7** before its output means anything. Do not act on its revert trigger as-is.

**Live verification (real model, not mocks).** Because the failure mode was only ever caught live (unit tests with mocked models never reproduced it), this change was verified by driving the **real Bedrock Nova Lite** endpoint with v10 + maxTurns=7 through the exact failure shape (interest → name+city → amount → …), via a direct `AIService.generate()` harness that accumulates extracted signals into `knownState` the same way `_runTurn`/`_buildKnownState` do. Result recorded with the commit. Full unit suite green (the end-to-end cap test in `conversationalAgentService.test.js` is cap-agnostic — `const CAP = agent.MAX_TURNS` — so it exercises 7 automatically).

**Reference:** `src/services/ConversationalAgentService.js` (`MAX_TURNS`); `src/config/aiConfig.js` (`conversational-sales-agent` promptTemplate, `promptVersion: 'v10'`, STRICT QUALIFICATION BOUNDARY); `scripts/measureQualificationRate.js` (stale-threshold notice); `docs/phase3/TECHNICAL_DEBT.md` INCIDENT #7 (the ~2% Nova re-ask finding this builds on) and the continueTurn turn-race entry; Era 45 (10→5 cost trial this reverses), Era 46 (Nova migration).

---

## Era 51 — "Standing stage membership" drips: a new periodic-sweep trigger type, `stage_membership` (2026-07-18)

**What shipped.** A new Automation trigger type, `stage_membership` (config: `{ stage }`), for a drip that must catch every lead currently sitting in a target pipeline stage AND any new arrival going forward — not just a one-time `stage_changed` transition. New service `src/services/StageMembershipScheduler.js` (`runStageMembershipSweep()`), riding the existing 5-minute EventBridge tick alongside `runDueCampaigns()`/`runDueLeadScoring()`/`AutomationEngine.processAllDueWaits()` in `src/handler.js` — no second EventBridge rule provisioned.

**Preceded by a dedicated audit, not guessed.** Before any implementation, a research-only pass (this same date) answered five questions the business owner posed: the shape of the existing scheduler pattern to reuse; whether a per-lead-per-workflow enrollment marker already existed (it did not); whether the wait/resume engine re-validates a lead's live state before each send (it does not, except inside an explicit `condition` node); whether a stage-scoped GSI or query path already existed to sweep against (it did not — confirmed by an independent four-angle search); and the trigger-type additivity/RBAC story. Two decisions were then made explicitly by the business owner rather than assumed by implementation:
1. **No automatic re-validation.** Once enrolled, a drip runs to completion via the engine's existing blind-continuation semantics — identical to every other trigger type. A lead who leaves the target stage mid-drip is NOT auto-unenrolled or guarded; a workflow author who wants that adds a `condition` node themselves, exactly as with any other workflow. This was flagged as a real behavior choice, not decided by default.
2. **Enrollment marker shape.** `ENROLLED#{workflowId}` under the lead's own `PK`, mirroring `PENDINGFLOW#`'s PK/SK shape (`src/routes/whatsapp.js`'s `sendRegisteredFlow`) — a sub-item, not an array field on the lead's `METADATA` item. Deliberately **not** TTL'd like `PENDINGFLOW#` — see the adversarial-review paragraph below for why that divergence was necessary.

**Sweep shape — deliberately copies `LeadScoringScheduler.js`, not a new pattern.** Table-wide, paginated `Scan` via `ExclusiveStartKey`, narrow `ProjectionExpression` including `stage` via the same `#st` alias — the audit confirmed no stage-scoped GSI or query path exists anywhere in this codebase (every existing stage-filtered lookup, including the Sales Kanban board, is a company-wide GSI Query filtered in application memory). Same accepted interim tradeoff as ADR-014. Per-company active-workflow lookup (`AutomationEngine._findActiveWorkflows(companyId, 'stage_membership')`) is promise-cached once per company per sweep — same pattern `_stagesFor()` uses in `LeadScoringScheduler.js` — so a company with no active `stage_membership` workflow costs one cheap Query and zero per-lead marker reads.

**Enrollment order matters.** `trigger.conditions[]` (the same optional AND-only filter every trigger type already exposes via `TriggerEditor`'s shared Conditions UI) is evaluated BEFORE the `ENROLLED#` marker is claimed, not after — a lead who doesn't yet satisfy a condition is simply re-checked on the next sweep rather than being permanently excluded by an early claim. The marker claim itself is a conditional put (`attribute_not_exists(PK)`) — the same claim-first, at-most-once philosophy every other claim mechanism in this codebase already uses (`CampaignScheduler`'s status-transition claim, `AutomationEngine._claimAndResume()`'s conditional delete).

**Direct-start, not `fireTrigger()`.** Enrollment calls `AutomationEngine._startExecution(companyId, workflow, context, 'stage_membership')` directly — the same bypass precedent `runWorkflowDirect()` already established for `inbound_webhook`. The sweep already resolved exactly which workflow to run; there is nothing left for `fireTrigger`'s trigger-type scan to do.

**Fully additive — confirmed, not assumed.** No shared trigger-type registry exists to "register into" (`_findActiveWorkflows`/`fireTrigger` do a plain `===` string comparison); the backend has no allowlist/enum on `trigger.type` at all. `stage_changed`'s own dispatch (`crm.js`) is a hardcoded literal fully independent of any registry. Existing `stage_changed`-triggered workflows are untouched by this change.

**Cross-tenant scoping — same discipline as every other sweep, not a new query-time guarantee.** Like `CampaignScheduler`/`LeadScoringScheduler`/`processAllDueWaits`, the Scan itself is table-wide with no `companyId` in the `FilterExpression` — safety comes from every downstream action keying off the scanned item's own `companyId`/`leadPK`, never a closure-captured value. Proven by a dedicated cross-company test (a lead from company B is never enrolled into company A's workflow, and vice versa).

**Frontend.** `stage_membership` added to `TriggerType`, `TRIGGER_META`, and `WorkflowBuilder.tsx`'s `TRIGGER_OPTIONS` — a plain array append (Q4's additivity confirmed this needs no restructuring). Its config UI reuses the exact same `pipelineStages` list + `<select>` pattern the Conditions section's own stage value-control already uses (`usePipelineStages()`, already fetched once per `TriggerEditor` render) — no new stage-picker component built.

**Adversarial review before shipping (2026-07-18) — 4 confirmed findings, all fixed pre-commit.** Per the Tier-1 process, an independent multi-agent review (4 dimension reviewers + adversarial per-finding verification) read the actual diff before it was presented for approval. It confirmed 6 real gaps (1 refuted as a misquote); 4 were runtime-behavior bugs and were fixed immediately, the other 2 were test-coverage gaps and were closed by adding the missing tests rather than accepting the gap:
- **(HIGH, fixed) TTL re-enrollment.** The original design copied `PENDINGFLOW#`'s 90-day TTL onto the `ENROLLED#` marker (per this Era's own decision #2 above, as originally worded). Review found this was actually wrong: `PENDINGFLOW#` expiring is low-stakes (an uncorrelated reply just loses attribution), but this feature's whole purpose is catching leads who sit in a stage *indefinitely* — a long-lived/terminal stage is the **common** case, not an edge case. A TTL'd marker meant DynamoDB would eventually delete it out from under a lead who never left the stage, causing the entire drip to silently re-fire and re-send from scratch, repeating roughly every 90 days for as long as the lead stayed put — real, recurring customer-facing spam. Fixed: the `ttl` field was removed entirely; "enrolled" now means enrolled forever for a given (lead, workflow) pair, the same permanence `LEAD_PHONE#`/`PHONE#` uniqueness locks already have in `entityKeys.js`.
- **(HIGH, fixed) Silent zero-enrollment via the shared Conditions UI.** `TriggerEditor`'s Conditions section renders unconditionally for every trigger type, including `stage_membership`, and its field picker offers From Stage / To Stage / Source alongside Stage/Tags/Assigned To with no per-trigger-type gating. The original enrollment context only set `leadId/leadPK/phone/name/stage/tags/assignedTo` — so a `to_stage` or `source` condition on a `stage_membership` workflow would always evaluate false (`AutomationEngine._ctxField` maps them to `ctx.toStage`/`ctx.source`, both permanently `undefined`), silently and permanently enrolling zero leads with no error anywhere. Fixed: the context now also sets `toStage: lead.stage` (same equivalence `crm.js`'s own `stage_changed` context already relies on — `toStage === stage` there too) and `source: lead.source` (now also projected in the Scan). `fromStage` is deliberately left unset and documented as such: a standing-membership sweep finds a lead already sitting in a stage, not transitioning into one, so there genuinely is no "from" to report — a From Stage condition on this trigger type will never match, by design, not by omission.
- **(MEDIUM, fixed) One company's transient failure could silently abort the whole sweep.** The per-company `_findActiveWorkflows` lookup was the only per-lead operation in the file with no try/catch (every other one — the claim, the execution — already had one). A single DynamoDB throttle on one company's `CONFIG#AUTO#` partition would throw out of the candidate-building loop entirely, discarding every already-found candidate for companies processed earlier in that pass, and — because `handler.js`'s `Promise.allSettled` never inspects settled results — producing zero log output anywhere. Fixed: wrapped with the same "log and skip, never crash the sweep" discipline `LeadScoringScheduler.js`'s own `_leadScoringEnabledFor` already uses.
- **(LOW, fixed) Stale cached workflow status across the whole sweep.** The per-company active-workflow lookup is cached once per sweep (deliberately, for performance — same pattern as `LeadScoringScheduler.js`'s `_stagesFor`), but a sweep spanning a full table-wide Scan plus many real-send batches can take seconds to minutes, during which an admin pausing/archiving the workflow would have zero effect on candidates already queued from that same pass. Fixed: added `_isWorkflowStillActive()`, a fresh uncached point-read immediately before the enrollment claim — same guard `AutomationEngine.resumeExecution()` already performs before resuming a paused wait — checked *before* the claim (not after) so a lead skipped this way stays eligible on a later sweep instead of being orphaned against a workflow that may never run it.
- **(test-coverage gaps, closed) Untested at-most-once-survives-failure, untested missing-`config.stage` guard, untested multi-workflow-per-company.** All three now have dedicated tests in `tests/stageMembershipScheduler.test.js`.

**Tests.** `tests/stageMembershipScheduler.test.js` (20 tests): enrolls a not-yet-enrolled in-stage lead with a TTL-free marker; skips a stage mismatch; skips a company with no active `stage_membership` workflow (zero marker reads); a `to_stage`/`source` condition evaluates correctly against the fixed context; a workflow with missing/null `config.stage` is safely skipped; a company running 2+ active `stage_membership` workflows enrolls independently into each; respects `trigger.conditions[]` without prematurely claiming a marker; dedup — an already-`ENROLLED#` lead is skipped, two overlapping sweep passes over the same candidate enroll it exactly once (conditional-put race safety), and a lead whose `_startExecution` throws keeps its marker and is never retried on a later sweep; ongoing catch — a lead arriving in the stage on a LATER sweep cycle is enrolled while the earlier lead isn't re-enrolled; cross-company isolation, including one company's lookup failure not blocking another company's sweep; a workflow paused/archived mid-sweep (or deleted mid-sweep) is not enrolled into; Scan pagination and shape; one lead's enrollment failure doesn't stop the batch. `tests/handlerEventBridge.test.js` extended to assert the new sweep is wired into the `Promise.allSettled` fan-out. `tests/automationsRoutes.test.js` extended for `buildTriggerForStorage`'s new `stage_membership` branch (required, trimmed `stage`; unaffected `stage_changed` persistence). Full suite green — 1938/1939, the one failure a pre-existing, unrelated `documentExtraction.test.js` PDF-fixture issue not touched by this change. `tsc --noEmit` and dashboard `eslint` both clean.

**Reference:** `src/services/StageMembershipScheduler.js`, `src/handler.js` (EventBridge fan-out), `src/routes/automations.js` (`buildTriggerForStorage`), `src/services/AutomationEngine.js` (`_findActiveWorkflows`, `_startExecution`, `_evalConditions`, `runWorkflowDirect` — the `inbound_webhook` direct-start precedent), `src/routes/whatsapp.js` (`PENDINGFLOW#` — the enrollment-marker shape precedent), `dashboard/src/types/automations.ts`, `dashboard/src/components/automation/WorkflowBuilder.tsx`, ADR-014.

---

## Era 52 — Click-to-WhatsApp ad attribution: `ctwa_clid` capture at lead creation (2026-07-18)

**What shipped.** A fresh lead created from a Click-to-WhatsApp (CTWA) ad conversation now carries `source: 'ctwa'`, a `ctwaClid` field (Meta's opaque ad-click id), and a freeform campaign tag (the ad's `headline`, falling back to `source_id`) — all set once, at creation, with zero automation-engine changes needed for a `lead_created`-triggered drip to consume them.

**Preceded by a dedicated audit (this same date).** The audit confirmed: (1) Meta's `messages[].referral` block — a sibling field on the inbound message, NOT nested under `context` as first guessed, verified against Meta's own CTWA docs — is already arriving in `whatsapp.js`'s webhook handler, in scope, simply never read; (2) no existing "extra fields" slot exists on the lead item (`data.metadata` only reaches interaction-log metadata), so `ctwaClid` needed one new named field, not a bag; (3) creation-time freeform tagging is real, already-shipped precedent (`forms.js:138`/`forms.js:242`), not speculation; (4) no cross-company leakage risk — `companyId` is resolved once, upstream, and flows unmodified; (5) `lead_created` + a `tags contains` condition already works end-to-end with existing node/trigger types — `tag_added` would never fire for a creation-time tag (it only fires on a diff against the pre-update list).

**Three decisions made by the business owner from the audit's open questions, before scoping:**
1. **One-shot at creation only** — explicitly NOT a `stage_membership`-style standing/continuous sweep. If the business later wants "still currently has this tag" behavior, that's a separate, new automation-engine feature, not this one.
2. **INBOX# caching edge case deferred, not fixed.** `maybeStart()` (the only place a fresh lead gets created from an unknown contact) doesn't run at all if the AI is disabled or a `whatsapp_conversation_started` workflow owns first contact — in either case, no lead exists yet to attach `referral` to, and it's currently discarded rather than cached onto the `INBOX#` contact record for later recovery. Logged in `docs/phase3/TECHNICAL_DEBT.md` as a known, accepted limitation (Low priority) rather than built.
3. **Tag with the ad's own identifier**, not just a bare `'ctwa'` literal — `referral.headline` (human-readable) falling back to `referral.source_id` (schema-guaranteed present) — for real per-campaign filtering, not just per-channel.

**The thread, exactly as audited:** `whatsapp.js`'s per-message loop extracts `const referral = msg.referral ?? null;` (already in scope, no new webhook subscription/permission) → passed into `ConversationalAgentService.maybeStart()`'s call site as a new `referral` param → `maybeStart()` derives `ctwaClid`/`source: 'ctwa'`/the campaign tag from it and passes them into `CustomerIdentityService.resolveOrCreate()`'s `data` → `_createCustomer()`'s `leadItem` literal gets one new line, `ctwaClid: data.ctwaClid ?? null` — same fixed-named-field pattern as every other attribute there (JSDoc updated to match). `source: 'ctwa'` is not a new convention — ADR-013 already reserves it by name. All three (`ctwaClid`/`source`/tag) are create-path-only by construction (`_createCustomer` only runs on a genuine first creation) — an enriched hit (existing lead matched by phone) is untouched, same "new customers only" semantics as `notes`/`stage`/`assignedTo`.

**Purely additive, confirmed.** When `referral` is absent (the normal, non-ad case — the overwhelming majority of inbound WhatsApp contacts), `source` stays `'whatsapp'`, `ctwaClid` defaults to `null`, and no `tags` key is added at all — regression-tested explicitly (`tests/conversationalAgentService.test.js`'s "referral ABSENT" test, `tests/whatsappFirstContactBotEngaged.test.js`'s referral-absent test asserting the sibling welcome-message/`whatsapp_conversation_started` behavior is unchanged on the exact same request shape).

**Tests.** `tests/customerIdentityService.test.js`: `ctwaClid`/`source`/`tags` all stored correctly on create; absent `data.ctwaClid` defaults to `null` with no regression to the `source: 'whatsapp'` path; multi-tenant scoping — two companies creating a lead with different `ctwaClid` values in the same run never cross-contaminate (each lead's `PK`/`ctwaClid` traced back to its own call only). `tests/conversationalAgentService.test.js`: `referral` present sets `ctwaClid`/`source: 'ctwa'`/tag-from-headline; no headline falls back to `source_id`; `referral` absent or explicitly `null` behaves identically, `source` stays `'whatsapp'`, no `tags` key added. `tests/whatsappFirstContactBotEngaged.test.js`: the real webhook route threads a `referral` block on the inbound message straight into `maybeStart()`'s call args unmodified; its absence still calls `maybeStart()` with `referral: null` and leaves the sibling welcome/`whatsapp_conversation_started` wiring completely unchanged. Full suite green — 1947/1948 (the one failure the same pre-existing, unrelated `documentExtraction.test.js` PDF-fixture issue tracked in `docs/phase3/TECHNICAL_DEBT.md`).

**Open item, not settled by this change or the audit:** whether this WABA actually has ad-attribution tracking enabled in Meta Business Settings — a prerequisite for `referral` to ever arrive, per a non-Meta source the audit couldn't independently confirm. Worth checking in Meta Business Manager before assuming this captures anything in production without that toggle.

**Reference:** `src/routes/whatsapp.js` (message-loop `referral` extraction, `maybeStart()` call site), `src/services/ConversationalAgentService.js` (`maybeStart()`), `src/services/CustomerIdentityService.js` (`resolveOrCreate()` JSDoc, `_createCustomer()`'s `leadItem`), `docs/adr/ADR-013-customer-identity.md` (the reserved `'ctwa'` source value), `docs/phase3/TECHNICAL_DEBT.md` (the deferred INBOX# caching entry).

---

## Era 53 — Meta Signal: Conversions API conversion reporting as a reusable automation node (2026-07-18)

**What shipped.** A new `meta_signal` automation action node (sibling to `send_flow`/`add_tag`) that reports a conversion event to Meta's Conversions API for Business Messaging when a workflow reaches it — the closing of the CTWA loop Era 52 opened: leads arrive with `ctwaClid`, and now a `tag_added`-triggered workflow (e.g. tag `demat_opened` → event `QualifiedLead`) reports the outcome back to Meta for ad optimization. Backed by a new `CapiService` (`src/services/CapiService.js`, ADR-019) owning dataset auto-provisioning, the payload contract, once-ever dedup, and CAPILOG# observability. v1 is clean-`ctwa_clid`-match only: organic leads (no stored click id) are skipped silently with a logged reason. Offline PII-hashed matching is explicitly v2, not built.

**Preceded by a dedicated 8-question audit (this same date, Meta docs fetched and verified directly, not assumed).** Two audit findings overrode the original implementation spec, both resolved with the business owner via explicit choice BEFORE any code:
1. **Fixed event list, no custom names.** The spec asked for free-text event names ("custom like DematOpened", with a "Lead" preset). Meta's BM-CAPI doc enumerates a fixed 14-event set (Purchase, LeadSubmitted, QualifiedLead, InitiateCheckout, AddToCart, ViewContent, OrderCreated/Shipped/Delivered/Canceled/Returned, CartAbandoned, RatingProvided, ReviewProvided) — and bare "Lead" is not a valid BM name. Decision: dropdown of the 14 in the editor + `SUPPORTED_EVENTS` allowlist enforcement in `CapiService` (typed `UNSUPPORTED_EVENT_NAME` rejection before any Meta call). Per-product identity stays in tags/workflows.
2. **event_id is not a dedup mechanism on this channel.** The spec's locked decision derived "reports once ever" from a deterministic `event_id` — but Meta's doc states verbatim it does NOT deduplicate business-messaging events, and the engine's own fire paths genuinely double-fire (one PUT adding two tags fires `tag_added` twice with identical contexts, so a `has_tag`-gated workflow starts twice; remove-then-re-add re-fires by design; a concurrent-PUT TOCTOU race double-fires). Decision: claim-first conditional-put marker on the lead partition (`SK: CAPI#{metaEventName}`, `attribute_not_exists(PK)`, deliberately **no TTL** — ENROLLED#'s "expiry re-triggers an outbound side effect" reasoning), with the deterministic `event_id` (`{companyId}:{leadId}:{metaEventName}`) kept in the payload as hygiene. CAPILOG# keeps its TTL because it is observability, not the guard.

**Business-owner decisions locked before implementation:** dataset auto-provisioned per company via Meta's create-or-return `POST /{waba_id}/dataset`, cached as `capiDatasetId` on `CONFIG#WABA#` via targeted SET (manual entry honored as fallback by the same cache check); node config `{ metaEventName, valueField? }` with `valueField` limited to a selector (today only `expectedValue` — the audit found it live end-to-end but sparse, an estimate not a confirmed amount; no purchase-amount capture built, v2); dedicated TTL'd `CAPILOG#{companyId}` log entity (90d) with status `sent|failed|skipped` + reason, NOT ridden on AI usage tracking; user-facing name "Meta Signal" throughout.

**Ordering subtlety worth remembering:** in `reportForLead()`, the WABA gate + dataset resolution run BEFORE the claim — caught during self-review: claim-first-then-gate would burn the once-ever claim on a mere config error (WABA disconnected), permanently losing the conversion even after the config was fixed. Only a post-claim `/events` POST failure is terminal (not auto-retried, ENROLLED# precedent, visible as a `failed` CAPILOG# row + a failed node in the execution path — the engine case throws on `failed` so the execution record is truthful, and the runner's per-node catch keeps the workflow running, sibling semantics).

**The payload contract, doc-verified and contract-tested:** `action_source: "business_messaging"` and `messaging_channel: "whatsapp"` hard-coded constants (`action_source: "website"` silently breaks CTWA attribution — Meta's most common CAPI bug); `ctwa_clid` inside `user_data` UNHASHED next to `whatsapp_business_account_id`; `partner_agent: "APForce"`; optional `custom_data: {value, currency: "INR"}` only when the configured `valueField` resolves to a positive number on the freshly-fetched lead. The lead re-fetch at node-execution time is REQUIRED, not an optimization — the audit proved no trigger's frozen context carries `ctwaClid`, and wait-resume replays stale context anyway (`ctwaClid` is create-only/immutable, so fetch-at-fire is always correct).

**Gate detail:** `CapiService` uses the `FlowManagementService` gate (accessToken AND wabaId AND `detectInvalidWabaConfig` clean), NOT the send service's accessToken+phoneNumberId check — the dataset hangs off the WABA and the OAuth path can legitimately store `wabaId: null`.

**Purely additive, confirmed:** workflow selection is by trigger type; the dispatch switch gains one case; stored workflow JSON authored before this change cannot contain the type; the no-allowlist save path already accepted unknown node types (they degrade to a failed node + continue). Existing suites untouched and green.

**Tests (34 new).** `tests/capiService.test.js` (28): the CRITICAL payload assertions (exact `action_source`/`messaging_channel` strings, unhashed `ctwa_clid`, event_id/partner_agent), WABA-gate rejection matrix including reportForLead's no-claim-burned config-failure property, allowlist rejection of "DematOpened" plus acceptance of all 14, provision-then-cache (second call zero Meta calls), first-send provisions-then-posts-to-new-dataset, 502 on id-less Meta response, best-effort cache-write failure, multi-tenant non-cross-contamination (per-PK config mock, both directions asserted), once-ever claim shape (no `ttl` attribute on the claim, `attribute_not_exists(PK)`), duplicate-fire skip, value inclusion/clean omission, failed-POST claim-retention. `tests/automationEngine.test.js` (+6): lead re-fetch wiring into `reportForLead`, no-lead-context and lead-missing skips without service calls, skip pass-through, failed→throw sibling semantics, config validation. Full suite 1983/1983 green (the long-flaky `documentExtraction` PDF test passed this run too); dashboard eslint + `tsc --noEmit` clean.

**Open items, explicitly NOT closed by this change:** (1) the token needs `whatsapp_business_manage_events` with advanced access — an App-Dashboard application the business owner must start before ads launch, no code involved; (2) Meta's docs are silent on whether a conversion reported weeks after the click still gets credited in ads reporting — verify live once ads run; (3) `tag_added` still fires ONLY from the single-lead CRM PUT — tags added at creation, by bulk ops, or by an `add_tag` node do not trigger conversions (pre-existing engine behavior, flagged in the audit, accepted for v1); (4) no admin UI reads CAPILOG# yet — the entity accrues from day one, a surface can come later; (5) whether this WABA has ad-attribution tracking enabled in Meta Business Settings (Era 52's open item) still unverified.

**Reference:** `src/services/CapiService.js`, `src/core/entityKeys.js` (`capiClaimSK`/`capiLogPK`/`capiLogSK`), `src/services/AutomationEngine.js` (`meta_signal` case), `dashboard/src/types/automations.ts` (`META_SIGNAL_EVENTS`, `MetaSignalConfig`), `dashboard/src/components/automation/MetaSignalEditor.tsx` + `canvas/nodes/MetaSignalNode.tsx` + palette/panel/canvas registrations, `docs/adr/ADR-019-capi-service-boundary.md`.

---

## Open architectural questions / not yet decided

These are documented gaps or deferrals found directly in ADRs, Phase 2 docs, or
CLAUDE.md — not speculation. Each is a place where the codebase's current state and its
stated rules diverge, and a future engineer (or AI) should not assume the rule is
already fully enforced just because an ADR exists.

1. **ADR-013 migration status — 2 of the original 3 tracked entry points still
   non-compliant; CSV bulk import fixed 2026-07-02 (see Era 8).** The root `CLAUDE.md`
   "Migration status" checklist this item used to cite verbatim no longer exists in that
   file — `CLAUDE.md` was rewritten to a terser form in the same window as the Era 8 fix.
   This Bible is now the authoritative record:
   - WhatsApp webhook unknown-contact path (`whatsapp.js`, around line 1360 as of
     `50771ba` — verify current line before citing) — still no phone lock before
     `INBOX#` creation. **Not fixed, deliberately out of scope for Era 8.**
   - `contacts.js` — still deduplicates using raw `l.phone`, not `l.phoneNorm`, in its
     read-time display-merge logic. **Not fixed** — note this is a different bug class
     than the other items on this list (a stale display-dedup comparison, not a
     bypassed-creation-path issue), so a straight "migrate to CIS" fix doesn't apply to
     it the way it did to the creation paths.
   - ~~CSV bulk import (`crm.js`) — in-memory scan dedup, not GSI.~~ **Fixed 2026-07-02**
     (Era 8): the new-lead branch now calls `CIS.resolveOrCreate()`, closing the race.
     The explicit `duplicateAction=overwrite` branch is intentionally still a direct
     update — not a re-introduction of the original bug, a deliberate scope boundary
     (see Era 8 for why).

   Also fixed in the same pass, beyond this original 3-item list: `crm.js`'s
   `POST /leads` and both of `forms.js`'s lead-creating routes — these were bypassing
   CIS too but were never on `CLAUDE.md`'s original tracked checklist. Treat "ADR-013
   fully enforced" as still false overall (2 of 6 known paths remain open), but
   materially less false than before Era 8.

2. **CampaignScheduler Scan is an explicitly interim decision (ADR-014).** The ADR
   itself defines the exact conditions that should trigger revisiting it (see Era 7
   above: ~1M items in `DYNAMODB_TABLE_METRICS`, ~50 companies with active campaigns, or
   CloudWatch showing disproportionate read-capacity use). This is not a "temporary
   hack nobody tracks" — it is a tracked, conditionally-triggered migration — but no GSI
   work has started as of this document's date.

3. **Two identity/normalization systems coexist by design, not by accident, but the
   boundary is easy to violate.** `LEAD#` records use 10-digit `phoneNorm`
   (`to10Digit()`); the Phase 2 `ContactService`/`CONTACT#` entity uses E.164. ADR-013
   rules that `LEAD#` is the source of truth for messaging/dedup and `CONTACT#` records
   link to leads via `leadItem.contactId`, but does not remove the E.164 system. Any new
   code that reads phone identity from `ContactService` instead of the `LEAD#`/GSI path
   would silently violate ADR-013 without tripping an obvious lint or test — this is a
   documented risk area, not a resolved one.

4. **E2E tests are present but explicitly non-blocking.** `946ceed` (2026-07-01) made
   the E2E job non-gating so "dashboard deploy is never gated." No later commit in this
   history reverses that. This means a red E2E suite does not currently prevent a
   production deploy — worth flagging to anyone assuming CI green implies E2E passed.

5. **Phase 2 frontend ADR-010** (`docs/phase2/DESIGN_DECISIONS.md`) explicitly defers a
   decision rather than making one: whether to merge CRM Pipeline into Contact Hub as a
   view mode (`/admin/contacts?view=pipeline`) is deferred to "Phase 3." No Phase 3 CRM/
   Contact Hub merge commit was found in this repo's history as of `50771ba` — this
   remains an open, explicitly-deferred decision.

6. **`/home`'s primary data source, `GET /api/v3/my-work`, does not exist.** First found
   and partially patched (crash only) in `508f992` (2026-07-02); re-confirmed still
   missing during the 2026-07-05 Dashboard Audit (Era 18). Every widget fed by this query
   — Urgent Replies, Overdue Follow-ups, Today's Follow-ups, Recent Contacts, all 4 KPI
   cards — has always rendered on empty/zero `placeholderData` in production, with no
   visible error to the user. The 2026-07-05 AI Insights work deliberately did not fix
   this — it shipped as a separate, additive section with its own independent queries
   instead. **Not fixed. No design work has started on what `/api/v3/my-work` should
   actually aggregate.**

7. **No formal ADR governs the V3 "business operating system" navigation framing.**
   User-facing project memory (outside this repo's tracked files) describes the V3
   rollout (`efe9c7c`, Era 4) using that phrase, but no commit message, ADR, or
   CLAUDE.md text in the repository itself uses it — it is not possible to verify this
   framing against git history. Treat the V3 UI overhaul's *technical* shape (design
   tokens, component library, `(v3)` route group) as verified fact, and any
   "business operating system" branding language as unverified framing.

8. ~~**`AISection.tsx`'s `MODULES` array was missing `inbox-template-suggestion`.**~~
   **Resolved 2026-07-05.** Found during the full system audit: the hand-maintained
   array (`dashboard/src/components/v3/settings/AISection.tsx`) listed only 4 of the 5
   live useCases, leaving admins with no per-feature toggle for
   `inbox-template-suggestion` — only the master AI kill switch, which disables every
   AI feature at once. Fixed same-day by adding the missing entry. This class of gap
   (a hand-maintained registry mirror silently falling behind `aiConfig.js`) has no
   structural guard against recurring the next time a useCase ships — worth a lint rule
   or generated list if a 6th useCase is ever added.

9. **The Approval queue's "approve → send" gap is a standing, deliberate architectural
   gap, not a bug awaiting a fix.** Confirmed twice now — once when the queue itself
   was built (Era 13), once again when the first real `customerFacing: true` useCase
   shipped and still didn't close it (Era 16), and re-verified a third time in the
   2026-07-05 full system audit with no change. `POST /api/approvals/:id/resolve` only
   flips status; nothing in the codebase reacts to `status: 'approved'`. This applies
   to any future `customerFacing: true` useCase that force-routes to Approval, not just
   `inbox-template-suggestion` — there is no per-useCase send-dispatch mechanism at all
   today. Whoever builds the next `customerFacing` feature needing a live
   approved-suggestion pipeline (ADR-016's "AI Chat with Customers" is the most likely
   candidate) owns closing this, in that feature's own commit.

10. **`wonAt` is permanently null — no code anywhere sets it to a real value.** One of
    `crm.js`'s own documented "reserved future-ready fields" (`07_DATABASE.md` §2.1),
    confirmed via a repo-wide grep in the 2026-07-05 full system audit: every write
    site either initializes it to `null` or preserves an existing (always-null) value.
    Concrete consequence: `LeadScoringService.js`'s `isClosedLead()` checks
    `lead.stage === 'lost' || Boolean(lead.wonAt)` — the second half of that OR is dead
    code in practice today, since `wonAt` never holds a truthy value. Only
    stage-based lost-detection actually fires. Not a regression from tonight's Lead
    Scoring work — the field was already unpopulated before that feature was built;
    Lead Scoring's formula just inherited the gap.

11. **`HealthScoreBadge` remains dormant, hardcoded `aiEnabled={false}` at both call
    sites** (`dashboard/src/components/contacts/ContactHeader.tsx`), fed a
    `contact.healthScore` field nothing ever populates. Documented as a fast-follow
    candidate when found during the Lead Scoring work (2026-07-03) and re-confirmed
    unchanged in the 2026-07-05 full system audit. A near-identical hot/warm/cold
    0-100 concept to `LeadScoringScheduler`'s `priorityTier`/`priorityScore` already
    exists and is live (`PriorityBadge.tsx`) — whether `HealthScoreBadge` should be
    wired to that same data or represents a genuinely separate metric is an open
    product question, not yet decided.

12. **135 pre-existing ESLint problems (57 errors, 78 warnings) across ~20 dashboard
    files, confirmed via `git blame` to predate the 2026-07-05 session entirely** (the
    flagged lines trace to `2026-06-30`/`2026-07-01` commits — the V3 rollout and its
    immediate aftermath). Found via a full, non-incremental `eslint` run across
    `dashboard/src/` during the full system audit — `next build` does not catch these
    (this Next 16/Turbopack setup does not run ESLint as part of `next build` at all;
    confirmed by direct inspection of a fresh build's log). Mostly the newer
    `react-hooks/set-state-in-effect` / `react-hooks/purity` / `react-hooks/refs` /
    `react-hooks/static-components` rules bundled with the current `eslint-config-next`
    version — none introduced by anything shipped this session; every file this
    session's features touched is clean. Tracked as known debt, not new breakage — a
    literal `npm run lint` would surface all 135 today.

13. **Two known, deferred `GUARDRAIL_PATTERNS` false positives — `/\bsure[- ]?shot\b/i`
    and the v2 "best fund" endorsement pattern — found during Phase 2A PR 2's live
    verification (2026-07-07, see Era 26), not fixed.** Same class of issue as the
    "guarantee" word false positive documented at Era 22 and eventually fixed at Era 26:
    a compliant refusal can naturally contain the literal phrase a pattern matches on
    ("no one can promise a sure shot on trades", "can't crown a single best fund for
    you"), tripping `violatesGuardrail()` even though the reply itself is safe. Unlike
    "guarantee" (reproducible on essentially every live run), each of these appeared only
    once during PR 2's live-verification runs — not proven reproducible enough to justify
    fixing yet, so deliberately left un-exempted rather than patched. Applies in both
    places that call `violatesGuardrail()`: live customer conversations
    (`ConversationalAgentService.js`'s post-generation check discards the reply and
    forces an unnecessary handoff via `HANDOFF_MESSAGE`) and the admin `/ai-admin` Prompt
    Management test gate (`PromptTestService.js` — shows as a genuine, non-`knownIssue`
    FAIL). **Not fixed, deliberately out of scope for PR 2** — revisit if either becomes
    reproducible/frequent enough to matter, the same trigger condition that eventually
    got "guarantee" fixed.

14. **Document Knowledge (PR 4, Era 28) has no malware/AV scanning — a deliberate,
    explicitly-decided gap, confirmed infeasible in that PR, not silently omitted.**
    Verified directly against the live AWS account during PR 4's audit: no GuardDuty
    detector exists in any region for this account, no AV Lambda layer exists, and the
    Lambda itself is 512MB/30s — not sized for an inline scan even if a layer existed.
    Real scanning would mean enabling GuardDuty S3 Malware Protection account-wide (a
    standalone cost/security decision) or standing up a dedicated ClamAV-Lambda
    pipeline — both out of scope for a single feature PR. File-signature validation
    (`src/utils/fileSignature.js`) closes the "wrong content behind a trusted extension"
    gap but does **not** scan for actual malicious payloads. Two further, smaller
    limitations in that same file, both intentional trade-offs of staying dependency-free
    for a bounded format list: OOXML (.docx/.xlsx/.pptx) sub-type detection is a
    substring scan for a marker path (`word/`/`xl/`/`ppt/`), not a full ZIP
    central-directory parse — closes the realistic "renamed .exe" attack but a
    deliberately crafted ZIP could in theory fake the marker path; legacy OLE2
    (.doc/.xls/.ppt) is validated as "genuinely an OLE2 compound file" only, not
    distinguished between the three sub-types at the byte level (would need real CFBF
    directory parsing). **Not fixed, deliberately out of scope for PR 4** — revisit if
    Document Knowledge's usage grows enough to justify a dedicated AV-scanning project.

15. ~~**PRE-LAUNCH BLOCKER — the Voyage AI account has no payment method attached,
    capped at the free tier's 3 requests/minute (found during RAG PR A's live
    verification, Era 29).**~~ **Resolved same day (2026-07-07), shortly after Era 29
    was written** — a payment method was added and a $5 recharge applied. Empirically
    re-confirmed at RAG PR C's closeout (Era 31), not just taken on record: 5
    sequential and 10 fully concurrent real `EmbeddingService.embed()` calls, zero
    pacing, all 15 succeeded — far beyond what a real 3 RPM cap would tolerate.
    `EmbeddingService`/`KnowledgeService` still handle a rate-limit-style rejection
    gracefully if one ever occurs again (fallback to keyword matching, no crash) —
    that resilience code path is unchanged and still worth knowing about, it's just
    not currently being triggered by this specific, now-resolved constraint.

16. **Document chunk retrieval (RAG PR C, Era 31) uses an in-process brute-force
    cosine scan, an explicit interim decision, not a silently-accepted limitation.**
    Tracked in `docs/adr/ADR-018-document-chunk-retrieval-scan.md`, mirroring
    ADR-014's CampaignScheduler precedent but with more conservative revisit
    triggers, since this runs on every conversational turn (not a 5-minute sweep):
    a company's active chunk count crossing ~500-1,000, the number of companies
    running both the agent and published documents passing ~20-30, CloudWatch
    showing this step dominating turn latency, or `DYNAMODB_TABLE_METRICS`
    crossing ~1M items. **Not fixed, deliberately out of scope until real traffic
    shows one of those triggers** — revisit by adopting a real vector index
    (e.g. OpenSearch k-NN) only then, not preemptively.

17. **A third known guardrail false-positive phrasing found during Era 32's Haiku
    re-verification, same standing "not reproducible enough to fix" treatment as
    the other two (`PromptTestService.js`'s documented sure-shot and best-fund
    cases).** The reply "No, SIPs don't come with a guarantee on returns — the
    market moves..." (a fully compliant refusal) trips
    `GUARDRAIL_PATTERNS`' literal `/\bguarantee(d|s)?\b/i` match, and does **not**
    match the existing `NEGATED_GUARANTEE_PATTERN` exemption in
    `PromptTestService.js` (checked directly — that regex looks for a "no
    one/nobody/can't/won't...guarantee" shape; "No, SIPs don't come with a
    guarantee" isn't that shape). Not fixed here, deliberately: out of scope for
    Era 32's model-cost change, and per the same explicit decision already on
    record for the other two false positives — `GUARDRAIL_PATTERNS` itself is
    the single most safety-critical pattern in the codebase and is not touched
    reactively for a single non-reproduced phrasing. An admin hitting this is
    expected to read the actual reply and judge it themselves, same as the
    already-documented design.

18. **2026-07-09 — `docs/v3/12_DECISION_LOG.md`'s DL-005 ("Merge team_lead Role
    into manager") was never actually implemented in backend authorization; the
    real, code-verified state is now ratified as intentional, not drift, and
    DL-005 is marked Superseded by a new DL-021 in that same file (full
    context/decision/rationale there, not duplicated here).** `team_lead`
    remained a real, distinct `checkRole()` role throughout: `manager` has
    broad, company-wide access across `attendance.js` (leave admin),
    `compensation.js` (payroll/adjustments), `crm.js` (leads/import/stats/
    analytics), and most of `metrics.js`'s admin routes; `team_lead` has a
    narrow metrics/points-only surface (`performers`, `my-team` — team_lead-only,
    manager can't call it — `add-for-member`, `points.js`'s `award`), absent
    entirely from `attendance.js`/`compensation.js`/`crm.js`'s `checkRole()`
    lists, and where it does have access it's hard-restricted to its own team
    via `teamLeadId` checks in `resolveTargetUserId()`/`add-for-member`
    (`metrics.js:95`, `metrics.js:1041`) that `manager` doesn't have. The only
    place a merge actually happened is the frontend *display* layer —
    `toV3Role()` (`dashboard/src/types/v3.ts`) maps both raw roles to the same
    `'manager'` UI bucket, presentation only, never touched backend
    authorization. Decision by Viir: keep the code as-is (team-scoped
    delegation is a real, useful feature for SMB sales teams), correct the
    docs instead. `09_PERMISSION_MATRIX.md`, `06_ROLE_BASED_EXPERIENCE.md`,
    `11_PHASE3_IMPLEMENTATION_PLAN.md`, and `ARCHITECTURE_AUDIT.md` all
    annotated/corrected in the same pass — see each file's own note. Standing
    rule now written down in `09_PERMISSION_MATRIX.md` and
    `06_ROLE_BASED_EXPERIENCE.md`: `v3Role`/display buckets (from `toV3Role()`
    or equivalent) must never be used for permission gating anywhere, only raw
    roles — this exact confusion (conflating the display collapse with a real
    permission merge) is part of what let DL-005's stale claim stand
    unnoticed, and was separately the root cause of an entire class of RBAC
    bugs fixed this session (Wave 2).

19. **2026-07-10 — second instance this week of an incoming diagnostic/audit
    claim contradicting directly-verified code or log evidence; both times
    caught by re-verification before any implementation, not after.** First:
    the single-editor-migration "audit" (Fix 1-4 premises) claimed a
    `nodeDataSchemas` sanitizer bug at `automations.js:80-90`, a missing canvas
    delay node, and "3 linear workflows, 2 with `send_template`" — none of
    which matched the actual codebase (`nodeDataSchemas` never existed in git
    history at any commit; the delay node had shipped 2026-07-04; a live table
    scan found exactly 1 linear workflow, `assign_employee`+`end`, zero
    `send_template`). Second: the bulk-actions "reconciliation" claimed the
    Contacts-page bulk assign/tag partial failures were "a read-modify-write
    race... all HTTP 200, no rate limiting involved" — contradicted by
    CloudWatch evidence already gathered in the same session (real 429s and
    503s, `assignLead()` confirmed to be an unconditional `SET` with no
    read-modify-write at all, and bulk operations always target distinct
    contacts so can't collide with themselves). **How both resolved:** the
    real findings were kept and acted on — the migration's actual (much
    smaller) scope shipped as `76fa6ef`/`acc822b`; the bulk-actions fix kept
    the correct concurrency-ceiling root cause while separately confirming a
    genuinely different race *did* exist (`ContactTags.tsx`'s same-contact
    rapid-tag-toggle path) and fixed that too, with a deterministic
    concurrency test proving the old code lost an update and the new code
    doesn't. In both cases the incorrect claim was corrected in-place (code
    comments, this log) rather than left standing or silently overwritten.
    Standing practice, not new after this entry: verify a claim against
    actual code/live data/logs before building on it, especially before any
    production write path or real-data mutation — see
    `feedback_hold_for_review_covers_data_mutations` in session memory for the
    adjacent rule this pattern also produced.

20. **2026-07-09, still unresolved as of 2026-07-12 — `team_lead`'s Contacts-module scope
    (own-only vs. team-wide) is a real product decision awaiting Viir's call, not yet
    made.** Found while extracting `contacts.js`'s `GET /` fetch+merge+filter logic into a
    shared helper for the new export route (Track A, see Era 44 above):
    `docs/v3/09_PERMISSION_MATRIX.md` documents `team_lead` as seeing "Team" contacts and
    being able to export team contacts, but `contacts.js`'s actual RBAC check is binary —
    `isAdmin ? everything : own-assigned-only` — with no "team" tier at all, so `team_lead`
    currently falls into the same own-only bucket as `agent`/`telecaller`/`intern`. This is
    a different file, and a different finding, from item 18/DL-021 above (which resolved
    `team_lead`'s scope in `attendance.js`/`compensation.js`/`crm.js`/`metrics.js`) — it
    confirms `team_lead`'s real backend scope is inconsistently documented/implemented
    across files, not that this specific gap was part of DL-021's resolution. **Not a
    drive-by fix candidate:** implementing team-scoping and correcting the permission
    matrix to state own-only behavior are both legitimate outcomes: only Viir can decide
    which matches the actual product intent for Contacts specifically. Tracked as a
    standing open item in `docs/PENDING_WORK.md` (Product decisions awaiting Viir's call)
    so it doesn't only live in this log's history. **Reference:**
    `docs/phase3/TECHNICAL_DEBT.md`'s "Contacts RBAC: team_lead sees team Is Documented But
    Not Implemented" entry; `docs/v3/09_PERMISSION_MATRIX.md`; item 18 above/DL-021 in
    `docs/v3/12_DECISION_LOG.md` (the resolved, adjacent-but-different finding).

21. **2026-07-18, found while fixing Stage 7's InboxContext doc cleanup — `docs/phase2/DESIGN_DECISIONS.md`'s ADR-004 ("ChatPane is Reused Without Modification") never actually happened.** The decision as recorded: reuse `ChatPane` verbatim in Customer 360's Conversation tab, adapted only via props, specifically to avoid a second implementation of message rendering/WS integration/send/template-picker/media. What was actually built, `ConversationTab.tsx`, does not import or reuse `ChatPane` at all (confirmed by reading its imports) — it implements its own conversation UI directly, reusing only two smaller pieces from the legacy `components/whatsapp/` folder, `TemplatePicker.tsx` and `MediaPreviewModal.tsx`. `ChatPane.tsx` itself was later deleted entirely (along with `InboxContext.tsx`, which it depended on) rather than kept and adapted per the ADR. This is a real decision-outcome gap — the recorded reasoning (avoid a second implementation) was not honored by what shipped — not just a stale file reference, which is why it's logged here rather than only annotated in place at `DESIGN_DECISIONS.md` (see that file's own inline "Superseded" note on ADR-004, added the same pass, for the doc-cleanup side of this). **Reference:** `docs/phase2/DESIGN_DECISIONS.md`'s ADR-004; `dashboard/src/components/contacts/tabs/ConversationTab.tsx`'s import list; `docs/bible/08_MODULES.md`'s `InboxContext.tsx` entry (the fuller history of both files' deletion).
