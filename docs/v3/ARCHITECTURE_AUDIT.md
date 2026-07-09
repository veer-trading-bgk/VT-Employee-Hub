# APForce V3 — Architecture Audit

**Date:** 2026-06-29
**Status:** Pre-implementation audit. No production code changed.
**Scope:** Complete survey of current implementation against V3 Master Directive.

---

## 1. Current Module Inventory

### Admin-facing Modules (customer/sales side)

| Current Route | Current Name | V3 Name | Status |
|---|---|---|---|
| `/admin/dashboard` | Dashboard | My Work | Rename + restructure |
| `/admin/crm` | CRM | Sales | Rename routes + nav |
| `/admin/crm/followups` | Follow-ups | Sales > Follow-ups | Keep, move under Sales |
| `/admin/crm/analytics` | CRM Analytics | → Analytics module | Extract to top-level |
| `/admin/crm/automations` | CRM Automations | → Automation module | Extract to top-level |
| `/admin/crm/forms` | CRM Forms | → Settings | Relocate |
| `/admin/crm/import` | CRM Import | → Customers module | Relocate |
| `/admin/crm/settings` | CRM Settings | → Settings | Relocate |
| `/admin/contacts` | Contact Hub | Customers | Rename routes + nav |
| `/admin/contacts/[id]` | (Customer 360) | Customers/[id] | Route update only |
| `/admin/whatsapp` | Inbox | Communications | Rename routes + nav |
| `/admin/whatsapp/templates` | WA Templates | Communications > Templates | Keep |
| `/admin/whatsapp/broadcast` | Broadcast | Campaign (future) | Label-only change |
| `/admin/whatsapp/settings` | WA Settings | Settings | Relocate |

### Employee-facing Modules (internal HR side)

| Current Route | Status |
|---|---|
| `/employee/dashboard` | Working. Keep. |
| `/employee/daily-entry` | Working. Keep. |
| `/employee/crm` | Working (simplified lead view for agents). Keep. |
| `/employee/crm/[id]` | Working. Keep. |
| `/employee/achievements` | Working. Keep. |
| `/employee/compensation` | Working. Keep. |
| `/employee/attendance` | Working. Keep. |
| `/manager/dashboard` | Working. Keep. |
| `/manager/verify-metrics` | Working. Keep. |
| `/manager/attendance` | Working. Keep. |
| `/manager/bulk-entry` | Working. Keep. |
| `/team-lead/dashboard` | Working. Keep. |
| `/team-lead/verify-metrics` | Working. Keep. |
| `/team-lead/add-entry` | Working. Keep. |

### Platform Module (superadmin only)

| Current Route | Status |
|---|---|
| `/platform` | Working. Out of V3 scope. |
| `/platform/companies` | Working. Out of V3 scope. |
| `/platform/billing` | Working. Out of V3 scope. |
| `/platform/health` | Working. Out of V3 scope. |
| `/platform/analytics` | Working. Out of V3 scope. |

---

## 2. Violation Inventory

### V3 Principle: No duplicate mutation surfaces

These are confirmed violations. Each represents a non-compliant mutation surface that must be removed.

#### Pipeline Stage — 4 surfaces (should be 2)

| Surface | Location | File | V3 Decision |
|---|---|---|---|
| Inline select dropdown | Contact Hub table (per row) | `app/admin/contacts/page.tsx:713` | **REMOVE** |
| Stage select in sidebar | LeadSidebar in Inbox | `components/whatsapp/LeadSidebar.tsx:98` | **REMOVE** |
| Kanban drag-drop | Sales (CRM) board | `app/admin/crm/page.tsx` | **KEEP** (sanctioned exception — DL-009) |
| CRM tab select | Customer 360 CRM tab | `components/contacts/tabs/CrmTab.tsx` | **KEEP** (primary surface) |

#### Tags — 3 surfaces (should be 1)

