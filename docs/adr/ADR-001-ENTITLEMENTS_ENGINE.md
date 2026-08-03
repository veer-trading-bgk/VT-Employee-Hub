# ADR-001 — Entitlements Engine

**Status:** Proposed (awaiting Founder approval — no implementation until Approved)  
**Date:** 2026-08-03  
**Deciders:** Founder + Engineering  
**Supersedes:** None (net-new commercial control plane)  
**Product Bible:** `docs/reports/APFORCE_ENTERPRISE_SAAS_PRODUCT_AUDIT_ROADMAP_2026-08-03.md` **v1.0** (tag `product-bible-v1.0`) — Phases 2, 3, 7, 13; Product Development Principles §5–6, §10  
**Related:** Future Subscription Engine ADR (Phase 13); Product Metadata Engine (PME); ADR-015 (AI quota seams); existing `src/utils/featureFlags.js`, `subscriptionMiddleware`

---

## Context

APForce is a working multi-tenant WhatsApp CRM SaaS. Commercial packaging today is incomplete:

| Concern | Today | Gap |
|---------|-------|-----|
| **Plans** | Ad-hoc `trial` / `paid` / `enterprise` / `internal` on company profile | No Starter → Enterprise catalog, no formal limits |
| **Flags** | Dynamo `CONFIG#FLAGS#*` + boolean `DEFAULTS` in `featureFlags.js` | Mostly unwired; no Super Admin UI; booleans overloaded if used for billing |
| **Add-ons** | Not a first-class catalog | Cannot sell Instagram, AI Pack, White Label, seats, credits cleanly |
| **Usage limits** | Soft AI `overQuota`; trial/suspend via `subscriptionMiddleware` | No unified meters or `assertWithinLimit` |
| **Subscription** | Company fields + JWT trial hints | Full lifecycle (Trial → Archived) and SaaS PG are Product Bible Phase 13 — separate from Journey `PAYMENT#` |

Without a single **Entitlements Engine**, every module will invent its own plan checks, flag reads, and limit blocks — the same duplication pattern ADR-012 / ADR-013 / ADR-015 were written to stop.

This ADR defines **architecture only**. It does not authorize code. Implementation starts only after Founder Approval Checklist items for Architecture, Pricing, Entitlements, Super Admin, and Billing are satisfied (Product Bible).

---

## Decision

**All commercial access decisions MUST go through a single Entitlements Engine.**

Routes, UI gates, Module Installer, Industry Packs, Marketplace, and Usage Meter enforcement must not evaluate plans, flags, add-ons, or limits independently.

### Rule 1 — One evaluation API

Conceptual surface (names illustrative — not an implementation mandate):

```text
EntitlementsService.evaluate({ companyId }) → EntitlementSnapshot
EntitlementsService.assertFeature({ companyId, featureKey })
EntitlementsService.assertWithinLimit({ companyId, meterKey, delta? })
EntitlementsService.isAddonActive({ companyId, addonSku })
```

- **`evaluate`** returns the effective snapshot for a tenant (plan, status, features, add-ons, limits, flags).
- **`assertFeature` / `assertWithinLimit`** fail closed when not entitled or over hard cap.
- Callers pass **`companyId` always**. Cross-tenant evaluation is prohibited.

### Rule 2 — Layer separation (do not overload flags with billing)

| Layer | Owns | Does not own |
|-------|------|--------------|
| **Plans** | SKU catalog, included features, base limits | Runtime flag toggles |
| **Add-ons** | Purchased / assigned SKUs that extend plan | Core CRM tab model |
| **Feature flags** | Rollout / beta / kill-switch / internal | Plan price or invoice state |
| **Usage limits** | Meters + soft/hard policy | Feature discovery copy |
| **Subscription Engine** | Lifecycle, renewals, invoices, Super Admin mutations | Journey customer Razorpay `PAYMENT#` |
| **Entitlements Engine** | **Intersection** of the above into one snapshot | Payment capture, Meta Graph calls |

**Preferred model (Product Bible Phase 3):** keep flag storage boolean (or small flag-state enum) for rollout; put **minPlan / addonSku / limit** in the entitlements + Product Metadata registry — do not stuff billing into `featureFlags.js` alone.

### Rule 3 — Precedence

Effective access for a feature key:

