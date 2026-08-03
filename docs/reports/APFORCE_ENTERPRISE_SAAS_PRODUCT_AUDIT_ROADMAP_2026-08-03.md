# APForce Enterprise SaaS — Product Audit & Implementation Roadmap

**Version:** 1.0 (Frozen for Implementation)  
**Date:** 2026-08-03  
**Updated:** 2026-08-03 (Founder Final Review — Product Development Principles; Version 1.0 freeze)  
**Status:** Product-frozen. Scope and phases are fixed. Implementation proceeds only after Founder Approval Checklist.  
**Mode:** Audit / Product Bible — no implementation until each phase is Founder-approved  
**Stance:** Do not redesign shipped CRM, WhatsApp Inbox, backend/Dynamo single-table architecture, or Journey payment foundation. Improve packaging, navigation, entitlements, Super Admin, RBAC, add-ons, and enterprise gaps around what already works.

**Grounding:** `docs/bible/20_CURRENT_STATE.md`, `08_MODULES.md`, `docs/v3/09_PERMISSION_MATRIX.md`, `docs/PENDING_WORK.md`, `src/utils/featureFlags.js`, `src/middleware/auth.js`, `src/routes/platform.js`, dashboard `(v3)` nav/settings.

**Priority legend:** P0 = revenue/trust blocker · P1 = near-term enterprise sale · P2 = differentiation · P3 = polish  
**Complexity:** S (&lt;1w) · M (1–3w) · L (3–8w) · XL (&gt;8w)  
**Business impact:** High / Medium / Low

---

## Document quality freeze (Founder review — final before Bible freeze)

**Status:** Feature-complete. No new phases or product areas. This pass adds **implementation readiness** only: consistent phase envelopes, feature architecture cards, Super Admin action matrices, module maturity scale, roadmap scoring dimensions, cross-references, and Founder Approval Checklist.

### Phase envelope (required on every Phase)

Every Phase below includes:

| Block | Purpose |
|-------|---------|
| **Objectives** | Why this phase exists |
| **Scope** | Boundary statement |
| **In Scope** | Allowed work |
| **Out of Scope** | Explicit non-goals for this phase |
| **Dependencies** | Other phases / systems (cross-refs) |
| **Risks** | What can go wrong |
| **Success Criteria** | Done when… |
| **Future Enhancements** | Deferred, not in this phase |

### Feature Architecture Card (required fields)

Every named feature / recommendation is governed by:

| Field | Meaning |
|-------|---------|
| Business Purpose | Why customers/APForce need it |
| User Roles | Who uses it |
| Data Owner | Service / store / role that owns writes |
| Source of Truth | Canonical store |
| Dependencies | Phases, modules, entitlements |
| API Impact | Routes / contracts affected (architecture only) |
| UI Impact | Surfaces affected |
| Mobile Impact | Mobile readiness expectation |
| Security Considerations | AuthZ, tenancy, secrets |
| Audit Requirements | What must be logged |

Cards appear as compact tables under each phase (**architecture only — no implementation**).

### Super Admin action verbs

Super Admin capabilities use: **Create · Read · Update · Delete · Suspend · Restore · Override · Approve · Export · Audit**.

### Module maturity scale

| Stage | Meaning |
|-------|---------|
| Prototype | Spike / internal only |
| Beta | Flagged tenants |
| Production | Generally available |
| Enterprise Ready | Packaged, entitled, audited, supportable |
| Future | Roadmapped, not started |

### Roadmap scoring dimensions

Every roadmap item: **Effort** (S/M/L/XL) · **Business Value** (High/Medium/Low) · **Revenue Impact** · **Customer Impact** · **Technical Debt Reduction**.

---

## Executive verdict

APForce is a **working multi-tenant WhatsApp CRM + automation SaaS**, not a greenfield product. The gap vs Salesforce / HubSpot / Interakt / WATI / Zoho is not “missing Inbox/CRM” — it is **commercial packaging**: plans, entitlements, Super Admin depth, billing self-serve, RBAC clarity, feature-flag productization, and enterprise admin UX.

| Dimension | Today | Target |
|-----------|--------|--------|
| Tenancy | Strong (`companyId` PK + JWT) | Keep |
| Core ops (Inbox, CRM 360, Automations, Campaigns launch) | Shipped | Keep; fill stubs only |
| Journey + customer payments | Sandbox-proven; Live Founder-gated | Keep architecture |
| SaaS plans | Manual `trial/paid/enterprise/internal` | Starter → Enterprise catalog |
| Feature flags | Dynamo two-tier; mostly unwired defaults | Full lifecycle states + UI |
| Super Admin | Companies / plan / suspend / AI costs | Full control plane |
| Billing UI | Stub | Self-serve + add-ons |
| White-label | Journey branding only | Enterprise add-on |
| Impersonation | None | Support tool (audited) |

**Do not rewrite:** Customer 360 frozen tabs, ADR-012/013/015, AutomationEngine graph, Razorpay journey payment path.

---

## Phase 1 — Product Audit (IA / UX / discoverability)

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Improve IA, navigation, discoverability, and admin/mobile usability without rewriting shipped CRM/Inbox. |
| **Scope** | Product/UX audit of navigation and settings discoverability. |
| **In Scope** | Nav regroup proposals; settings stub policy; plan-lock UX patterns; discoverability for Templates/IG/Journeys. |
| **Out of Scope** | No CRM 360 tab redesign; no Inbox rewrite; no new modules. |
| **Dependencies** | See Phase 8 (Settings); See Phase 6 (RBAC display vs raw); See Phase 3 (FeatureGate); **Requires Metadata Engine** (PME) for long-term nav. |
| **Risks** | Over-hiding HR nav alienates existing HR tenants; plan-lock UX feels paywall-heavy. |
| **Success Criteria** | Documented IA target; stub kill/ship list; discoverability gaps closed in backlog with P0–P3. |
| **Future Enhancements** | Adaptive nav by Industry Pack (See Phase 11). |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Plan-lock / upgrade tease UX (P1-08) | Convert invisible flags into upgrade path | All entitled roles | Entitlements service | Entitlement evaluation result | Phases 2–3; PME | FeatureGate middleware | Lock cards on routes | Touch-friendly lock sheets | No privilege escalation via UI hide | Optional lock-attempt analytics |
| Settings stub purge (P1-01) | Remove false coming-soon trust debt | Admin/Owner | Settings IA owner | Settings IA doc | See Phase 8 | None until ship | Settings hub tabs | Same | Do not expose unfinished security surfaces | Admin changes to settings nav |


### Information architecture (today)

**Sidebar (flat):** My Work, Inbox, Contacts, Sales, Campaigns  
**Team:** Employees, Metric Target, Audit Log, Entry, Attendance, Compensation  
**Bottom:** Analytics, Automation, AI Admin, Knowledge Center, Platform (owner), Settings  

**Orphans / dual entry:** `/templates` (not sidebar), `/instagram` (Inbox split), Flow builder under Settings, public `/journey/...`, Settings mega-tab vs dedicated pages (`/audit-log`, `/employees`).

### Findings

| ID | Finding | Priority | Complexity | Impact |
|----|---------|----------|------------|--------|
| P1-01 | Settings is a kitchen-sink `?tab=` hub with many stubs — hurts Admin usability | P0 | M | High |
| P1-02 | Templates / Instagram / Journeys poorly discoverable | P1 | S | High |
| P1-03 | HR stack (Attendance/Compensation/Entry) competes with CRM primary job for sales tenants | P1 | M | Medium |
| P1-04 | `toV3Role()` collapses roles for nav — masks real RBAC (known doc debt) | P0 | M | High |
| P1-05 | Feature flags exist but no product UI — flags feel “engineering only” | P0 | M | High |
| P1-06 | Mobile: Inbox/Composer usable; canvas Automations / Campaigns builder not mobile-first | P2 | L | Medium |
| P1-07 | White-label readiness: org branding stub; only Journey primaryColor/banner | P1 | L | High (Enterprise deals) |
| P1-08 | No in-app “what’s new / locked by plan” pattern — upgrade path invisible | P0 | M | High |

### Recommended IA (no module rewrite)

1. **Primary nav (revenue job):** Inbox · Contacts · Sales · Campaigns · Automations  
2. **Engage:** Templates · Journeys (when flagged) · Instagram (if connected)  
3. **Intelligence:** Analytics · AI · Knowledge  
4. **Company:** Settings (slim) · Team/HR (collapsible for non-HR SKUs)  
5. **Platform:** Super Admin only  

Use **plan locks / Beta pills** instead of silent hide where sales motion needs tease.

---

## Phase 2 — SaaS Packaging

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Define sellable Starter→Enterprise SKUs, limits, trials, and upgrade paths. |
| **Scope** | Commercial packaging catalog only (not payment gateway wiring). |
| **In Scope** | Plan matrix; limits; add-ons list; trial behavior; upgrade path copy. |
| **Out of Scope** | SaaS PG integration (See Phase 13); Industry Pack content (See Phase 11). |
| **Dependencies** | See Phase 3 Entitlements; See Phase 7 Add-ons; See Phase 13 Subscription Engine; **Depends on Entitlements**. |
| **Risks** | Under-pricing Enterprise; bundling Journey Payments incorrectly. |
| **Success Criteria** | Approved SKU table; trial policy written; Journey payments bundled vs add-on decision recorded. |
| **Future Enhancements** | Usage-based hybrid pricing. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Plan catalog (P2-01) | Standardize commercial offers | Super Admin, Owner (view) | Subscription Engine | SUBSCRIPTION# / company plan fields | See Phase 13 | Plan CRUD APIs (arch) | Platform + Billing Portal | N/A | Only Super Admin mutates plans | Plan Changed timeline |


### Plan catalog (proposed)

| | Starter | Professional | Business | Enterprise |
|--|---------|--------------|----------|------------|
| **Position** | Solo / micro | Growing WA desk | Multi-team ops | Group / white-label |
| **Seats** | 3 | 10 | 50 | Custom |
| **Contacts** | 2k | 25k | 150k | Custom |
| **WhatsApp numbers** | 1 | 2 | 5 | Custom |
| **Inbox + CRM 360** | ✓ | ✓ | ✓ | ✓ |
| **Campaigns (broadcast)** | 1k msgs/mo | 15k | 100k | Custom + credits add-on |
| **Automations** | 3 active | 25 | Unlimited* | Unlimited* |
| **Journeys + payments** | — | ✓ | ✓ | ✓ |
| **AI agent + Knowledge** | Trial 300 calls | Included quota | Higher quota | Custom + AI Pack |
| **Instagram** | — | Add-on | ✓ | ✓ |
| **Analytics** | Basic | Full | Full + export | Full + API |
| **Audit log retention** | 30d | 90d | 1y | Custom |
| **API keys / webhooks** | — | Read API | Full | Full + SLA |
| **SSO / custom domain** | — | — | — | ✓ |
| **White-label** | — | — | Add-on | ✓ |
| **Support** | Email | Priority | Priority + CSM | Dedicated |

