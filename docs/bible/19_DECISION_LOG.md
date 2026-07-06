# 19 — Decision Log

Status: verified against repo state 2026-07-02 (commit `50771ba`, branch `main`).

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