| Surface | Location | File | V3 Decision |
|---|---|---|---|
| Floating TagSelector | Contact Hub table (per row) | `app/admin/contacts/page.tsx:739` | **REMOVE** |
| Quick tag input | LeadSidebar in Inbox | `components/whatsapp/LeadSidebar.tsx:114` | **REMOVE** |
| Profile tab tag editor | Customer 360 Profile tab | `components/contacts/tabs/ProfileTab.tsx` | **KEEP** (primary surface) |

#### Notes — 2 surfaces (should be 1)

| Surface | Location | File | V3 Decision |
|---|---|---|---|
| Quick Note textarea | LeadSidebar in Inbox | `components/whatsapp/LeadSidebar.tsx:140` | **REMOVE** |
| Notes tab | Customer 360 Notes tab | `components/contacts/tabs/NotesTab.tsx` | **KEEP** (primary surface) |

---

## 3. Dead/Stub Pages

These routes exist but render placeholder or "coming soon" content.

| Route | File | Current State | V3 Action |
|---|---|---|---|
| `/admin/crm/automations` | `app/admin/crm/automations/page.tsx` | Stub | Extract → top-level Automation module |
| `/admin/crm/analytics` | `app/admin/crm/analytics/page.tsx` | Stub or partial | Extract → top-level Analytics module |
| `/admin/crm/forms` | `app/admin/crm/forms/page.tsx` | Stub | Move → Settings |
| `/admin/contacts/[id]` Documents tab | `components/contacts/ContactTabPanel.tsx` | `ComingSoonPanel` | Implement in Phase 3 |

*Note: Need to open each stub to confirm current state. The audit assumes stub from V2 CRM subnav design.*

---

## 4. Navigation Violations

### Sidebar (`components/layout/Sidebar.tsx`)

**Current admin nav items:**
```
Dashboard | CRM | Contact Hub | Inbox | Targets | Analytics | Bulk Entry |
Verify Metrics | Team | Metric Settings | Audit Logs | Billing
```

**V3 admin nav items (target):**
```
My Work | Communications | Customers | Sales | Analytics | Automation |
Employees | Settings
```

**Specific violations:**
- Labels: "CRM" → "Sales", "Contact Hub" → "Customers", "Inbox" → "Communications", "Dashboard" → "My Work"
- "Targets", "Bulk Entry", "Verify Metrics" → move into Employees or Settings sub-navigation
- "Team" → merge into Employees
- "Metric Settings" → move into Settings
- "Audit Logs" → move into Settings or platform-level
- "Billing" → move into Settings
- CRM subnav has Analytics + Automations that should become top-level items
- Sidebar still shows "v2.0 Pro" branding

### Route Structure Violations

All admin routes use the `/admin/` prefix. V3 removes this:

| Current | V3 Target | Redirect Required |
|---|---|---|
| `/admin/dashboard` | `/home` | Yes |
| `/admin/crm` | `/sales` | Yes |
| `/admin/crm/followups` | `/sales/followups` | Yes |
| `/admin/contacts` | `/customers` | Yes |
| `/admin/contacts/[id]` | `/customers/[id]` | Yes |
| `/admin/whatsapp` | `/communications` | Yes |
| `/admin/whatsapp/templates` | `/communications/templates` | Yes |
| `/admin/analytics` | `/analytics` | Yes |

*Implementation note: Next.js redirects in `next.config.js`. Old URLs must continue to work for 30 days post-migration.*

---

## 5. Lifecycle Model Gap

**Current implementation:** `journeyInference.ts` derives a journey state from pipeline stage and milestone fields. This is a computed display, not a stored business fact.

**Gap:** No `lifecycleStage` field on contact/lead records in DynamoDB. No `lifecycleHistory` audit log. No way to filter by lifecycle stage in the Customers module. No way to trigger automations on lifecycle change (no event fires).

**Impact:** All of the following V3 features are blocked until lifecycle is implemented:
- Lifecycle badge in Customer 360 header (needs the field to display)
- Lifecycle promotion in Profile tab (needs the field to mutate)
- Lifecycle filter in Customers module (needs the field to query)
- Timeline `lifecycle_change` events (needs the mutation to trigger the event)
- Analytics by lifecycle stage (needs the field to aggregate)