\*Subject to fair-use execution caps.

### Limits & add-ons (cross-plan)

| Limit / add-on | Meter | Notes |
|----------------|-------|-------|
| Extra seats | per user/mo | Soft-block invite when over |
| Extra contacts | pack | Soft warn → hard block create |
| Broadcast credits | prepaid | Reuse WalletService seam (ADR-015) carefully — separate from AI wallet |
| AI Pack | calls + models | Enforce (today AI is soft `overQuota` only) |
| Extra WA / IG channels | per asset | Meta asset binding |
| Storage | GB | Media/docs |
| White Label / Custom Branding | boolean | Enterprise/Business add-on |
| API Access | boolean / rate | |
| Voice AI | future | Hidden until ready |

### Trial behavior

- **14-day Business trial** (or Professional + Journeys + AI): full features, watermark “Trial”, `trialEndsAt` already on JWT/`subscriptionMiddleware`.
- Day 11–14: upgrade CTA; on expiry → **read-only Inbox/CRM** or Starter caps (Founder choice — recommend read-only + upgrade, not hard lockout).
- **Hidden features:** Voice AI, Custom Objects, Marketplace — `internal` / `beta` only.
- **Upgrade path:** in-app plan comparison → Super Admin manual today → later Razorpay/Stripe **subscription** billing (distinct from Journey customer payments).

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P2-01 | Formalize Starter→Enterprise SKUs on company profile (replace ad-hoc trial/paid/enterprise) | P0 | M | High |
| P2-02 | Entitlement service: plan + add-ons → flags/limits | P0 | L | High |
| P2-03 | Self-serve Billing settings (replace stub) | P1 | L | High |
| P2-04 | Trial UX + downgrade policy | P1 | M | High |

---

## Phase 3 — Feature Flag Architecture

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Productize feature flags into entitlement-aware states. |
| **Scope** | Flag states + entitlements evaluation architecture. |
| **In Scope** | State model; Super Admin flags UI; FeatureGate; wire/retire defaults. |
| **Out of Scope** | New product modules; Marketplace listings (See Phase 12). |
| **Dependencies** | See Phase 2; See Phase 4; **Requires Metadata Engine**; existing featureFlags.js. |
| **Risks** | Overloading booleans with billing; cache staleness. |
| **Success Criteria** | Entitlements service spec; flags UI wireframes; DEFAULTS disposition list. |
| **Future Enhancements** | Percentage rollouts. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Entitlements service (P3-01) | Single evaluation of plan ∩ addons ∩ flags | System + Super Admin | Entitlements service | Computed entitlement snapshot + overrides | Phases 2, 7, 13, PME | GET entitlements; assert helpers | FeatureGate / sidebar | Same gates | Tenant isolation; no cross-company leak | Flag/override changes audited |


### Today

- Dynamo `CONFIG#FLAGS#global` / `CONFIG#FLAGS#{companyId}`; company &gt; global &gt; defaults.
- Defaults (all false): `contact_hub`, `workflow_builder`, `multi_pipeline`, `broadcast_campaigns`, `conversation_v2_ui`, `lead_timeline`, `journeys_platform`.
- Mostly unwired except `journeys_platform`. Toggle via AWS CLI, not Super Admin UI.

### Target flag states

| State | Meaning | Who sees |
|-------|---------|----------|
| `enabled` | On for tenant | Eligible roles |
| `disabled` | Off | Nobody (or lock card) |
| `beta` | Opt-in / marked Beta | Flagged companies |
| `internal` | APForce staff / `internal` plan | Super Admin + internal |
| `enterprise_only` | Requires Enterprise (or add-on) | Entitled |
| `addon` | Requires purchased add-on SKU | Entitled |
| `trial_only` | Available only while trial active | Trial tenants |

### Implementation shape (reuse)

Extend `featureFlags.js` value from boolean → `{ state, addonSku?, minPlan?, until? }` **or** keep boolean flags + separate **entitlements** layer (preferred: don’t overload flags with billing).

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P3-01 | Entitlements service (plan ∩ add-ons ∩ flags) | P0 | L | High |
| P3-02 | Super Admin Feature Flags UI | P0 | M | High |
| P3-03 | Wire or retire unused DEFAULTS | P1 | M | Medium |
| P3-04 | Frontend `<FeatureGate>` + plan lock cards | P1 | M | High |

---

## Phase 4 — Super Admin (control plane)

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Make Super Admin the control plane for tenants, entitlements, and subscriptions. |
| **Scope** | Platform console capabilities and Subscription Engine authority. |
| **In Scope** | Companies; flags; add-ons; usage; subscription console; impersonation; maintenance. |
| **Out of Scope** | Tenant product UX redesign; Journey payment ops (separate plane). |
| **Dependencies** | See Phase 13 Subscription Engine; See Phase 3 flags; See Phase 15 CS. |
| **Risks** | God-mode without audit; accidental suspend. |
| **Success Criteria** | Super Admin IA approved; subscription actions matrix enforceable; impersonation policy written. |
| **Future Enhancements** | Partner multi-tenant reseller console. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Subscription console (P4-04) | Operate every company subscription | Super Admin only | Subscription Engine | SUBSCRIPTION# | See Phase 13 | Admin subscription APIs | Platform company detail | Desktop-first | MFA; step-up for Override | Full Subscription Timeline |
| Impersonation (P4-02) | Support without password sharing | Super Admin | Auth/session service | Impersonation session + audit | See Phase 6 | Start/end impersonation APIs | Persistent banner | Banner required | Time-box; reason required | Start/end + actions |


### Today

`platform.js` + `/platform`: companies list/detail, set plan/suspend, AI costs. No impersonation, no flag UI, no add-on catalog, no Meta asset inventory, no maintenance mode.

### Target capabilities

| Capability | Priority | Notes |
|------------|----------|-------|
| Companies (create/inspect/suspend) | Exists → deepen | Health, plan, usage |
| Plans & entitlements | P0 | Catalog CRUD |
| Feature Flags | P0 | Global + per-company |
| Add-ons | P0 | Attach/detach SKUs |
| Usage Limits | P0 | Seats, contacts, AI, broadcast |
| Billing / Payment Status | P1 | SaaS invoices (not Journey PG) |
| WhatsApp Numbers / Meta Assets | P1 | WABA, phone, IG, tokens health |
| AI Usage | Exists → harden | Real pricing (PENDING_WORK) |
| Employees (cross-tenant search) | P1 | Support |
| Storage / API usage | P2 | |
| Audit Logs (cross-tenant) | Partial | Deep-link company |
| Support Tools | P1 | Resend webhook, replay wait |
| Impersonation | P1 | Time-boxed, audited, banner |
| Maintenance Mode | P2 | Global read-only |

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P4-01 | Super Admin IA: Companies · Entitlements · Assets · Usage · Support | P0 | L | High |
| P4-02 | Audited impersonation | P1 | M | High |
| P4-03 | Maintenance mode flag | P2 | S | Medium |

### Super Admin — Subscription Engine control (source of truth)

*Founder review expansion 2026-08-03. Full lifecycle detail lives in Phase 13; this subsection binds ownership to Super Admin.*

**Principle:** Super Admin is the **source of truth** for every company subscription. Company Owner Billing Portal is **read + request + self-serve payment method / add-on purchase** only — never silent plan mutation without Super Admin policy.