1. **Company suspended / archived / deleted** → deny writes (and reads per Subscription policy).  
2. **Super Admin override** (explicit, audited) → may grant or revoke temporarily.  
3. **Subscription status** (Trial, Active, Grace, Payment Failed, Suspended, Cancelled, …) → may force read-only or deny paid modules.  
4. **Plan included features + limits**.  
5. **Active add-ons** (union with plan).  
6. **Feature flags** (company > global > defaults) — kill-switch / beta / internal.  
7. **Product Metadata** (`requiredPlan`, `requiredAddons`, `beta`, `deprecated`) when PME is live.

If any hard deny applies, the feature is not entitled. Soft limits warn; hard limits block mutating actions.

### Rule 4 — Super Admin authority

Per Product Bible Phase 4 / Development Principle §6:

- Super Admin is the **source of truth** for plan assignment, add-on grant/revoke, flag overrides, limit overrides, manual invoice / mark-paid, suspend / restore.
- Company Owner may **view** plan/usage/invoices, **request** upgrade, **purchase** allow-listed add-ons, manage payment method — never silent plan mutation or Mark Paid.

### Rule 5 — Tenant isolation

Entitlement snapshots and meters are scoped by `companyId`. Cached snapshots must not leak across tenants. Platform APIs that mutate entitlements require Super Admin (or equivalent platform role).

### Rule 6 — Audit

Every mutation of plan, add-on, flag override, limit override, or subscription-affecting entitlement change MUST write:

- Audit log (existing `logAudit()` expansion — Product Bible PEO-05), and  
- Subscription Timeline event when the change is commercial (Phase 13.4 dual-write).

---

## Architecture components

### 1. Entitlements Engine (core)

| Concern | Architecture |
|---------|----------------|
| **Data Owner** | `EntitlementsService` (new single-owner service — to be implemented only after this ADR is Accepted) |
| **Source of Truth (computed)** | Entitlement snapshot derived from Subscription + Plan catalog + Add-ons + Flags + Overrides |
| **Source of Truth (inputs)** | Subscription record (Phase 13); plan catalog; add-on assignments; `CONFIG#FLAGS#*`; Super Admin overrides |
| **Consumers** | API middleware / route guards; dashboard `<FeatureGate>` / plan-lock UX; sidebar / Module Installer; Usage Meter; AI quota path (with ADR-015) |
| **Non-goals** | Replacing RBAC (who can act) — entitlements answer **whether the tenant may use the capability**; RBAC answers **which user roles** within the tenant |

### 2. Plans

| Item | Architecture |
|------|----------------|
| **Catalog** | Starter · Professional · Business · Enterprise (+ `internal` for APForce staff) as defined in Product Bible Phase 2 |
| **Fields (logical)** | `planId`, display name, included `featureKeys[]`, base `limits{}`, trial eligibility, support tier |
| **Assignment** | Only via Super Admin / Subscription Engine — never by arbitrary tenant Admin |
| **Storage (direction)** | Formalize beyond ad-hoc company `plan` string; align with `SUBSCRIPTION#` when Subscription Engine ships |
| **UI** | Platform plan catalog + company subscription console; Owner Billing Portal read-only plan view |

SKU numbers (seats, contacts, WA numbers, campaign caps, AI quotas, etc.) remain as in Product Bible Phase 2 until Pricing gate revises them — this ADR does not change prices.

### 3. Feature Flags

| Item | Architecture |
|------|----------------|
| **Reuse** | Extend existing `featureFlags.js` storage and precedence (company > global > DEFAULTS); do not invent a second flag store |
| **Target states** | `enabled` · `disabled` · `beta` · `internal` · `enterprise_only` · `addon` · `trial_only` — product states may map to entitlements + flag combo rather than overloading a single boolean forever |
| **DEFAULTS disposition** | Wire or retire unused keys (`contact_hub`, `workflow_builder`, …) under a Founder-approved list — Product Bible P3-03 |
| **Control plane** | Super Admin Feature Flags UI (Product Bible P3-02) — replace AWS CLI-only ops |
| **Frontend** | `<FeatureGate>` + plan-lock / upgrade CTA pattern (P1-08 / P3-04) — mobile-first where practical |

### 4. Add-ons

| Item | Architecture |
|------|----------------|
| **Catalog SKUs (Bible)** | Extra seats, contact packs, broadcast credits, AI Pack, extra WA/IG channels, storage, White Label / branding, API access, Voice AI (hidden until ready), etc. |
| **Assignment** | Super Admin assign/remove; Owner may purchase **allow-listed** SKUs via Billing Portal when Subscription Engine allows |
| **Evaluation** | `plan ∪ activeAddons` → feature keys and limit bumps |
| **Relation to Marketplace** | Marketplace listings reference the same SKU / module ids (Phase 12); entitlements remain the gate |
| **Credits / wallets** | Broadcast credits and AI allowance must not conflate with Journey payments or casually reuse AI wallet semantics without an explicit follow-on ADR (Bible caution on WalletService) |