**Conclusion: Lifecycle implementation is the critical path dependency for Phase 3.**

---

## 6. Architecture Health Summary

### What is working correctly (do not touch)

| Component | Assessment |
|---|---|
| Customer360Provider + useCustomer360() hook | Clean. Single data owner. All tabs consume correctly. |
| Customer 360 tab structure (7 frozen tabs) | Correct. CLAUDE.md enforced. |
| ContactHeader, ContactTabNav, ContactTabPanel | Clean. Compose correctly from shared context. |
| ChatPane + ConversationTab | Working. Real-time WS updates functional. |
| InboxContext (conversation selection, WS state) | Solid. Keep. Only simplify LeadSidebar. |
| CRM kanban drag-drop | Working. Sanctioned exception. Keep. |
| Admin Dashboard KPIs (queries) | Working. Rename to My Work. Keep queries. |
| Employee HR modules (all routes) | Working. Out of scope for Phase 3 mutations. |
| GlobalSearch component | Working. Keep. |
| WebSocketContext + wsClient | Working. Keep. |
| React Query setup + QueryProvider | Clean. Keep. |
| ThemeContext | Clean. Keep. |
| Permission system (permissions.ts) | Working. Role consolidation is Phase 3 last commit. |

### What needs fixing (architecture violations)

| Component | Problem | Priority |
|---|---|---|
| Contact Hub — inline stage dropdown | Duplicate mutation surface | **P1** |
| Contact Hub — floating TagSelector | Duplicate mutation surface | **P1** |
| LeadSidebar — stage, tags, quick note | 3 duplicate mutation surfaces | **P1** |
| Route structure — `/admin/` prefix | V3 removes prefix | **P2** |
| Navigation labels | V2 names (Inbox, Contact Hub, CRM) | **P2** |
| Lifecycle field | Missing from data model | **P1 (critical path)** |
| Documents tab | "Coming soon" stub | **P3** |
| CRM subnav | Contains Analytics + Automations (should be top-level) | **P4** |
| Role system | 7 roles → 5 roles | **P5 (last, high risk)** |

---

## 7. Optimal Implementation Sequence

This sequence is derived from three constraints:
1. **Dependency ordering** — lifecycle must exist before lifecycle badges, filters, timeline events
2. **Risk ordering** — low-risk changes first, high-risk (role migration) last
3. **Value ordering** — architecture corrections first (they unblock clarity for subsequent work)

---

### Group A — Architecture Corrections
*Zero new features. Makes existing code correct. No risk. Each independently deployable.*

**A1 — Remove mutation surfaces from Contact Hub**
- Remove inline stage `<select>` per row from `app/admin/contacts/page.tsx`
- Remove `stageMutation` and related state
- Remove floating `TagSelector`, `selectorState`, `tagMutation`, `createTagMutation` from contacts page
- Keep: search, filters, sort, bulk delete, CSV export, pagination, row click → Customer 360
- Stage becomes a read-only chip (styled `<span>` matching stage color)
- Tags become read-only `<TagBadge>` list

**A2 — Simplify LeadSidebar (Communications)**
- Remove stage `<select>` section (lines 95–111)
- Remove tags section (lines 113–138)
- Remove quick note section (lines 140–160)
- Keep: name/phone/email, "Open in Customer 360 ↗" button, assignee `<select>`, chat status display, source/created/WA window meta
- Remove now-unused `stageMutation`, `tagMutation`, `noteMutation` consumption from sidebar (they remain in InboxContext for C360 use if needed)
- Keep InboxContext mutations — do not delete; they may be needed by other consumers

**A3 — Rename navigation + routes**
- Sidebar: update labels (Communications, Customers, Sales, My Work)
- Sidebar: update hrefs to new route paths
- Add Next.js `redirects` in `next.config.js` for all `/admin/*` paths
- Update `getHomePath()` in `permissions.ts` for admin role → `/home` (or defer until route rename)
- Update `Navbar` title strings in affected pages
- Update all internal `Link href` and `router.push` calls

