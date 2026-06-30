# APForce V3 — Information Architecture

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## 1. Structural Principle

Every navigation item in APForce V3 must satisfy one test:

> Can an employee explain this item's purpose in one sentence, without hesitation, on their first day?

If the answer is no, the item is wrong.

---

## 2. Final Navigation Structure

### Primary Navigation (Sidebar — 7 items)

```
APForce
════════════════════════════════════════════
  My Work             (all roles)
  Communications      (all roles)
  Customers           (all roles, scoped by assignment)
  Sales               (Sales, Manager, Admin, Owner)
  Analytics           (Manager, Admin, Owner)
  Automation          (Admin, Owner)
  Settings            (Admin, Owner; some sections Manager)
════════════════════════════════════════════
  🔔 Notifications    (persistent, all roles)
  [Avatar] Profile    (all roles)
```

Seven primary items. No more. Items absent for a given role are not rendered — not greyed, not locked, not hidden behind a toggle. The sidebar is always complete for the logged-in role.

### Customer 360

Customer 360 is **not** a navigation item. It is a workspace that opens when a specific customer is selected. See Section 5 for the full rationale.

---

## 3. Module Responsibilities

Each module has exactly one responsibility. No two modules share a responsibility.

| Module | Sole Responsibility |
|---|---|
| My Work | Show each employee what to do right now |
| Communications | Manage all customer conversations across channels |
| Customers | Find any customer and access their workspace |
| Sales | Manage the sales pipeline and track deal progress |
| Analytics | Report on performance across team, pipeline, and conversations |
| Automation | Define and manage automated business rules |
| Settings | Configure the workspace, team, and integrations |
| Customer 360 | Deep workspace for one specific customer |

Any feature that could belong in two modules belongs in neither — it belongs in Customer 360.

---

## 4. Complete Application Tree

```
APForce V3
│
├── My Work  /home
│   └── (single page — no sub-navigation)
│
├── Communications  /communications
│   ├── All Channels  (default)
│   ├── WhatsApp
│   └── [Future: Email, Instagram, SMS]
│
├── Customers  /customers
│   ├── All Contacts  (default)
│   ├── Leads
│   ├── Active Customers
│   ├── Investors
│   └── Inactive
│
├── Sales  /sales
│   ├── Pipeline (Kanban)  (default)
│   ├── List View
│   └── Follow-ups
│
├── Analytics  /analytics
│   ├── Overview  (default)
│   ├── Pipeline
│   ├── Conversations
│   ├── Team
│   └── Sources
│
├── Automation  /automation
│   ├── Workflows  (default)
│   └── Logs
│
└── Settings  /settings
    ├── Organisation
    │   ├── Company Profile
    │   ├── Employees
    │   ├── Teams
    │   ├── Roles & Permissions
    │   └── Audit Log
    ├── Sales Configuration
    │   ├── Pipelines & Stages
    │   └── Tags
    ├── Channels
    │   ├── WhatsApp
    │   ├── Message Templates
    │   └── Broadcast
    └── System
        ├── Integrations
        ├── Billing  (Owner only)
        └── Danger Zone  (Owner only)

─── Context workspaces (not navigation) ──────────────

Customer 360  /customers/[id]
    ├── Overview  (default)
    ├── Conversations
    ├── Notes
    ├── Tasks
    ├── Timeline
    ├── KYC
    └── Documents

─── Global overlays (accessible from any screen) ─────

Command Palette   Cmd+K
Notifications     Bell icon
Universal Drawer  Triggered by any creation/edit action
FAB               Bottom-right, all screens
Search            Via Command Palette or Cmd+K
```

---

## 5. Why Customer 360 Is Not a Navigation Item

This is the most important architectural decision in V3.

**The definition of a navigation item:**  
A place you go to see a *category* of things. "Customers" is a navigation item because you can go there to browse any customer. "Communications" is a navigation item because you can go there to see all conversations.

**The definition of a workspace:**  
A place you open to do work on *one specific thing*. Customer 360 requires a specific customer — you cannot navigate to "Customer 360" without first answering "which customer?"

Making Customer 360 a sidebar item would create one of two bad outcomes:
1. An empty/confusing state ("Select a customer first")
2. An arbitrary "last viewed" default that creates navigational confusion

**How Customer 360 is reached instead:**

| Source | Action | Result |
|---|---|---|
| Customers | Click any row | Customer 360 opens |
| Sales (Kanban) | Click any card | Customer 360 opens |
| Sales (List) | Click any row | Customer 360 opens |
| Communications | Click customer name in snapshot | Customer 360 opens |
| My Work | Click urgent item or follow-up | Customer 360 opens |
| Notifications | Click notification link | Customer 360 opens |
| Command Palette | Search customer name | Customer 360 opens |
| Global Search | Search and select | Customer 360 opens |

Customer 360 is always one click away from any customer-facing context. It is never more than two clicks from anywhere in the application.

**The pattern used by industry leaders:**  
Salesforce, HubSpot, Zendesk, Intercom, and Linear all follow this pattern. Contact detail, ticket detail, and issue detail are workspaces opened from lists — not sidebar navigation items. APForce follows this established convention.

---

## 6. Why Employees Moved Into Settings

In V2, Employees was a top-level sidebar item available to managers and admins.