### 5. Usage Limits

| Item | Architecture |
|------|----------------|
| **Meters (Bible)** | Contacts, Employees/seats, Broadcast, AI, Storage, API calls, WhatsApp assets |
| **API** | `assertWithinLimit({ companyId, meterKey, delta })` — fail closed on hard caps |
| **Soft vs hard** | Soft: warn + Notification Center; Hard: block create/invite/send/upload as applicable |
| **AI** | Move from soft-only `overQuota` to hard enforce via meter + ADR-015 usage attribution |
| **Seams** | Prefer counting at existing write paths (lead create, employee invite, campaign send, `AIService.generate`, S3 upload, API gateway) — not a separate Scan-heavy invent |
| **Overrides** | Super Admin Override Limits — always audited |

### 6. Subscription integration

| Item | Architecture |
|------|----------------|
| **Boundary** | **SaaS Subscription Engine ≠ Journey Razorpay.** Journey `PAYMENT#` / `payment.captured` remain customer-event money. Entitlements never treat Journey capture as SaaS renewal. |
| **Lifecycle inputs** | Trial, Active, Payment Pending, Grace, Payment Failed, Suspended, Cancelled, Archived (and Restore) drive entitlement posture (e.g. read-only after trial expiry policy) |
| **Who mutates subscription** | Super Admin (Create/Update/Suspend/Restore/Override/Approve/Mark Paid) |
| **Owner portal** | Strict allow-list: view plan/usage/invoices, request upgrade, pay / update payment method, buy allow-listed add-ons |
| **Middleware evolution** | Today’s `subscriptionMiddleware` (suspend / expired trial write block) becomes a thin consumer of Entitlements / Subscription status — not a second policy engine |
| **Timeline** | Plan changed, trial extended, payment failed, add-on enabled, limits overridden → Subscription Timeline + audit |

---

## Integration contract (every new module)

Per Product Development Principles §5, any new module MUST integrate with:

1. **Entitlements** — feature keys + limits registered and enforced  
2. **Subscription Engine** — commercial status respected  
3. **RBAC** — role checks remain separate and mandatory  
4. **Product Metadata Engine** — module id, `requiredPlan`, `requiredAddons`, maturity  
5. **Audit Log** — entitlement-affecting and security-sensitive actions  

No module may bypass Super Admin authority where commercial control applies.

---

## Explicit non-goals (this ADR)

- Implementing services, routes, UI, or Dynamo key migrations  
- Choosing SaaS payment provider SDK details (Billing ADR / Phase 13)  
- Redesigning Customer 360, Inbox, AutomationEngine, or WhatsAppSendService  
- Mixing Journey payment webhooks with SaaS subscription webhooks  
- Defining Industry Pack content or Marketplace third-party model  
- Replacing RBAC with entitlements  

---

## Consequences

### Positive

- Single commercial access path aligned with Product Bible v1.0  
- Flags stay operational; billing stays in plans/add-ons/subscription  
- Super Admin control plane and Owner portal allow-list stay enforceable  
- Future modules have a clear integration checklist  

### Risks / trade-offs

- Snapshot cache invalidation on plan/flag/addon change must be designed carefully  
- Migrating ad-hoc `plan` strings and boolean DEFAULTS needs a Founder-ordered cutover  
- Until Subscription Engine exists, Entitlements may read transitional company fields — must not fork a permanent dual SoT  

### Follow-on ADRs (expected)

- Subscription Engine lifecycle & SaaS PG isolation (Phase 13)  
- Product Metadata Engine registry schema (PME)  
- Usage Meter persistence & Notification Center (Enterprise Ops)  

---

## Approval

| Gate | Status |
|------|--------|
| Architecture (this ADR) | ☐ Proposed |
| Pricing (Phase 2 SKUs) | ☐ |
| Entitlements (this ADR Accepted) | ☐ |
| Super Admin control plane | ☐ |
| Billing / Subscription Engine ADR | ☐ |
| Founder Approval Checklist (Product Bible) | ☐ |

**Implementation must not begin until Status = Accepted and the Founder Approval Checklist items above are checked.**

---

## Document control

| Date | Change |
|------|--------|
| 2026-08-03 | Proposed — first engineering approval document after Product Bible v1.0 (`product-bible-v1.0`) |