---

### Group B — Lifecycle Model
*Backend + frontend. Prerequisite for all lifecycle-dependent features. Medium risk.*

**B1 — Backend: Add `lifecycleStage` field**
- Lambda: Add `lifecycleStage` to lead PUT/PATCH endpoint
- Lambda: Add `lifecycleHistory` append logic (timestamp, from, to, changedBy)
- Lambda: Add GET endpoint field (include `lifecycleStage` in lead response)
- DynamoDB: Field is added inline on next lead update — no migration script needed for new records
- For existing records: return `null` on read; frontend falls back to `journeyInference.ts` display

**B2 — Frontend: Lifecycle badge in Customer 360 header**
- `ContactHeader.tsx`: Replace journey bar pill with lifecycle badge
- Use `contact.lifecycleStage ?? inferJourney(contact).currentStage` for backward compat
- Badge uses lifecycle colour system from `docs/v3/04_CUSTOMER_LIFECYCLE.md`

**B3 — Frontend: Lifecycle promotion in Profile tab**
- `ProfileTab.tsx`: Add lifecycle section with current stage badge + promotion/demotion controls
- Confirmation dialog for each lifecycle change
- Calls new PATCH endpoint, updates `Customer360Provider` cache

**B4 — Frontend: Lifecycle filter in Customers module**
- Add "Lifecycle" filter dropdown to Contact Hub (Customers) filter bar
- Filter values: Unknown, Lead, Qualified, Customer, Investor, VIP, Dormant

---

### Group C — Customer 360 Improvements
*Frontend only. No new tabs. All improvements within frozen tab structure.*

**C1 — Documents tab**
- Remove `ComingSoonPanel` stub
- Implement document list (KYC docs, WhatsApp media, agent uploads)
- Document card: name, uploader, date, size, category, download + delete
- Backend: confirm `/api/contacts/[leadId]/documents` endpoint exists; implement if missing
- Categories: KYC Documents, WhatsApp Media, Agent Uploads

**C2 — Deal value + win probability in CRM tab**
- `CrmTab.tsx`: Activate `expectedValue` field (reserved in V2, `reservedExpectedValue`)
- Add `winProbability` slider (0–100%)
- Both feed into pipeline revenue forecast (shown in Sales board header)

**C3 — Timeline lifecycle events**
- Backend: When lifecycle changes, emit `lifecycle_change` Timeline event
- `TimelineTab.tsx`: Add `lifecycle_change` event type rendering
- Filter system: add `lifecycle` to CRM filter bucket

**C4 — Health score enhancement**
- `HealthScoreBadge.tsx`: Replace static number with 6-signal weighted algorithm
- Signals: message recency (25%), follow-up completion (20%), response time (15%), lifecycle progress (15%), task overdue rate (15%), note recency (10%)
- Add hover tooltip breakdown
- Pure client-side calculation — no API calls

**C5 — Next best action**
- New file: `src/lib/contacts/nextBestAction.ts`
- ~10 named deterministic rules evaluated against contact record
- `ContactHeader.tsx`: Add "Next Action" button showing top rule result
- Clicking button navigates to relevant tab via `?tab=` query

---

### Group D — My Work Home Pages
*Frontend only. New pages per role. No backend changes.*

**D1 — My Work: Sales Agent**
- New page at `/home` (or keep `/employee/dashboard` + rename, depending on route strategy)
- Widgets: today's follow-ups, unread conversations, overdue tasks, today's activity counter
- All widgets parallel-loaded via independent React Query calls
- No mutations — observe only

**D2 — My Work: Manager**
- `/manager/dashboard`: Restructure to show team-level My Work view
- Widgets: team pipeline snapshot, who hasn't logged today, overdue follow-ups by agent, unread conv count