**The problem:**  
Employees (invite, deactivate, assign roles) is an administrative action that happens infrequently — typically during onboarding and offboarding events. It does not belong alongside My Work, Communications, and Customers, which are daily-use operational tools. Placing it in the primary sidebar gave it equal visual weight to modules that employees use dozens of times per day.

**The solution:**  
Employees lives under Settings > Organisation. It is co-located with Teams, Roles & Permissions, and Audit Log — all other administrative tools that shape how the workspace is configured. This grouping is coherent: "Organisation" is the section about who works here and how they are structured.

**Result:**  
The primary sidebar shrinks from 8 to 7 items. Every remaining item is an operational tool that employees use daily or weekly. The sidebar becomes immediately scannable.

---

## 7. URL Structure

All URLs use noun-based paths. No `/admin/` prefix. Query params for filter state (bookmarkable, browser-back-restorable). Sub-paths for structurally distinct sections.

| Screen | URL |
|---|---|
| My Work | `/home` |
| Communications | `/communications` |
| Communications (filtered) | `/communications?status=open&assigned=me` |
| Customers | `/customers` |
| Customers (filtered) | `/customers?lifecycle=lead&owner=me` |
| Customer 360 | `/customers/[contactId]` |
| Customer 360 Tab | `/customers/[contactId]?tab=conversations` |
| Sales (Kanban) | `/sales` |
| Sales (List) | `/sales?view=list` |
| Sales (Follow-ups) | `/sales/followups` |
| Analytics | `/analytics` |
| Analytics (Section) | `/analytics/pipeline` |
| Automation | `/automation` |
| Automation (Logs) | `/automation/logs` |
| Settings | `/settings` |
| Settings (Section) | `/settings/employees` |
| Settings (Billing) | `/settings/billing` |

**URL design rules:**
1. No `/admin/` prefix — routing access is enforced at the application level
2. Filter state lives in query params so URLs are shareable and bookmarkable
3. Tab state in Customer 360 lives in query params (not hash fragments)
4. Deep links to specific records include the record ID in the path

---

## 8. Navigation Depth

Maximum depth at any time: **2 levels**.

- Level 1: Primary navigation (sidebar)
- Level 2: Module sub-navigation (tabs or secondary nav within module)

Customer 360 tabs are Level 2 within the Customer context — they are not considered a third level because Customer 360 is a workspace, not a navigation destination.

**Rule:** A user should never need to navigate more than 2 intentional steps to reach any information in the system.

---

## 9. Naming Rationale

### "My Work" (was: "Home", "Dashboard")

"Dashboard" implies charts and reports. "Home" implies a landing page. "My Work" answers: *what am I here to do?* It communicates purpose, not place.

### "Communications" (was: "Inbox")

"Inbox" is email vocabulary. More importantly, "Inbox" hardcodes the channel in the name. "Communications" is channel-agnostic and accommodates WhatsApp, email, Instagram, and SMS without renaming.

### "Customers" (was: "Contact Hub", "Contacts")

"Contact Hub" describes software. "Contacts" is generic (phone book, email client). "Customers" is the business word for who these people are — it immediately communicates the purpose.

### "Sales" (was: "CRM", "Pipeline")

"CRM" is a software category. "Pipeline" describes only one view (kanban). "Sales" is the job to be done. Every employee knows what "Sales" means.

### "Settings" contains "Employees" (was: "Employees" as top-level item)

Administrative tools (employees, roles, integrations, billing) belong together in one configuration section. Daily operational tools belong in the primary nav. This is how Linear, HubSpot, Notion, and Stripe structure their navigation.

---

## 10. Cross-Module Relationships

```
My Work ─────────────────── reads from: Conversations, Tasks, Leads, Metrics
                             links to:   Communications, Customer 360, Sales

Communications ──────────── reads from: Conversations, Contacts
                             links to:   Customer 360
                             writes to:  Conversations, Contacts (stage, owner, tags via snapshot)

Customers ───────────────── reads from: Contacts
                             links to:   Customer 360
                             writes to:  Contacts (via Universal Drawer)

Sales ───────────────────── reads from: Contacts (filtered to pipeline)
                             links to:   Customer 360, Communications
                             writes to:  Contacts (stage, owner, follow-ups)

Customer 360 ────────────── reads from: all entities for one contact
                             writes to:  Contacts, Conversations, Tasks, Notes, Documents, Stage History

Analytics ───────────────── reads from: aggregated metrics across all entities
                             links to:   filtered views in Customers, Sales, Communications
                             writes to:  nothing (read-only)

Automation ──────────────── reads from: Workflow definitions
                             writes to:  Workflows, triggers Contacts/Conversations mutations

Settings ────────────────── reads from: Company Config, Employees, Roles, Integrations
                             writes to:  all configuration entities
```

---

## 11. Anti-Patterns Avoided

| Anti-pattern | Decision |
|---|---|
| Duplicate mutation surfaces | Stage changes happen in exactly one place per context (Sales kanban drag, C360 stage dropdown, Communications snapshot dropdown) |
| Feature-named navigation | Renamed "CRM" → "Sales", "Inbox" → "Communications", "Contact Hub" → "Customers" |
| Role-gating with visual noise | Hidden items, not disabled items |
| Deep navigation hierarchies | Maximum 2 levels enforced |
| Context-less direct navigation | Customer 360 requires a contact — never opened without one |
| Admin-prefixed routes | `/admin/` prefix removed entirely |
| Competing sources of truth | One CONTACT# entity. All modules read from it. |