| Action | Super Admin | Notes |
|--------|-------------|-------|
| Create Subscription | ✓ | New `SUBSCRIPTION#` + plan + period |
| Activate | ✓ | Trial→Active or manual activate |
| Suspend | ✓ | Maps `planStatus: suspended` + entitlements freeze |
| Resume | ✓ | From Suspended/Grace when policy allows |
| Cancel | ✓ | Immediate or end-of-period |
| Extend Trial | ✓ | Moves `trialEndsAt`; timeline event |
| Change Plan | ✓ | Arbitrary plan swap (incl. Custom Enterprise) |
| Upgrade / Downgrade | ✓ | With proration rules |
| Assign / Remove Add-ons | ✓ | Entitlement refresh |
| Override Limits | ✓ | Per-meter overrides (seats, contacts, …) |
| Custom Enterprise Plan | ✓ | Bespoke limits + pricing |
| Manual Invoice | ✓ | Issue invoice without PG charge |
| Manual Payment Entry | ✓ | Record offline NEFT/cheque/etc. |
| Mark Paid | ✓ | Clear Payment Pending/Failed |
| Credit Adjustment | ✓ | Credit note / balance |
| Wallet Adjustment | ✓ | SaaS credit wallet (≠ Journey PAYMENT#) |
| Coupon Assignment | ✓ | Attach coupon to subscription |
| Referral Credits | ✓ | Apply referral balance |
| Force Expiry | ✓ | Immediate Expired |
| Reactivate | ✓ | From Cancelled/Expired/Archived |
| View Subscription Timeline | ✓ | Full audit stream (Phase 13) |
| View Billing History | ✓ | Invoices + credit notes |
| View Payment History | ✓ | SaaS charges only (label plane) |

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P4-04 | Super Admin Subscription console on company detail | P0 | L | High |
| P4-05 | All plan mutations require Super Admin (or audited policy exception) | P0 | M | High |
| P4-06 | Manual invoice / mark-paid / credit tools | P1 | M | High |

### Super Admin capability matrix (Create → Audit)

*Applies to Platform / Subscription Engine controls. ✓ = allowed for Super Admin. Company Owner column shows contrast (See Phase 13.3).*

| Capability | Create | Read | Update | Delete | Suspend | Restore | Override | Approve | Export | Audit |
|------------|--------|------|--------|--------|---------|---------|----------|---------|--------|-------|
| Company record | ✓ | ✓ | ✓ | ✓ (policy) | ✓ | ✓ | — | — | ✓ | ✓ |
| Subscription | ✓ | ✓ | ✓ | — | ✓ | ✓ (Reactivate) | ✓ limits | ✓ upgrade requests | ✓ | ✓ |
| Plan catalog | ✓ | ✓ | ✓ | ✓ | — | — | — | ✓ | ✓ | ✓ |
| Add-ons on tenant | ✓ assign | ✓ | ✓ | ✓ remove | — | — | ✓ | ✓ | ✓ | ✓ |
| Feature flags | ✓ | ✓ | ✓ | — | ✓ disable | ✓ re-enable | ✓ | ✓ beta | ✓ | ✓ |
| Manual invoice / Mark Paid | ✓ | ✓ | ✓ | — | — | — | ✓ | ✓ | ✓ | ✓ |
| Coupons / credits / wallet adj. | ✓ | ✓ | ✓ | — | — | — | ✓ | ✓ | ✓ | ✓ |
| Impersonation session | ✓ start | ✓ | — | ✓ end | — | — | — | ✓ reason | — | ✓ |
| Maintenance mode | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | ✓ | — | ✓ |
| Industry Pack install | ✓ | ✓ | — | ✓ uninstall | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| Marketplace listing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| CS / Revenue / Usage dashboards | — | ✓ | — | — | — | — | ✓ score (rare) | — | ✓ | ✓ |
| **Company Owner (contrast)** | — | Plan/Usage/Invoices | Billing details / payment method | — | — | — | — | Request upgrade | Own invoices | View subset |

---

## Phase 5 — Module Audit

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Classify module maturity and enterprise gaps without redesigning shipped cores. |
| **Scope** | Module-by-module maturity and gap backlog. |
| **In Scope** | Maturity tags; gap list; priority; freeze CRM/Inbox architecture. |
| **Out of Scope** | New modules; Custom Objects (Future). |
| **Dependencies** | See Phases 1, 8, 14; Journey payments remain foundation (not redesigned). |
| **Risks** | Treating Partial as rewrite mandate. |
| **Success Criteria** | Every module has maturity stage + gap owners. |
| **Future Enhancements** | Module Installer alignment (See Phase 14). |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Module maturity registry | Honest GA signaling | Super Admin, PMs | PME | Module metadata.maturity | PME; See Phase 14 | Read-only registry API | Platform module matrix | mobileReady flag | No fake Enterprise Ready | Maturity changes audited |


| Module | Prototype | Beta | Production | Enterprise Ready | Future | Enterprise gaps / UX | Priority |
|--------|-----------|------|------------|------------------|--------|----------------------|----------|
| **Dashboard (My Work)** | — | — | ✓ | Partial | Role-home | Unify AI widgets; role-specific home | P2 |
| **CRM / Contact Hub / C360** | — | — | ✓ | Near (fix CIS gaps) | — | CIS leftovers; CSV; docs slots — **do not redesign tabs** | P1 |
| **Inbox** | — | — | ✓ | Near | — | Composer stubs; cache consolidation; Embedded Signup config | P1 |
| **Automations** | — | — | ✓ | Partial | Dry-run UX | Exec charts; dry-run; Settings workflows stub; send_webhook | P1–P2 |
| **Journey Builder** | — | ✓ (flag) | Partial | After Live + Instances | — | Instances UI; Live payments Founder-gated; discoverability | P0–P1 |
| **Payments (Journey)** | — | Sandbox-proven | Partial | After Live Founder | Phase 2 sweeper | Sweeper/retry; not SaaS billing (See Phase 13) | P1 |
| **Templates** | — | — | ✓ | Partial | — | Sidebar discoverability; single entry | P2 |
| **Broadcast / Campaigns** | — | — | Launch ✓ | No (Audience stub) | CTWA/drip | Audience/Analytics stubs; CTWA; drip | P0 / P2 |
| **AI** | — | Soft quota | ✓ agent/RAG | No until hard quota | Compliance dash | Enforce quota; costs; compliance | P0–P1 |
| **Analytics / Reports** | — | — | Partial | No | — | Conversations/Sources stubs; export | P1 |
| **Settings** | — | — | Partial | No | — | Many stubs; split IA (See Phase 8) | P0 |
| **Subscription Engine (SaaS)** | Design | — | — | Target V1 | — | See Phase 13 | P0 |
| **HR / Attendance / Payroll** | — | — | ✓ | Optional module | — | Optional via Module Installer (See Phase 14) | P1 |
| **Marketplace** | — | — | — | — | ✓ V2–V3 | See Phase 12 | P2 |
| **Industry Packs** | — | First pack | — | — | Full suite | See Phase 11 | P1–P2 |

---

## Phase 6 — Permissions (Enterprise RBAC)

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Clarify enterprise RBAC; stop using toV3Role for authorization. |
| **Scope** | Roles, matrix, permission registry architecture. |
| **In Scope** | Owner/Finance/Marketing; raw-role gating; matrix reconciliation. |
| **Out of Scope** | SSO (V2); ABAC. |
| **Dependencies** | See Phase 4; See Phase 13 Owner portal; docs/v3/09_PERMISSION_MATRIX.md corrections. |
| **Risks** | Breaking team_lead scopes; doc/code drift. |
| **Success Criteria** | ADR: raw role authoritative; Owner≠Admin billing; Finance/Marketing defined. |
| **Future Enhancements** | Permission registry codegen. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Permission registry (P6-02) | module.action authorization | All roles | AuthZ middleware | Role→permission map | Phases 4–5, PME | checkPermission replaces ad-hoc lists | ProtectedRoute uses raw role | Same | Deny by default | Permission grant changes |


### Role model (target)

| Role | Maps from today | Intent |
|------|-----------------|--------|
| Super Admin | `superadmin` | Cross-tenant |
| Company Owner | New or tagged `admin`+owner flag | Billing, danger zone |
| Admin | `admin` | Full ops, no billing |
| Manager | `manager` | Company-wide ops |
| Team Lead | `team_lead` | Team-scoped |
| Sales | `agent` / `telecaller` | Own pipeline |
| Support | display Support / ops | Message + view |
| Finance | **new** | Billing, payouts, Journey payment reports |
| Marketing | **new** | Campaigns, templates, journeys |
| Employee | HR roles / `intern` | Attendance/metrics |
| Read-only | **new** | Auditor |

**Rule:** Gate on **raw role + entitlements**, never `toV3Role()` alone (`09_PERMISSION_MATRIX` corrections already warn this).

### Matrix (summary — expand in implementation ADR)

| Module | Owner | Admin | Manager | Team Lead | Sales | Support | Finance | Marketing | Read-only |
|--------|-------|-------|---------|-----------|-------|---------|---------|-----------|-----------|
| Inbox | RW | RW | RW | Team | Own | RW | — | R | R |
| Contacts / C360 | RW | RW | Policy | Team | Own | R/msg | R | R | R |
| Sales pipeline | RW | RW | RW | Team | Own | — | R | R | R |
| Campaigns | RW | RW | R | — | — | — | — | RW | R |
| Automations | RW | RW | — | — | — | — | — | R | R |
| Journeys | RW | RW | — | — | — | — | R pay | RW | R |
| Analytics | Full | Full | Team | Team | Own | Own | Full $ | Campaign | Full |
| Settings company | RW | RW | Limited | — | — | — | Billing | Limited | — |
| Billing | RW | — | — | — | — | — | RW | — | R |
| Platform | — | — | — | — | — | — | — | — | — |

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P6-01 | Owner vs Admin split + Finance/Marketing roles | P1 | L | High |
| P6-02 | Permission registry (module.action) replacing ad-hoc `checkRole` lists | P1 | XL | High |
| P6-03 | Align docs matrix with code (rewrite frozen v3 matrix or replace) | P0 | M | Medium |

---

## Phase 7 — Add-on Marketplace

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Define optional commercial add-ons attachable to subscriptions. |
| **Scope** | Add-on SKU catalog and attachment model. |
| **In Scope** | AI Pack; seats/contacts/storage; broadcast credits; API; white-label; IG. |
| **Out of Scope** | Marketplace third-party (See Phase 12 V3). |
| **Dependencies** | See Phase 2; See Phase 13 assign/remove add-ons; See Phase 3 entitlements. |
| **Risks** | Add-on sprawl; credits vs wallet confusion. |
| **Success Criteria** | First three SKUs named with meters; Super Admin attach/detach specified. |
| **Future Enhancements** | Self-serve catalog browse. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Add-on attach/detach | Monetize capacity and AI | Super Admin; Owner purchase allow-list | Subscription Engine | Subscription add-ons[] | See Phase 13 | Addon APIs | Platform + Billing Portal | N/A | Entitlement refresh atomic | Add-on Purchased/Removed timeline |


| Add-on | Depends on | Priority |
|--------|------------|----------|
| AI Pack | AIService quota enforce | P0 |
| WhatsApp AI (agent depth) | AI Pack | P1 |
| Voice AI | Hidden / beta | P3 |
| Extra Employees / Contacts / Storage | Entitlements | P0 |
| Broadcast Credits | Campaigns | P0 |
| API Access | api-keys settings | P1 |
| White Label / Custom Branding | Org settings | P1 |
| Instagram Channel | IG module | P1 |
| Journey Payments (if unbundled) | Journeys | P2 |

Checkout: Super Admin attach now; later self-serve Billing.

---

## Phase 8 — Product Settings

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Split settings into User / Company / Billing / Integration / AI / Security. |
| **Scope** | Settings IA and stub disposition. |
| **In Scope** | Re-group; branding foundation; Billing Portal slot (Owner allow-list). |
| **Out of Scope** | Building every stub in one release. |
| **Dependencies** | See Phase 1; See Phase 13.3 Billing Portal; See Phase 4. |
| **Risks** | Moving WA settings breaks muscle memory. |
| **Success Criteria** | Approved settings sitemap; stubs hidden or dated. |
| **Future Enhancements** | White-label domain settings (Enterprise). |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Organisation branding (P8-02) | Tenant brand basics | Admin/Owner | Company profile service | COMPANY branding fields | See Phase 7 White Label | PATCH company branding | Settings Company | Preview on mobile web | Sanitize uploads | Branding updates |


### Split (move company config out of mental “Super Admin”)

| Bucket | Contents | Audience |
|--------|----------|----------|
| **User Settings** | Profile, appearance, notifications, security (2FA) | All |
| **Company Settings** | Org profile, branding, pipeline, tags, employees, WhatsApp/IG connect, journey defs, templates | Admin+ |
| **Billing Settings** | Plan, invoices, add-ons, payment method | Owner/Finance |
| **Integration Settings** | API keys, webhooks, CAPI, embedded signup | Admin+ |
| **AI Settings** | Prompts, knowledge, guardrails, quotas display | Admin+ |
| **Security Settings** | Session, IP allowlist (future), audit | Admin/Owner |

**Ship or delete stubs:** Notifications, Security, Organisation, Pipeline, Workflows, Integrations, Billing, Metric Config — each is P0 trust debt if left as “Coming soon” for paying Enterprise.

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P8-01 | Settings IA re-group + remove empty stubs from nav | P0 | M | High |
| P8-02 | Organisation branding (logo, color) — foundation for white-label | P1 | M | High |

---

## Phase 9 — Missing Enterprise Features

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Catalog missing enterprise capabilities as backlog, not build-now. |
| **Scope** | Gap inventory with priority. |
| **In Scope** | Notifications; Teams; webhooks; SSO; custom fields; etc. as listed. |
| **Out of Scope** | Implementing Custom Objects in V1. |
| **Dependencies** | Cross-links to Phases 4, 6, 13, 15. |
| **Risks** | Scope creep from this list. |
| **Success Criteria** | Each row has P/Complexity/Impact; no silent new phases. |
| **Future Enhancements** | Items graduate into phased ADRs only after Founder gate. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Notifications center | Operational alerts | All users (scoped) | Notification service | NOTIFICATION# | See Phase 13 events; Enterprise Ops | List/mark-read APIs | Bell + center | Push later | No cross-tenant fanout | Admin broadcast notifications |


| Feature | Status today | Priority | Complexity | Impact |
|---------|--------------|----------|------------|--------|
| Activity Timeline (contact) | C360 Timeline shipped | Keep | — | — |
| Notifications center | Stub | P1 | M | High |
| Audit Logs | Shipped (admin) | Extend retention/export UX | P1 | S | Medium |
| Teams | Spec only / team_lead scope | P1 | L | High |
| Tags | Shipped | — | — | — |
| SLA | Missing | P2 | L | Medium |
| Approvals | Partial (metrics verify, payroll) — not general | P2 | L | Medium |
| Version History | Knowledge versions exist; workflows partial | P2 | M | Medium |
| Import/Export | CRM CSV partial | P1 | M | High |
| API Keys | Settings section exists | Harden + plan gate | P1 | M | High |
| Outbound Webhooks | Queued (`send_webhook`) | P1 | M | High |
| Custom Objects | Missing | P3 | XL | Medium |
| Custom Fields | Limited / pipeline fields | P2 | L | High |
| Impersonation | Missing | P1 | M | High |
| SSO / SAML | Missing | P1 (Ent) | L | High |
| Multi-pipeline | Flag default unused | P2 | L | Medium |
| Data residency / DPA tooling | Missing | P2 | L | High (Ent deals) |

---

## Phase 10 — Roadmap

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Sequence delivery by revenue, value, effort, and enterprise readiness. |
| **Scope** | Time horizons and scoring — not feature invention. |
| **In Scope** | Immediate/30/90/V1–V3; addendum; scoring dimensions. |
| **Out of Scope** | Changing SKU content (See Phase 2). |
| **Dependencies** | All phases; Founder gates 1–12. |
| **Risks** | Parallelizing P0s without Entitlements/PME first. |
| **Success Criteria** | Founder-ordered gate sequence; effort/value tagged items. |
| **Future Enhancements** | Living roadmap synced to Metadata Engine. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Gate sequencing | Prevent out-of-order builds | Founder, Eng lead | This audit doc | Approval checklist | All phases | N/A | N/A | N/A | No prod without checklist | Gate approvals recorded |


### Immediate (P0 — this sprint / next 2 weeks)

1. **Entitlements design ADR** (plans + add-ons + flags) — approve before code.  
2. **Settings stub purge / regroup** (hide unfinished or ship minimal).  
3. **CTA/plan visibility** pattern for locked features.  
4. **AI quota enforce** (stop soft-only `overQuota`).  
5. **Campaigns Audience** unstick or remove from nav.  
6. **Document Owner vs Admin** billing gate in product copy.

### Next 30 days

- Super Admin: Feature Flags + Plan attach UI  
- Formal Starter/Pro/Business/Enterprise fields  
- Journey Instances UI + Live payments Founder path  
- Notifications MVP  
- Composer “coming soon” → hide or schedule  
- Permission matrix doc ↔ code reconciliation  

### Next 90 days

- Self-serve Billing + add-on purchase (SaaS PG ≠ Journey PG)  
- Impersonation + support toolkit  
- Teams as first-class  
- API + outbound webhooks GA on Business+  
- Analytics stubs filled or removed  
- Org branding → White Label beta  

### V1 (Enterprise-ready sell)

Packaged plans, enforced limits, Super Admin control plane, RBAC with Finance/Marketing, audit + impersonation, billing self-serve, Journey+Payments Live, Campaigns Audience, AI Pack add-on.

### V2

SSO, SLA, multi-pipeline, Custom Fields v1, CTWA attribution, dry-run automations, Advanced analytics export, Marketplace UX for add-ons.

### V3

Custom Objects, Voice AI, full white-label domains, multi-entity/holdco, partner channel.

### Roadmap item scoring (Effort · Value · Revenue · Customer · Tech-debt)

*Complexity column elsewhere maps 1:1 to **Effort** (S/M/L/XL). Impact maps to **Business Value**. Scoring below freezes prioritization dimensions for the Product Bible.*

| Item | Effort | Business Value | Revenue Impact | Customer Impact | Technical Debt Reduction | Horizon |
|------|--------|----------------|----------------|-----------------|--------------------------|---------|
| Entitlements design ADR | M | High | Unlocks paid packaging | Clear plan limits | Ends ad-hoc flags | Immediate |
| Settings stub purge / regroup | M | High | Trust for demos | Less confusion | Removes dead UI | Immediate |
| CTA / plan lock UX | M | High | Upgrade conversion | Clarity on locks | Shared FeatureGate | Immediate |
| AI quota hard enforce | M | High | Protects AI cost | Fair use | Soft-quota debt | Immediate |
| Campaigns Audience unstick | M | High | Campaigns sellable | Core workflow | Stub debt | Immediate |
| Owner vs Admin billing copy | S | Medium | Billing clarity | Role clarity | Doc drift | Immediate |
| Flags + Plan Super Admin UI | M | High | Ops control | Faster support | Manual Dynamo edits | 30d |
| Formal plan fields on company | M | High | SKU enforcement | Transparent limits | Plan string debt | 30d |
| Journey Instances + Live pay | M | High | Journey monetization | Operator UX | Incomplete journey UX | 30d |
| Notifications MVP | M | High | Retention | Proactive alerts | Telegram stub | 30d |
| Permission matrix reconcile | M | Medium | Enterprise sales | Correct access | Doc↔code drift | 30d |
| Self-serve Billing + add-ons | L | High | Recurring SaaS $ | Self-serve | Stub Billing | 90d |
| Impersonation + support | M | High | Faster close/support | Faster fixes | Support friction | 90d |
| Teams first-class | L | High | Mid-market | Multi-team ops | Flat org debt | 90d |
| API + outbound webhooks GA | M | Medium | Business+ SKU | Integrations | Partial API | 90d |
| Analytics stubs fill/remove | M | Medium | Credibility | Reporting | Stub debt | 90d |
| Org branding → WL beta | L | High | Enterprise/WL $ | Brand trust | Branding stubs | 90d |
| PME registry ADR | M | High | Enables packs/market | Consistent nav | Dual SoT risk | Design |
| Subscription Engine ADR | M | High | SaaS revenue core | Lifecycle trust | Billing ambiguity | Design |
| Usage Meter + assertWithinLimit | L | High | Enforce paid limits | Fair quotas | Soft limits | 30–90d |
| Module Installer | L | High | Modular sell | Install clarity | Nav hardcoding | 90d |
| CS Health Score | L | High | Reduce churn | Proactive CS | Blind renewals | V1 |
| First Industry Pack (Events) | M | High | Vertical ARPU | Time-to-value | Template sprawl | 90d–V1 |
| Marketplace ↔ add-on SKUs | M | High | Attach revenue | Discoverability | Catalog drift | V1–V2 |
| Grace + dunning | L | High | Recover MRR | Fewer surprises | Manual chase | V1 |
| Super Admin Subscription console | L | High | Ops revenue control | Support speed | Manual billing | 90d–V1 |
| Subscription Timeline + Health | L | High | Ops visibility | Trust | Opaque history | V1 |
| Owner Billing Portal allow-list | M | High | Self-serve $ | Owner autonomy | Stub portal | V1 |
| SSO / SLA / Custom Fields | L–XL | High–Med | Enterprise deals | Enterprise fit | Auth debt | V2 |
| Custom Objects / Voice AI | XL | Medium | Differentiation | Power users | Architecture bet | V3 |

### Roadmap addendum (Phases 11–15 + Enterprise Ops — Founder review 2026-08-03)

*Appended only; does not replace items above.*

| Horizon | Additions |
|---------|-----------|
| **Immediate / design** | Product Metadata Engine ADR · **Subscription Engine ADR** (lifecycle + Super Admin control + Owner allow-list) · SaaS≠Journey PG |
| **Next 30 days** | Usage Meter v0 + `assertWithinLimit` · Notification Center MVP · Tenant health fields · **Subscription Timeline** schema · **Subscription Health Dashboard** skeleton |
| **Next 90 days** | Module Installer · Customer Billing Portal (Owner allow-list) · Audit expansion · First Industry Pack · **Super Admin Subscription console** (create/suspend/extend trial/manual pay) |
| **V1** | Full subscription lifecycle enforced · CS Health Score · Revenue + Subscription Health dashboards · AI Control Center MVP · Usage enforcement on all meters |
| **V2** | Industry Packs · Marketplace · Backup/DR · Coupons/referral · Auto-renew + dunning polish |
| **V3** | Third-party Marketplace · Full Industry Pack suite · Advanced CS automation |

---

## Phase 11 — Industry Solution Packs

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Vertical packs seed defaults without bypassing entitlements. |
| **Scope** | Pack schema and install semantics. |
| **In Scope** | 15 industry packs design; entitlement fail-closed; Events pack first. |
| **Out of Scope** | Building all 15 packs in V1. |
| **Dependencies** | See Phases 2–3; See Phase 14 Module Installer; **Requires Metadata Engine**; **Depends on Entitlements**. |
| **Risks** | Pack overwrites customer config; fake compliance claims. |
| **Success Criteria** | Pack schema approved; Events pack mapped to existing assets; fail-closed rules written. |
| **Future Enhancements** | Pack marketplace listings (See Phase 12). |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Industry Pack install | Fast vertical onboarding | Super Admin; Owner if entitled | Pack installer service | PACK_INSTALL# + seeded copies | Phases 3, 14, PME | Install/uninstall APIs | Platform + optional wizard | Wizard responsive | No entitlement bypass | Pack install/uninstall |


Industry Packs are **curated enablement bundles**, not separate products. Installing a pack applies defaults on top of the tenant’s **Plan + Entitlements + Feature Flags + Add-ons** — it never bypasses paid entitlements.

### Pack catalog (design)

| Pack | Primary modules / surfaces | Example defaults enabled |
|------|----------------------------|---------------------------|
| **Healthcare** | CRM, Inbox, Journeys, Templates, Knowledge | HIPAA-oriented field set*, consent templates, appointment journey |
| **Clinic** | CRM, Inbox, Journeys, Payments, Templates | Doctor appointment journey, waitlist automation, reminder templates |
| **Education** | CRM, Campaigns, Journeys, Knowledge | Lead→enrollment pipeline, batch broadcast, FAQ knowledge |
| **Coaching** | CRM, Inbox, Journeys, AI, Payments | Session booking journey, payment link, follow-up automations |
| **Finance** | CRM, Inbox, Campaigns, AI, Audit | Compliance tags, disclosure templates, lead scoring defaults |
| **Insurance** | CRM, Journeys, Templates, Campaigns | Quote journey, renewal drip, document checklist fields |
| **Real Estate** | CRM, Inbox, Campaigns, Journeys | Site-visit journey, listing templates, broker assignment |
| **Manufacturing** | CRM, Automations, Knowledge | Dealer inquiry pipeline, spare-parts FAQ, SLA tags |
| **Retail** | CRM, Campaigns, Inbox, Journeys | Promo broadcast defaults, order-status templates |
| **Restaurant** | Journeys, Templates, Campaigns, Inbox | Reservation journey, menu FAQ, review-request automation |
| **Hotel** | Journeys, Payments, Templates, Inbox | Booking journey + payment, check-in reminders |
| **Events** | Journeys, Payments, Campaigns, Templates | Event Booking (existing), ticket qty pricing, confirmation WA |
| **NGO** | CRM, Campaigns, Journeys | Donor pipeline, donation journey, campaign appeals |
| **Travel** | CRM, Journeys, Payments, Templates | Itinerary inquiry, booking deposit payment |
| **Automobile** | CRM, Inbox, Journeys, Campaigns | Test-drive journey, service reminder automation |

\*Regulatory claims are packaging/process — engineering must not assert certification without legal review.

### What a pack installs (metadata-driven)

| Asset type | Behavior on install |
|------------|---------------------|
| Modules | Marks modules `installed` / recommends enable (via Module Installer) |
| Forms / Journey defs | Seeds definition templates (company-scoped copies) |
| Automations | Seeds draft workflows (unpublished until Admin publish) |
| Templates | Seeds WA template *drafts* or copy library (Meta approval still required) |
| CRM fields / tags / stages | Adds optional fields/tags; **does not** break Customer 360 frozen tabs |
| Dashboards | Seeds Analytics saved views / home widgets where supported |
| Permissions | Suggests role presets (Marketing/Sales); does not silently escalate |
| Defaults | Quiet hours, welcome copy, journey branding presets |

### Interaction with Plans / Entitlements / Flags / Add-ons

```
Plan (Starter…Enterprise)
  └─ Entitlements (limits + included modules)
       └─ Add-ons (AI Pack, Broadcast credits, …)
            └─ Feature Flags (beta/internal/enterprise_only)
                 └─ Industry Pack (seeds + enables *allowed* assets only)
```

- If Plan/Entitlement denies Journeys, Events pack **cannot** enable Journey Platform — show upgrade CTA.  
- Packs may **require** add-ons (e.g. Clinic pack recommends Journey Payments).  
- Flags still gate beta surfaces (`journeys_platform` pattern).  
- Uninstall pack: soft-disable seeded drafts; never delete customer-edited assets without confirm.

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P11-01 | Industry Pack schema + Super Admin attach/detach | P2 | L | High |
| P11-02 | First pack: Events (reuse existing Event Booking assets) | P1 | M | High |
| P11-03 | Pack install respects entitlements (fail closed) | P1 | M | High |
| P11-04 | Clinic / Coaching packs after Journeys+Payments Live | P2 | L | High |

---

## Phase 12 — Marketplace Architecture

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Distribution plane for connectors/plugins; first-party first. |
| **Scope** | Marketplace architecture and lifecycle. |
| **In Scope** | Listing types; install lifecycle; Super Admin approval; billing via add-ons. |
| **Out of Scope** | Third-party store in V1. |
| **Dependencies** | See Phase 7; See Phase 3; See Phase 14; **Requires Metadata Engine**; **See Phase 13** for billing. |
| **Risks** | Supply-chain; unpaid installs. |
| **Success Criteria** | Listing schema; first-party-only V1/V2 rule; dependency resolution rules. |
| **Future Enhancements** | Ratings; revenue share. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Marketplace install | Extend product safely | Admin/Owner (entitled); Super Admin approve | Marketplace service | MARKETPLACE_INSTALL# | PME, Entitlements | Install APIs | Marketplace UI | Limited | Signed listings; sandbox | Install/update/disable |


Enterprise Marketplace is the **distribution plane** for first-party and (later) third-party extensions. Distinct from Industry Packs (packs = vertical seeds; marketplace = installable products).

### Catalog types

| Type | Examples | Billing |
|------|----------|---------|
| **Connectors** | Meta CAPI, Google Sheets, Zapier-class, accounting | Free / add-on / paid |
| **Plugins** | Inbox composer actions, CRM panels | Entitlement-gated |
| **API Integrations** | Partner REST apps using tenant API keys | Plan + API Access add-on |
| **Widgets** | Home/Dashboard cards, C360 `data-slot` extensions | Free / paid |
| **Themes** | Brand kits, journey themes | White Label add-on |
| **AI Skills** | Prompt packs, vertical agents | AI Pack |
| **Third-party extensions** | Future partner apps | Revenue share (V3) |

### Lifecycle

| Stage | Behavior |
|-------|----------|
| **Install** | Entitlement check → write `MARKETPLACE#` install record → run module hooks → audit |
| **Update** | Semver; Super Admin / tenant Admin approve major bumps |
| **Disable** | Soft-off; keep config; hide UI |
| **Remove** | Disable + purge extension config; retain audit |
| **Versioning** | `version`, `minPlatform`, changelog |
| **Dependencies** | Declared module/add-on/flag deps (Metadata Engine) |
| **Approval** | First-party: APForce ship; third-party: Super Admin review queue |
| **Billing** | Maps to Add-on SKU or Marketplace listing price; SaaS billing only |
| **Ratings** | Future (V3); store reviews out of critical path |

### Super Admin & Entitlements

- Super Admin: listing CRUD, approval queue, force-disable, install analytics.  
- Tenant Admin: Marketplace browse (entitled only), install/disable.  
- Entitlements: every listing declares `requiredPlan`, `requiredAddons[]`, `requiredFlags[]`.  
- Reuse Company Settings → Integrations as tenant-facing surface; Platform for catalog.

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P12-01 | Marketplace listing + install record schema | P2 | L | High |
| P12-02 | First-party connectors only until V2 | P2 | M | Medium |
| P12-03 | Tie Marketplace SKUs to Add-on catalog (Phase 7) | P1 | M | High |
| P12-04 | Third-party + ratings | P3 | XL | Medium |

---

## Phase 13 — SaaS Subscription & Billing Lifecycle

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Enterprise Subscription Engine with Super Admin as source of truth. |
| **Scope** | SaaS subscription lifecycle, portal allow-list, timeline, meters, health dashboard. |
| **In Scope** | All statuses/ops in §13.1–13.6; Super Admin matrix; Owner allow-list; usage enforcement. |
| **Out of Scope** | Journey Razorpay redesign; Owner plan mutation. |
| **Dependencies** | See Phases 2, 4, 7; Usage Meter; Notification Center; **Depends on Entitlements**; isolate Journey PG. |
| **Risks** | Mixing SaaS and Journey webhooks; dunning false suspends. |
| **Success Criteria** | Lifecycle ADR approved; Owner API deny-list in design; Timeline events listed; meters named. |
| **Future Enhancements** | Usage-based billing hybrid. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Subscription lifecycle | Collect SaaS revenue reliably | Super Admin; system webhooks | Subscription Engine | SUBSCRIPTION# | See Phases 4, 2, 7 | Subscription state APIs | Platform console | N/A | Step-up for Override/Mark Paid | All §13.4 events |
| Owner Billing Portal | Transparency without control loss | Company Owner (+Finance view) | Subscription Engine (read) | Same SoT; read models | See Phase 8; §13.3 | Allow-listed GET/POST purchase | Settings Billing | Desktop+mobile web | PCI via PG hosted fields | View access; purchase add-on |
| Usage enforcement | Protect margins | System | Entitlements + meters | Meter counters + limits | Enterprise Ops Usage Meter; AIService | assertWithinLimit | Upgrade CTAs | Same | Hard block AI/seats | Limit breaches / overrides |


Phase 2 defines **SKU packaging**. This phase defines the **Enterprise SaaS Subscription Engine** for the **tenant’s APForce subscription** — **not** Journey/customer Razorpay payments (`PaymentService` / `payment.captured`).

### Hard separation

| Plane | Gateway / records | Purpose |
|-------|-------------------|---------|
| **SaaS subscription billing** | Future SaaS PG + `SUBSCRIPTION#` / invoices | What the company pays APForce |
| **Journey customer payments** | Existing Razorpay Live/Test + `PAYMENT#` | What end-customers pay the company |

Never mix webhook secrets, order receipts, or Super Admin “Payment Status” without labeling the plane.

---

### 13.1 Subscription Engine — complete lifecycle

#### Primary statuses

| Status | Meaning | Typical access |
|--------|---------|----------------|
| **Trial** | Timed evaluation; `trialEndsAt` set | Full or trial entitlements |
| **Active** | Paid period current; auto-renew on | Full entitled access |
| **Grace Period** | Past due but still in grace window | Warn + soft limits; Notification Center |
| **Payment Pending** | Invoice issued / charge initiated; awaiting confirmation | Active-like until timeout → Failed |
| **Payment Failed** | Charge declined or marked failed | Enter Grace (or Suspended per policy) |
| **Suspended** | Access blocked by Super Admin or dunning exhaustion | Login blocked or read-only (policy) |
| **Cancelled** | Will not renew; may retain access until period end | Per cancel mode |
| **Expired** | Period ended without successful renew | Blocked / Archived path |
| **Archived** | Soft-closed; data retained | No product access |
| **Reactivated** | *Event/outcome* — landing status is usually **Active** (or **Trial** if re-trial) after Super Admin Reactivate | — |

#### Commercial transitions & operations

| Operation | Behavior |
|-----------|----------|
| **Upgrade** | Immediate entitlement expand; **proration** charge; timeline `Plan Changed` |
| **Downgrade** | Default at period end; optional immediate with clawback; reduce entitlements safely |
| **Proration** | Credit/debit line items on plan/add-on change |
| **Auto Renewal** | Charge at period end → Active + invoice; failure → Payment Failed → Grace |
| **Manual Renewal** | Super Admin Mark Paid / Manual Payment Entry without waiting for PG |
| **Reactivation** | Cancelled / Expired / Archived → Active (or Trial); requires Super Admin |
| **Extend Trial** | Super Admin only; moves `trialEndsAt` |
| **Retry / Dunning** | e.g. d0 / d3 / d7 then Suspended |
| **Coupons / Referral** | Applied by Super Admin (Owner may redeem code if policy allows) |
| **GST / Invoice / Credit Notes** | India GST on SaaS invoices; PDF in Billing Portal |

#### Status flow (reference)

```
Created company
  → Trial
      → Active (convert / first pay)
      → Expired / Suspended (trial end policy)
  → Active
      → Payment Pending → Active | Payment Failed
      → Payment Failed → Grace Period → Suspended | Active (recovery)
      → Cancelled → Expired → Archived
      → Upgrade / Downgrade (stay Active; entitlements change)
  → Suspended → Reactivated (→ Active) | Archived
  → Archived → Reactivated (Super Admin)
```

---

### 13.2 Authority model — Super Admin owns the engine

| Actor | Authority |
|-------|-----------|
| **Super Admin** | **Source of truth** — create/mutate every subscription field, limits, add-ons, invoices, credits, force transitions |
| **Company Owner** | **Billing Portal only** — view + download + request upgrade + purchase entitled add-ons + update billing/payment method (see §13.3) |
| **Company Admin / Finance** | Portal view (if granted); **no** plan mutation |
| **Automation / SaaS PG webhooks** | May set Payment Pending / Failed / Paid **only** via Subscription Engine APIs that write timeline + audit |

All Super Admin actions listed under Phase 4 “Subscription Engine control” apply here.

---

### 13.3 Company Billing Portal (Owner — limited)

Replace Settings Billing stub. **Owner must not** Activate/Suspend/Cancel/Change Plan/Override Limits/Mark Paid/Force Expiry.

| Allowed | Not allowed (Super Admin only) |
|---------|--------------------------------|
| View Current Plan | Create / Activate / Suspend / Resume / Cancel subscription |
| View Usage (meters) | Override limits / custom enterprise plan |
| Download Invoices | Manual invoice / Mark Paid / Manual payment entry |
| View Billing History | Credit / wallet adjustment |
| View Renewal Date | Force expiry / Reactivate |
| **Request Upgrade** (ticket or request record for Super Admin) | Silent plan change |
| **Purchase Add-ons** (if self-serve SKU enabled; still entitlement-checked) | Assign arbitrary add-ons outside catalog |
| Update Billing Details | Coupon invent (may redeem published codes) |
| Update Payment Method | Referral credit invent |

Upgrade **requests** appear on Super Admin Subscription queue; Super Admin executes Change Plan / Upgrade.

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P13-07 | Owner portal allow-list enforced in API (not UI-only) | P0 | M | High |
| P13-08 | Upgrade Request object → Super Admin inbox | P1 | M | High |

---

### 13.4 Subscription Timeline (audit stream)

Append-only timeline on `SUBSCRIPTION#` / company (also mirrored to `logAudit` where sensitive):

| Event | Payload (min) |
|-------|----------------|
| Trial Started | `trialEndsAt`, actor |
| Trial Extended | old/new `trialEndsAt`, Super Admin id |
| Plan Changed | fromPlan → toPlan, upgrade\|downgrade\|change, proration ref |
| Payment Success | amount, invoiceId, method (PG\|manual) |
| Payment Failed | reason, attempt, next retry |
| Payment Pending | invoiceId |
| Add-on Purchased / Removed | sku, actor |
| Limits Changed | meter, old→new, override flag |
| Subscription Suspended | reason, actor |
| Subscription Resumed | actor |
| Cancelled / Expired / Archived | reason |
| Reactivated | target status |
| Coupon / Referral Applied | code, credit |
| Manual Invoice / Mark Paid | refs |

UI: Super Admin “Subscription Timeline” on company; Owner sees sanitized subset (no internal override notes).

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P13-09 | Subscription Timeline store + APIs | P0 | M | High |

---

### 13.5 Usage enforcement (subscription-controlled meters)

Entitlements derived from Plan + Add-ons + Super Admin overrides. Enforce at write paths:

| Meter | Enforce on | On breach |
|-------|------------|-----------|
| **Employees** | Invite / create user | Block invite |
| **Contacts** | Lead/contact create / import | Soft warn → hard block |
| **Broadcast** | Campaign launch / send | Block or debit credits |
| **AI** | `AIService.generate` | Hard block (replace soft `overQuota`) |
| **WhatsApp Numbers** | Bind / Embedded Signup complete | Block extra assets |
| **Storage** | Media/doc upload | Block upload |
| **API Calls** | Public API routes | 429 / plan error |
| **Journey Limits** | Active journey defs / monthly submits | Block publish or submit |
| **Automation Limits** | Active workflows / monthly executions | Block activate / fire |

Usage Meter (Enterprise Ops) displays the same numbers Super Admin overrides edit.

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P13-10 | Central `assertWithinLimit(meter)` used by routes | P0 | L | High |
| P13-11 | Journey + Automation limit meters | P1 | M | High |

---

### 13.6 Subscription Health Dashboard (Super Admin)

Cross-tenant dashboard (Platform home or Subscriptions tab):

| Widget | Definition |
|--------|------------|
| **Active Companies** | Status = Active |
| **Trial Companies** | Status = Trial |
| **Expiring Soon** | Trial or period end within N days |
| **Grace Period** | Status = Grace |
| **Failed Payments** | Recent Payment Failed / open dunning |
| **Suspended** | Status = Suspended |
| **Churn Risk** | Health Score drop + grace + cancel scheduled (ties Phase 15) |
| **MRR / ARR** | From Active subscriptions (SaaS plane) |
| **Revenue by Plan** | MRR split Starter→Enterprise + Custom |

Complements Revenue Dashboard (PEO-11); Health Dashboard is **operational**, Revenue is **finance**.

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P13-12 | Subscription Health Dashboard v1 | P0 | L | High |

---

### 13.7 Recommendations (Phase 13 — retained + expanded)

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P13-01 | Formalize status machine on company (extend planStatus) | P0 | M | High |
| P13-02 | Grace + dunning + Notification Center hooks | P1 | L | High |
| P13-03 | Upgrade/downgrade/proration in Billing ADR | P1 | L | High |
| P13-04 | GST-ready invoice fields (India) | P1 | M | High |
| P13-05 | Coupons / referral | P2 | M | Medium |
| P13-06 | Keep Journey PG isolated (document in Billing ADR) | P0 | S | High |
| P13-07 | Owner portal API allow-list | P0 | M | High |
| P13-08 | Upgrade Request → Super Admin | P1 | M | High |
| P13-09 | Subscription Timeline | P0 | M | High |
| P13-10 | Usage `assertWithinLimit` | P0 | L | High |
| P13-11 | Journey + Automation meters | P1 | M | High |
| P13-12 | Subscription Health Dashboard | P0 | L | High |
| P13-13 | Payment Pending status + timeout policy | P1 | M | High |
| P13-14 | Auto vs Manual renewal flags on subscription | P1 | S | High |

---

## Phase 14 — Module Installer

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Install/enable modules via metadata and entitlements. |
| **Scope** | Module registry and installer semantics. |
| **In Scope** | Module catalog; dependencies; install status; sidebar intersection. |
| **Out of Scope** | Rewriting modules as microfrontends. |
| **Dependencies** | **Requires Metadata Engine**; See Phase 3; See Phase 11 packs call installer. |
| **Risks** | Orphan disables breaking deps. |
| **Success Criteria** | Install graph rules; HR optional on Starter/Pro specified. |
| **Future Enhancements** | Paid module SKUs. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Module install | Compose tenant capability set | Super Admin; system via packs | Module Installer | COMPANY module status | PME, Entitlements | Install/disable APIs | Platform + Settings | Respect mobileReady | Dependency block | Install/disable |


Modules are **installable capability units** described by the Product Metadata Engine. Installer applies entitlement-safe enablement (complement to Industry Packs, which seed content).

### Module catalog (examples)

| Module | Dependencies | Default plan | Typical add-ons / flags |
|--------|--------------|--------------|-------------------------|
| **CRM / Contact Hub** | — | Starter+ | — |
| **Inbox** | CRM (soft) | Starter+ | — |
| **Journey Platform** | Automations, Inbox | Professional+ | `journeys_platform` |
| **Payments (Journey)** | Journey Platform | Professional+ | Live keys / Founder |
| **AI** | — | Trial / Pro+ | AI Pack |
| **Campaigns / Broadcast** | Templates, Inbox | Starter+ (limits) | Broadcast credits |
| **Knowledge** | AI | Pro+ | AI Pack |
| **HR / Attendance / Payroll** | Employees | Business / Ent or HR SKU | — |
| **Finance (tenant)** | — | Business+ | Finance role |
| **Inventory** | — | Future | — |
| **Analytics** | CRM | Starter basic / Pro full | — |

### Per-module record

| Field | Purpose |
|-------|---------|
| `dependencies[]` | Hard/soft module deps |
| `defaultEnabledPlan` | Min plan auto-offer |
| `requiredAddons[]` | Block install if missing |
| `requiredFeatureFlags[]` | e.g. `journeys_platform` |
| `installStatus` | `available` \| `installed` \| `disabled` \| `deprecated` |
| `upgradePath` | Module version / migration notes |

Installer actions: Install → Enable flags/entitlements slice → seed minimal config → audit. Disable hides nav via Metadata Engine; Remove only if no dependent modules.

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P14-01 | Module registry + install status per company | P1 | L | High |
| P14-02 | Sidebar driven by installed ∩ entitled modules | P1 | M | High |
| P14-03 | HR modules optional by default on Starter/Pro | P1 | M | Medium |
| P14-04 | Journey+Payments install path mirrors flag today | P1 | S | High |

---

## Phase 15 — Tenant Lifecycle & Customer Success

### Phase quality envelope

| | |
|--|--|
| **Objectives** | Tenant lifecycle + CS signals for retention. |
| **Scope** | Tenant states and CS dashboard metrics. |
| **In Scope** | Created→Deleted/Restore; Health Score; churn/renewal risk. |
| **Out of Scope** | Full CS automation (V3). |
| **Dependencies** | See Phase 13 statuses; See Phase 4 Platform; Notification Center. |
| **Risks** | Vanity health scores; PII in CS exports. |
| **Success Criteria** | State enum aligned with subscription; Health Score inputs listed. |
| **Future Enhancements** | Automated playbooks. |

#### Feature Architecture Cards

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| CS Health Score | Prioritize success motions | Super Admin / CS | CS analytics | Derived metrics store | See Phase 13 Health Dashboard | Read APIs | Platform CS view | N/A | Least privilege export | Score overrides |


### Tenant lifecycle

| State | Relation to subscription |
|-------|--------------------------|
| **Created** | Company provisioned; no/minimal usage |
| **Trial** | Subscription Trial |
| **Active** | Subscription Active |
| **Grace** | Subscription Grace / Payment Failed |
| **Suspended** | Subscription Suspended |
| **Cancelled** | Subscription Cancelled (access policy applies) |
| **Archived** | Data retained; login blocked |
| **Deleted** | Irreversible purge / anonymize |
| **Restore** | Archived → Active/Trial with Super Admin + payment |

Align Platform suspend/unsuspend with this vocabulary.

### Customer Success dashboard (Super Admin)

| Signal | Use |
|--------|-----|
| **Health Score** | Composite 0–100 (login, adoption, WA, payments, support tickets) |
| **Last Login** | Owner + any user |
| **Active Users** | Seats used / entitled |
| **Feature Adoption** | Modules installed + key actions (campaign launch, journey submit) |
| **AI Usage** | Calls vs quota |
| **WhatsApp Health** | Token, quality rating, disconnect events |
| **Payment Status** | SaaS subscription status (labeled) |
| **Renewal Risk** | Days to renew + engagement |
| **Churn Risk** | Health drop + grace + support severity |

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| P15-01 | Tenant state enum + Platform filters | P1 | M | High |
| P15-02 | CS Health Score v1 on company detail | P1 | L | High |
| P15-03 | Churn/renewal risk alerts → Notification Center | P2 | M | High |
| P15-04 | Restore-from-archive runbook | P2 | M | Medium |

---

## Enterprise Operations (expanded)

### Section quality envelope (Enterprise Operations)

| | |
|--|--|
| **Objectives** | Operational meters, notifications, audit depth, DR, billing portal, revenue and AI control for Super Admin / Owner. |
| **Scope** | Cross-cutting ops surfaces that support Phases 4, 7, 8, 13, 15. |
| **In Scope** | Usage Meter; Notification Center; Audit expansion; Backup/DR; Billing Portal; Revenue + Subscription Health; AI Control Center. |
| **Out of Scope** | New product modules; Journey PG features. |
| **Dependencies** | **See Phase 13** Subscription Engine; **Depends on Entitlements**; See Phase 4 Super Admin; See Phase 15 CS. |
| **Risks** | Alert fatigue; incomplete meters blocking customers incorrectly. |
| **Success Criteria** | Each ops surface has owner, SoT, and audit rule; Billing Portal allow-list matches Phase 13.3. |
| **Future Enhancements** | Predictive churn; automated dunning emails. |


*New operational surfaces for Super Admin and Company Owner. Complements Phases 4, 7, 8, 13.*

#### Feature Architecture Cards (Enterprise Ops)

| Feature | Business Purpose | User Roles | Data Owner | Source of Truth | Dependencies | API Impact | UI Impact | Mobile Impact | Security | Audit |
|---------|------------------|------------|------------|-----------------|--------------|------------|-----------|---------------|----------|-------|
| Usage Meter | Enforce plan limits | Super Admin, Owner | Meter service | Meter counters per company | See Phase 13; Entitlements | Meter read/assert APIs | Platform + Billing widgets | Summary only | Fail-closed on hard caps | Override Limits audited |
| Notification Center | Proactive commercial/ops alerts | Owner, Admin, Super Admin | Notification service | Tenant + platform inboxes | See Phase 13 lifecycle events | List/mark-read APIs | In-app center | Push later (Future) | Tenant-scoped | Delivery + read optional |
| Audit Trail Expansion | Compliance + support | Super Admin, Owner (subset) | Audit writer | Audit log + Timeline dual-write | See Phase 13.4 | Query APIs | Platform audit UI | N/A | Immutable append | Self-describing |
| Backup & DR | Portability + resilience | Super Admin; Admin export | Backup jobs | Export artifacts + runbooks | See Phase 15 Archive | Export/restore APIs | Platform tools | N/A | Super Admin restore only | All restore ops |
| Customer Billing Portal | Owner self-serve (allow-list) | Owner | Subscription SoT = Super Admin | SaaS subscription + invoices | **See Phase 13.3** | Strict allow-list routes | Settings → Billing | View invoices | No plan mutation | Portal actions audited |
| Revenue + Sub Health | Ops MRR / risk visibility | Super Admin | Aggregation reads | Subscription + payments | See Phases 4, 13, 15 | Read dashboards | Platform dashboards | N/A | Super Admin only | Access logged |
| AI Control Center | Cost + quota governance | Super Admin; company AI admin | AI quota + cost model | `ai_quota#` + cost registry | PEO meters; AIService | Quota/cost APIs | Platform AI console | N/A | companyId scoped | Quota overrides audited |

### Usage Meter

| Meter | Source seam (reuse) | Enforce |
|-------|---------------------|---------|
| Contacts | Lead/contact counts | Soft → hard on create |
| Employees | Admin employee list | Block invite over seats |
| Broadcast | Campaign send counters | Credits / monthly cap |
| AI | `AIService` / `ai_quota#` | **Hard block** (today soft) |
| Storage | S3 media/docs | Soft warn → hard upload |
| API Calls | API gateway / route counters | Rate + plan |
| WhatsApp assets | WABA / phone / IG bindings | Per-plan asset caps |

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| PEO-01 | Usage Meter API + Platform widgets | P0 | L | High |
| PEO-02 | Wire AI hard quota to meter | P0 | M | High |

### Notification Center

| Event class | Examples |
|-------------|----------|
| Commercial | Trial expiry, payment failure, grace ending, renew success |
| Channel | WhatsApp disconnected, Meta token expiry, IG token |
| Ops | Broadcast failure, workflow fail spike, journey pay resume fail |
| AI | Quota 80%/100% |
| System | Maintenance mode, incident |

Tenant + Super Admin inboxes; email/Telegram optional (fix `config/telegram.js` stub first).

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| PEO-03 | Notification Center MVP (in-app) | P1 | M | High |
| PEO-04 | Hook subscription + Meta health events | P1 | M | High |

### Audit Trail Expansion

Extend existing `logAudit()` / audit table coverage:

| Category | Events |
|----------|--------|
| Commercial | Plan changes, add-on enable/disable, coupons, invoices |
| Entitlements | Feature flag changes, module install/disable |
| Billing | Charges, refunds, credit notes, payment method |
| Product | Workflow publish, journey def publish, AI prompt changes |
| Security | Login anomalies, impersonation start/end, 2FA, API key create/revoke |
| Subscription Engine | All Phase 13.4 Timeline events (plan, trial, pay success/fail, add-on, limits, suspend, reactivate) |

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| PEO-05 | Mandatory audit for plan/flag/addon/billing | P0 | M | High |
| PEO-06 | Impersonation audit + banner (with P4-02) | P1 | M | High |
| PEO-05b | Dual-write Subscription Timeline ↔ audit log | P0 | M | High |

### Backup & Disaster Recovery

| Capability | Scope |
|------------|-------|
| **Backup** | Scheduled export of tenant partition (meta + critical entities) |
| **Restore** | Super Admin gated; into same or empty tenant |
| **Export** | Admin self-serve contacts/campaigns (GDPR/portability) |
| **Import** | Existing CSV paths + validated bulk |
| **Retention** | Align audit + backup retention to plan |
| **DR** | Runbook: region failure, Dynamo PITR, S3 versioning — ops doc first |

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| PEO-07 | Tenant export (contacts + messages metadata) | P1 | L | High |
| PEO-08 | DR runbook + PITR verification | P1 | M | High |
| PEO-09 | Full tenant backup/restore | P2 | XL | Medium |

### Customer Billing Portal

Owner Settings → Billing (replace stub). **Super Admin remains source of truth** (Phase 4 / Phase 13).

**Owner may:**

- View Current Plan  
- View Usage  
- Download Invoices  
- View Billing History  
- View Renewal Date  
- Request Upgrade (creates Super Admin queue item — does not mutate plan)  
- Purchase Add-ons (catalog SKUs only, entitlement-checked)  
- Update Billing Details  
- Update Payment Method  

**Owner must not:** Create/Activate/Suspend/Cancel subscription, Change Plan, Override Limits, Manual Invoice, Mark Paid, Force Expiry, Reactivate, arbitrary Coupon invent.

SaaS plane only; Journey customer payment reports stay separate.

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| PEO-10 | Billing Portal MVP (Owner allow-list) | P1 | L | High |
| PEO-10b | Portal APIs reject Super-Admin-only mutations | P0 | M | High |

### Subscription Health Dashboard

*See Phase 13.6 — Super Admin operational view: Active / Trial / Expiring Soon / Grace / Failed Payments / Suspended / Churn Risk / MRR / ARR / Revenue by Plan.*

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| PEO-10c | Ship Health Dashboard alongside Platform companies list | P0 | L | High |

### Revenue Dashboard (Super Admin)

MRR · ARR · Churn · LTV · CAC (manual CAC ok v1) · Plan distribution · Revenue by Industry Pack · Top customers.

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| PEO-11 | Revenue dashboard v1 (MRR/plan mix) | P1 | L | High |
| PEO-12 | Industry + LTV/CAC later | P2 | M | Medium |

### AI Control Center

Models · Prompt library · Cost · Token usage · AI logs · Analytics · Guardrails — consolidates `/ai-admin`, Platform AI costs, Knowledge; fix pricing placeholders (PENDING_WORK).

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| PEO-13 | AI Control Center IA (consolidate surfaces) | P1 | M | High |
| PEO-14 | Real cost model (remove placeholders) | P0 | M | High |

---

## Product Metadata Engine (Strategic Foundation)

### Section quality envelope (Product Metadata Engine)

| | |
|--|--|
| **Objectives** | Single registry so nav, entitlements, installer, packs, and marketplace stay consistent. |
| **Scope** | Metadata schema and consumers — strategic foundation. |
| **In Scope** | Schema fields; consumer list (sidebar, Super Admin, entitlements, marketplace, installer, docs). |
| **Out of Scope** | Implementing all consumers in one release. |
| **Dependencies** | Feeds Phases 1, 3, 11, 12, 14; **Required by** Module Installer and Industry Packs. |
| **Risks** | Dual sources of truth if teams bypass registry. |
| **Success Criteria** | ADR approved; one registry format; at least sidebar + entitlements designed to read it. |
| **Future Enhancements** | Auto-generated public docs from metadata. |

#### Feature Architecture Card — Metadata Registry (PME-01)

| Field | Value |
|-------|-------|
| Business Purpose | Prevent entitlement/nav/install drift |
| User Roles | Super Admin; system consumers |
| Data Owner | Metadata registry service |
| Source of Truth | MODULE/PACK/LISTING catalog |
| Dependencies | None (foundation); others depend on it |
| API Impact | Read APIs for registry; admin write |
| UI Impact | Platform module matrix; FeatureGate |
| Mobile Impact | mobileReady drives mobile nav |
| Security Considerations | Write = Super Admin only |
| Audit Requirements | Registry create/update/deprecate |


Single **registry of product truth** so Sidebar, Super Admin, Entitlements, Marketplace, Module Installer, docs, and future automation do not diverge.

### Metadata schema (per module / listing / pack item)

| Field | Purpose |
|-------|---------|
| `moduleName` | Stable id (`inbox`, `journeys`, …) |
| `category` | Engage / CRM / Intelligence / HR / Platform |
| `icon` | Nav icon key |
| `dependsOn[]` | Module dependencies |
| `requiredPlan` | Min plan enum |
| `requiredAddons[]` | SKU ids |
| `requiredFeatureFlags[]` | Flag keys + required states |
| `mobileReady` | boolean |
| `aiReady` | boolean |
| `publicApi` | boolean / scopes |
| `beta` | boolean |
| `deprecated` | boolean |

Industry Packs and Marketplace listings **reference** the same module ids.

### What metadata drives

| Consumer | Behavior |
|----------|----------|
| **Sidebar generation** | Render if installed ∧ entitled ∧ not deprecated; Beta pill if `beta` |
| **Super Admin** | Module matrix per company; force enable/disable |
| **Entitlements** | Evaluate requiredPlan/addons/flags in one place |
| **Marketplace** | Dependency resolution before install |
| **Module Installer** | Install graph + status |
| **Documentation** | Auto “available on Plan X” |
| **Future automation** | Pack install scripts, upgrade assistants |

| ID | Recommendation | Priority | Complexity | Impact |
|----|----------------|----------|------------|--------|
| PME-01 | Metadata registry ADR + JSON/Dynamo catalog | P0 | M | High |
| PME-02 | Drive nav + FeatureGate from registry | P1 | L | High |
| PME-03 | Packs + Marketplace consume same registry | P2 | M | High |

---

## Prioritization scoreboard (top items — scored)

| ID | Item | Priority | Effort | Business Value | Revenue Impact | Customer Impact | Technical Debt Reduction |
|----|------|----------|--------|----------------|----------------|-----------------|--------------------------|
| P2-01 | Plan catalog on company | P0 | M | High | SKU attach | Transparent limits | Ad-hoc plan fields |
| P2-02 / P3-01 | Entitlements service | P0 | L | High | Paid packaging | Predictable access | Flag spaghetti |
| P3-02 | Flags Super Admin UI | P0 | M | High | Controlled rollouts | Faster enablement | Manual flag edits |
| P8-01 | Settings IA / stubs | P0 | M | High | Demo trust | Less dead ends | Stub debt |
| P1-08 | Plan lock / upgrade UX | P0 | M | High | Upgrade path | Clear CTAs | Inconsistent gates |
| AI quota | Hard enforce | P0 | M | High | Cost protection | Fair AI use | Soft overQuota |
| Campaigns Audience | Unstick / remove | P0 | M | High | Campaigns GA | Core campaigns | Audience stub |
| P4-01 | Super Admin IA deepen | P0 | L | High | Platform control | Support speed | Shallow console |
| P6-03 | RBAC doc↔code | P0 | M | Medium | Enterprise trust | Correct roles | Matrix drift |
| Journey Instances + Live | Operator + Live path | P1 | M | High | Journey $ | Operator UX | Incomplete journey |
| P4-02 | Impersonation | P1 | M | High | Support velocity | Faster fixes | Support friction |
| P8-02 | Org branding | P1 | M | High | WL upsell path | Brand trust | Branding stubs |
| P6-01 | Owner/Finance/Marketing | P1 | L | High | Role sell | Least privilege | Role gaps |
| P2-03 | Billing self-serve | P1 | L | High | MRR collection | Owner autonomy | Billing stub |
| Notifications MVP | In-app center | P1 | M | High | Retention | Proactive alerts | Telegram stub |
| Outbound webhooks | GA Business+ | P1 | M | High | Integration SKU | Extensibility | Partial API |
| API plan gate | Entitled API | P1 | M | Medium | Plan differentiation | Safe API | Ungated API |
| Analytics stubs | Fill or remove | P1 | M | Medium | Credibility | Reporting | Stub debt |
| Teams first-class | Org model | P1 | L | High | Mid-market | Multi-team | Flat org |
| White Label add-on | SKU | P1–P2 | L | High | Enterprise $ | Branding | Add-on gap |
| SSO | Enterprise auth | P1 (Ent) | L | High | Enterprise deals | Security | Auth debt |
| Custom Fields | V2 CRM | P2 | L | High | Sticky CRM | Flexibility | Schema rigidity |
| Payment Phase 2 sweeper | Journey ops | P2 | M | Medium | Journey reliability | Recover payments | Resume edge cases |
| Custom Objects | V3 | P3 | XL | Medium | Platform play | Power users | Architecture |
| Voice AI | V3 | P3 | XL | Low–Med | Differentiation | Channel expand | New stack |
| PME-01 | Metadata registry | P0 | M | High | Enables packs | Consistent product | Dual SoT |
| P13-01 / P13-06 | Sub states + PG isolation | P0 | M | High | SaaS $ core | Lifecycle trust | Billing mix-up |
| PEO-01 / PEO-02 | Usage Meter + AI hard | P0 | L | High | Enforce limits | Fair quotas | Soft meters |
| PEO-05 | Audit plan/flag/addon | P0 | M | High | Compliance | Trust | Audit gaps |
| PEO-14 | AI real cost model | P0 | M | High | Margin control | Cost honesty | Placeholders |
| P14-01 / P14-02 | Installer + meta nav | P1 | L | High | Modular sell | Clear modules | Hardcoded nav |
| PEO-03 | Notification Center | P1 | M | High | Retention | Alerts | Stub alerts |
| PEO-10 | Customer Billing Portal | P1 | L | High | Self-serve $ | Owner UX | Portal stub |
| P15-02 | CS Health Score | P1 | L | High | Reduce churn | Proactive CS | Blind renewals |
| P11-02 | First Industry Pack | P1 | M | High | Vertical ARPU | Time-to-value | Template sprawl |
| P12-03 | Marketplace ↔ SKUs | P1 | M | High | Attach revenue | Discoverability | Catalog drift |
| P13-02 | Grace + dunning | P1 | L | High | Recover MRR | Fewer surprises | Manual chase |
| P4-04 / P4-05 | Sub console + authority | P0 | L | High | Ops control | Support speed | Manual billing |
| P13-09 / P13-12 | Timeline + Health dash | P0 | L | High | Ops visibility | Trust | Opaque history |
| P13-07 / PEO-10b | Owner portal allow-list | P0 | M | High | Self-serve $ | Safe autonomy | Over-permission risk |
| P13-10 | `assertWithinLimit` | P0 | L | High | Paid enforcement | Fair use | Soft limits |

---

## Implementation-ready phase gates (approval checklist)

Each phase below is a **Founder approval gate** before engineering starts:

1. **Packaging ADR** — SKUs, limits, trial, Journey payments bundled vs add-on  
2. **Entitlements + Flags ADR** — state model, precedence with existing `featureFlags.js`  
3. **Super Admin IA** — screens list + impersonation policy  
4. **RBAC ADR** — new roles vs map-only; permission registry  
5. **Settings IA** — stub kill list  
6. **Billing ADR** — SaaS subscription provider (separate from Journey Razorpay)  
7. **Add-on catalog** — first three SKUs to sell  
8. **Product Metadata Engine ADR** — registry schema; drives nav, installer, packs, marketplace *(new)*  
9. **Subscription Engine ADR** — full lifecycle (Trial→Archived), Super Admin as source of truth, Owner portal allow-list, Timeline, usage meters, Health Dashboard; explicit non-overlap with Journey `PAYMENT#` *(expanded Founder review)*  
10. **Module Installer + first Industry Pack** — Events pack + install graph *(new)*  
11. **Marketplace ADR** — first-party-only scope for V1/V2; third-party deferred to V3 *(new)*  
12. **Tenant Lifecycle + CS dashboard** — states, Health Score, churn signals *(new)*  

---

## Explicit non-goals (this program)

- Rewriting Customer 360 tab model  
- Replacing AutomationEngine or WhatsAppSendService  
- Replacing Dynamo single-table design  
- Redesigning Journey Razorpay money path (extend entitlements around it only)  
- Building Custom Objects before V2  
- Mixing SaaS subscription webhooks with Journey `payment.captured` handling *(clarified Phase 13)*  
- Giving Company Owner plan mutation / Mark Paid / Override Limits *(Subscription Engine — Super Admin only)*  
- Third-party Marketplace before first-party connectors stabilize *(Phase 12)*  

---

## Founder Approval Checklist

**Before any implementation from this Product Bible, verify:**

| # | Gate | Approved | Notes |
|---|------|----------|-------|
| 1 | **Architecture approved** | ☐ | Tenancy, single-table Dynamo, services, no redesign of CRM/Inbox/Journey PG |
| 2 | **UX approved** | ☐ | IA, Settings, Super Admin, plan-lock patterns (See Phases 1, 4, 8) |
| 3 | **Database approved** | ☐ | Subscription / timeline / meter / metadata keys; no Journey `PAYMENT#` collision (See Phase 13) |
| 4 | **API approved** | ☐ | Platform vs tenant routes; Owner Billing allow-list (See Phase 13.3) |
| 5 | **Security approved** | ☐ | Impersonation, audit, secrets, tenancy isolation |
| 6 | **Pricing approved** | ☐ | Starter→Enterprise SKUs, limits, add-on prices (See Phase 2) |
| 7 | **Entitlements approved** | ☐ | Plans + flags + add-ons precedence (See Phases 2–3; **Depends on Entitlements** ADR) |
| 8 | **RBAC approved** | ☐ | Owner/Finance/Marketing; raw-role gates; matrix (See Phase 6) |
| 9 | **Super Admin approved** | ☐ | Capability matrix Create→Audit (See Phase 4); Subscription console authority |
| 10 | **Billing approved** | ☐ | SaaS PG ≠ Journey PG; lifecycle Trial→Archived (See Phase 13) |
| 11 | **Roadmap approved** | ☐ | Effort/Value scoring + gate order 1–12 (See Phase 10) |
| 12 | **Product Metadata Engine approved** | ☐ | Registry schema (See PME; **Requires Metadata Engine** for Packs/Installer) |
| 13 | **Module Installer / Packs scope approved** | ☐ | First pack = Events; fail-closed (See Phases 11, 14) |
| 14 | **Marketplace scope approved** | ☐ | First-party only until V3 (See Phase 12) |

*This checklist freezes the audit as the long-term **APForce Product Bible**. No new phases or product areas without a new Founder revision.*

---

## Product Development Principles

This section defines how APForce must be built going forward.

1. **Build only what is required for the current business stage.**
2. **Do not implement future phases before there is customer demand.**
3. **Revenue-generating features always have higher priority than engineering perfection.**
4. **Reuse existing architecture before introducing new systems.**
5. **Every new module must integrate with:**
   - Entitlements
   - Subscription Engine
   - RBAC
   - Product Metadata Engine
   - Audit Log
6. **No module may bypass Super Admin authority where applicable.**
7. **Every feature must be mobile-first where practical.**
8. **Prefer configuration over custom code.**
9. **Backward compatibility must be preserved.**
10. **No implementation should begin without passing the Founder Approval Checklist.**

---

## Document revision

| Date | Change |
|------|--------|
| 2026-08-03 | Initial Phases 1–10 audit |
| 2026-08-03 | Founder review extension: Phases 11–15, Enterprise Operations, Product Metadata Engine; roadmap addendum; gates 8–12 |
| 2026-08-03 | Founder review — Subscription Engine major expansion: Phase 4 Super Admin control matrix; Phase 13 lifecycle (Payment Pending, Auto/Manual renewal, Timeline, usage enforcement, Health Dashboard); Owner Billing Portal allow-list; gate 9 expanded |
| 2026-08-03 | **Quality freeze:** Phase envelopes; Feature Architecture Cards; Super Admin Create→Audit matrix; module maturity Prototype→Future; roadmap Effort/Value/Revenue/Customer/Tech-debt scoring; cross-refs; Founder Approval Checklist — **no new product scope** |
| 2026-08-03 | **Version 1.0 (Frozen for Implementation):** Product Development Principles; product scope frozen; implementation gated by Founder Approval Checklist |

---

*End of APForce Product Bible **v1.0**. Next step: Founder completes Approval Checklist, then selects which Phase gate (1–12 above) to open for engineering.*