**D3 — My Work: Admin/Owner**
- `/admin/dashboard`: Rename to My Work, restructure layout
- Keep all existing queries (they are correct and well-built)
- Remove "Quick Actions" panel (actions belong in each module)
- Add KPIs: today's new contacts, open conversations, revenue in pipeline

---

### Group E — Module Extractions
*Medium risk. Involves route changes and navigation restructure.*

**E1 — Analytics module (top-level)**
- Create `/analytics` route and top-level nav entry
- Move content from `/admin/crm/analytics` stub
- Create role-specific dashboard views within Analytics
- Remove Analytics from CrmSubNav

**E2 — Automation module (top-level)**
- Create `/automation` route and top-level nav entry
- Move content from `/admin/crm/automations` stub
- Sequences, rules, reminders framework
- Remove Automations from CrmSubNav

**E3 — Employees module consolidation**
- Create `/employees` top-level nav entry pointing to `/admin/employees`
- Pull attendance, compensation, verification under the Employees nav group
- Clean up Sidebar grouping (currently scattered across groups)

---

### Group F — Role System
*High risk. Affects DynamoDB user records. Must be last.*

**F1 — Role consolidation**
- ~~Merge `team_lead` → `manager` in `types/index.ts` and `utils/permissions.ts`~~ — **never executed, no longer planned.** Corrected 2026-07-09: verified against the code that this merge was never implemented in backend authorization; `team_lead` remains a real, distinct, team-scoped `checkRole()` role, ratified as intentional product behavior (`docs/v3/12_DECISION_LOG.md` DL-021, superseding DL-005). Only the frontend display layer (`toV3Role()`) collapses the two into one UI bucket — never use that for permission gating.
- Merge `agent`, `telecaller`, `intern` → `sales` in type system
- Add `owner` role (above admin, below superadmin)
- Add `support` role
- Migration: one-time DynamoDB scan to update existing user records
- Sidebar: add SALES_GROUPS config for new `sales` role
- All `ROLE_LABELS` and `ROLE_COLORS` updated
- getHomePath() updated for new roles

---

## 8. Commit Count Estimate

| Group | Commits | Risk |
|---|---|---|
| A — Architecture Corrections | 3 | Low |
| B — Lifecycle Model | 4 | Medium |
| C — Customer 360 Improvements | 5 | Low-Medium |
| D — My Work Home Pages | 3 | Low |
| E — Module Extractions | 3 | Medium |
| F — Role System | 1 | High |
| **Total** | **19** | — |

---

## 9. What Not to Build in Phase 3

The following are explicitly deferred. Do not scope-creep.

| Feature | Why Deferred |
|---|---|
| AI-enhanced health score | Requires LLM API integration. Phase 4. |
| AI-enhanced next best action | Same. Phase 4. |
| Campaign broadcasts | Requires template approval workflow, rate limits, opt-out. Phase 4. |
| Instagram / Email channel support | Requires new webhook handlers. Phase 4. |
| Relationship Score | Complex multi-signal calculation. Nice-to-have. Phase 4. |
| Winning probability AI | Client-side manual slider is sufficient for Phase 3. |
| AI Summary slot | Reserve the data-slot. Do not implement. Phase 4. |
| Owner role full permissions | Implement role; full permission differentiation is Phase 4. |

---

## 10. Pre-Flight Checklist

Before any Phase 3 commit is written, confirm:

- [ ] This audit is approved and understood
- [ ] Implementation sequence is approved (A → B → C → D → E → F)
- [ ] CLAUDE.md Production Validation Report format is known
- [ ] Architecture Compliance checklist is ready
- [ ] No commit will introduce a new tab to `CONTACT_TABS`
- [ ] No commit will introduce a new `useQuery` key owned by Customer360Provider
- [ ] Every commit can be individually reverted without breaking the application
- [ ] `.env` and `scripts/lambda-env.json` will never be staged

---

*This audit supersedes the implementation order in `docs/v3/11_PHASE3_IMPLEMENTATION_PLAN.md`. The plan document is correct on WHAT to build; this audit determines the optimal ORDER based on dependency analysis and risk.*
