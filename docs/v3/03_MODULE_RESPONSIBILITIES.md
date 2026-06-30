# APForce V3 — Module Responsibilities

**Status:** Approved Pre-Phase 3 Foundation Document
**Date:** 2026-06-29
**Version:** 3.0

---

## Governing Rule

> Every module has one job. If you cannot describe what a module does in one sentence without using the word "and", it has too many jobs.

---

## Module 1 — Home (My Work)

### Purpose
Show every employee exactly what needs their attention today.

### One-sentence description
*"The first thing you see: your work queue for today."*

### What belongs
- Follow-up tasks due today and overdue (sorted by urgency)
- Open conversations assigned to me that have not been responded to in > 2 hours
- Upcoming meetings for today
- Notifications: new lead assigned, mention, automation trigger
- My pipeline summary: X leads total, Y require action, Z overdue
- My target progress: calls / leads / conversions vs. daily target
- Quick actions: New Contact, Send Message, Log Call
- Hot leads: AI-prioritised contacts needing attention (Phase 3+)
- Leaderboard position (optional, role-configurable)

### What never belongs
- Team-wide pipeline analytics (→ Analytics)
- Other agents' work queues (→ Employees > Team view)
- Customer data modification (→ Customer 360)
- System configuration (→ Settings)
- Automation management (→ Automation)

### Entry points
- Application login (default landing page for all roles)
- Logo click from any other module
- `/home` route directly

### Exit points
- Click a follow-up task → Customer 360 for that contact
- Click a conversation → Communications, focused on that thread
- Click a hot lead → Customer 360 for that contact
- Click "New Contact" → Customer 360 create flow or Customers > Create modal
- Click "View Pipeline" → Sales > Pipeline

### Relationship with Customer 360
Home is the most important entry point to Customer 360 for agents. Every follow-up task, every hot lead, every assigned contact links directly to Customer 360 for that person. Home does not display customer data directly — it displays work items that reference customers.

---

## Module 2 — Communications

### Purpose
Manage every conversation the business has with customers, across every channel.

### One-sentence description
*"The place where you talk to customers."*

### What belongs
- Conversation queue: list of all inbound/outbound conversations, filterable by status, channel, assignee
- Chat status management: open, resolved, re-opened
- Conversation assignment: route to the right agent
- Read and send messages: WhatsApp (live), future channels (Instagram, email, SMS, voice)
- Template sending: regulated WhatsApp templates
- Canned responses: quick reply shortcuts
- Media attachments: images, documents, voice notes
- 24-hour window indicator (WhatsApp compliance)
- Contact identification: who is this person, what lifecycle stage, what is their name
- "Open in Customer 360" — the primary CTA for deep work

### What never belongs
- Pipeline stage changes (→ Customer 360 > CRM tab)
- Tag assignment (→ Customer 360 > Profile tab)
- Internal notes (→ Customer 360 > Notes tab)
- Lead creation from within the chat pane (→ Customers > New Contact)
- Analytics on conversation volume (→ Analytics > Conversations)
- Template creation (→ Settings > Templates or Communications > Templates sub-section)
- Automation rule configuration (→ Automation)

### Entry points
- Sidebar nav
- Home > Open Conversations shortcut
- New inbound WhatsApp message (auto-focused)
- Direct URL to conversation

### Exit points
- Click "Open in Customer 360 ↗" → Customer 360 for the contact
- Assign conversation → stays in Communications
- Resolve conversation → moves to Resolved tab, stays in Communications
- Click contact name → Customer 360 Profile tab

### Sidebar (conversation context strip)
When a conversation is open in Communications, the right sidebar shows:
- Contact name + phone (clickable → Customer 360)
- Lifecycle stage badge (read-only)
- Assigned agent (editable — conversation routing is Communications' responsibility)
- Chat status (open/resolved/unassigned)
- 24h window status
- "Open in Customer 360 ↗" — prominent button

The sidebar does NOT show:
- Pipeline stage dropdown (read-only pill only)
- Tag editor (read-only chips only)
- Note input
- Product interest

### Relationship with Customer 360
Communications is the live conversation channel. Customer 360 is the relationship workspace. When an agent is handling an inbound query, they live in Communications. When they need context about the customer's history, products, or pipeline status, they click into Customer 360. The two are complementary, not competing.

**Message thread consistency:** The WhatsApp thread shown in Communications and in Customer 360 > Conversation tab is identical — same data, same real-time updates. The difference is context: Communications shows it in the context of the conversation queue; Customer 360 shows it in the context of the complete customer relationship.

---

## Module 3 — Customers

### Purpose
Browse, search, and manage the complete database of every person the business knows.

### One-sentence description
*"The place where all your customers live — find anyone instantly."*

### What belongs
- Paginated, searchable contact list (all lifecycle stages, all types)
- Lifecycle filter: Unknown | Lead | Qualified | Customer | Investor | VIP | Dormant
- Additional filters: source, tags, product interest, assignee, creation date, last activity date
- Sortable columns: name, lifecycle, source, created date, last activity
- Contact creation: "New Contact" button — the primary lead creation surface
- Unknown → Lead promotion (inline or via Customer 360)
- Bulk operations: delete, export, bulk tag, bulk lifecycle update
- CSV import workflow
- Read-only display of stage, tags, source, assignee (no inline mutations)
- Entry point to Customer 360 (row click)

### What never belongs
- Pipeline stage mutation inline (→ Customer 360 CRM tab or Sales > Pipeline)
- Tag mutation inline (→ Customer 360 Profile tab)
- WhatsApp messaging (→ Communications or Customer 360 > Conversation tab)
- Employee management (→ Employees)
- Analytics (→ Analytics)

### Entry points
- Sidebar nav
- Global Search results overflow ("see all results")
- Home > Quick Actions > "New Contact"

### Exit points
- Click any contact row → Customer 360
- Click "Import" → Customers > Import sub-section
- Filter returns 0 results → empty state with "New Contact" CTA

### Lifecycle tab design
Sub-navigation uses lifecycle stages as filters, not as separate data sources:

```
All | Leads | Customers | Investors | Inactive
```

Each tab pre-applies a lifecycle filter to the same underlying contact list. This means:
- The "Leads" tab shows everyone with lifecycle = Lead or Qualified
- The "Investors" tab shows everyone with lifecycle = Investor or VIP
- The "Inactive" tab shows everyone with lifecycle = Dormant

This design allows an employee to quickly narrow context without building complex queries manually.

### Contact creation
The "New Contact" button opens a modal or inline form with these **required** fields:
- Phone number (primary identifier, validated)
- Name

And these **optional** fields presented progressively:
- Email
- Source
- Product interest (multi-select)
- Assign to
- Initial pipeline stage (if creating as a lead)
- Tags

On form submission, the contact is created with lifecycle = Lead and the browser navigates to Customer 360 for that contact. The agent immediately sees the full workspace.

### Relationship with Customer 360
Customers is the index. Customer 360 is the record. Every row in Customers is a navigation link to Customer 360 — it does not open an inline drawer or pop-over. The row click navigates to the full workspace.

---

## Module 4 — Sales

### Purpose
Visualise the sales pipeline and move deals forward.

### One-sentence description
*"The place where you see where your deals stand and move them forward."*

### What belongs
- Kanban board: leads organised by pipeline stage, drag-drop to advance
- List view: filterable, sortable table of all leads in the pipeline
- Pipeline health indicators: count per stage, deal value per stage, overdue count per stage
- Bulk operations: select N leads → bulk stage change, bulk assign
- Lead score display: hot / warm / cold per card
- Closure deadline tracking and overdue highlighting
- Follow-ups sub-section: all upcoming and overdue follow-up tasks across the entire pipeline
- Filter controls: by assignee, date range, product interest, tags, lifecycle sub-stage
- Entry point to Customer 360 per lead

### What never belongs
- Individual lead data editing (→ Customer 360 CRM tab)
- Tag management (→ Customer 360 Profile tab)
- Lead creation (→ Customers > New Contact)
- Analytics (→ Analytics > Pipeline)
- Automation configuration (→ Automation)
- Conversation management (→ Communications)
- Employee management (→ Employees)

### Kanban card — what it shows
```
┌────────────────────────────────┐
│  Rajan Singh                   │
│  +91 9179xxxxxxxx              │
│  🔥 Hot · KYC, Demat          │
│  Assigned: Arun                │
│  Due: 2 Jul  ⚠ 1d left        │
│                                │
│              Customer 360 ↗    │
└────────────────────────────────┘
```

The card is a navigation element, not an editing element. Drag-drop changes the stage. Every other action happens in Customer 360.

### Entry points
- Sidebar nav
- Home > Pipeline summary shortcut
- Home > Hot Leads shortcut

### Exit points
- Click card body → Customer 360 for that lead
- Drag card to new stage → stage mutation fires, card moves, stay in Sales
- Click "Follow-ups" sub-nav → Sales > Follow-ups view
- Click "List" sub-nav → Sales > List view

### Relationship with Customer 360
Sales is a management view of Customer 360 records in aggregate. When an admin or manager looks at the pipeline board, they are seeing a summary of Customer 360 data for all leads. Clicking any card opens Customer 360 as the full editing and detail workspace.

The pipeline stage displayed on a card is the same field managed in Customer 360 > CRM tab. Drag-drop on the kanban is the only stage mutation allowed outside Customer 360.

**Justification for kanban drag-drop exception:** Moving a deal from "Contacted" to "Qualified" on the pipeline board is a *pipeline management operation* — a manager reclassifying multiple leads at once. It is fundamentally different from an agent updating a specific lead's stage in the context of understanding that customer's full situation. Both are valid operations. Both update the same field. They are different workflows.

---

## Module 5 — Customer 360

### Purpose
Every piece of information about one specific customer, in one workspace.

### One-sentence description
*"Everything about this one person — their history, your conversation, your next step."*

### What belongs
All mutations for one contact. All history for one contact.

**Profile tab** — Identity and categorisation
- Editable: name, phone, email
- Editable: product interest (multi-select)
- Editable: source
- Editable: tags (the only tag mutation surface)
- Editable: assigned agent (the only assignee mutation surface for contact-level assignment)
- Read-only: created date, lifecycle stage (promotable from here)
- Lifecycle stage promotion: explicit button to advance Unknown → Lead → Customer etc.

**Conversation tab** — WhatsApp (and future channels)
- Full message thread with real-time updates
- Send message, send template, upload media
- Internal notes visible inline (differentiated visually)
- Assignment and chat status (conversation-level)
- ActivityPanel: health score, next best action suggestion

**Timeline tab** — Complete chronological history
- All messages (inbound and outbound), all internal notes, all stage changes, all lifecycle changes, all task completions, all automation events
- Filter by event type
- Read-only: no mutations from Timeline

**CRM tab** — Sales pipeline management for this contact
- Pipeline stage (the canonical mutation surface — the only place outside kanban drag-drop)
- Closure deadline
- Expected deal value
- Win probability (AI-assisted, Phase 3+)
- Follow-up tasks (create, complete, delete)
- Notes on the deal specifically (distinct from internal contact notes)

**Tasks tab** — Follow-up management
- All open tasks and follow-ups for this contact
- Create: date, time, description, reminder type
- Complete: mark done with optional outcome note
- Delete

**Notes tab** — Internal agent notes
- Chronological notes from all agents on this contact
- Create new note (rich text in future)
- Cannot delete notes (audit integrity)

**Documents tab** — Files
- KYC documents uploaded
- WhatsApp media received and sent
- Manually uploaded files
- Download, share link, delete

### What never belongs
- Team analytics (→ Analytics)
- Multi-contact operations (→ Customers or Sales)
- Automation configuration (→ Automation)
- Pipeline aggregate view (→ Sales)
- Other contacts (Customer 360 represents exactly one customer)

### Header — the always-visible identity bar
The Customer 360 header is always visible regardless of which tab is active. It shows:
- Contact avatar + name + phone
- Lifecycle stage badge (clickable → promotes lifecycle)
- Pipeline stage chip (read-only in header — edit in CRM tab)
- Health score
- Customer Journey Bar (milestone progress)
- "Customer 360" workspace pill

### Entry points
- Any row in Customers module
- Any card in Sales > Pipeline
- Any conversation in Communications > Open in Customer 360
- Home > follow-up task, hot lead, conversation link
- Global Search result
- Any notification that references a specific contact
- Direct URL: `/customers/[id]`

### Exit points
- Navbar back button → returns to source module (from=crm, from=customers, from=communications, from=home, from=search)
- Click another contact from the header search (future: breadcrumb navigation between related contacts)

### Relationship with other modules
Customer 360 is the authoritative workspace. All other modules read from the same data but do not write to it. Customer 360 is where every write operation for a single contact originates (with the one exception of kanban drag-drop for pipeline stage).

---

## Module 6 — Employees

### Purpose
Manage the people in the business: who they are, their performance, and their targets.

### One-sentence description
*"The place where you manage your team."*

### What belongs
- Employee list: names, roles, email, assignment stats
- Role assignment and permission management
- Attendance tracking: daily check-in/out log
- Performance targets: KPI goals per employee per period
- Metric entry: bulk and individual daily activity logging
- Verification workflow: manager approves/rejects submitted metrics
- Team hierarchy view (who reports to whom)

### What never belongs
- Customer data (→ Customers / Customer 360)
- Sales pipeline (→ Sales)
- Compensation calculation (future: Employees > Compensation sub-section)
- HR/payroll system (→ external integration)

### Entry points
- Sidebar nav (Manager / Admin / Owner only)
- Analytics > Team view → "View Employee Profile" link
- Home > Team Overview widget (Manager home only)

### Exit points
- Click employee name → Employee detail page (future)
- Click "Verification Queue" → Employees > Verification sub-section
- Click "Attendance" → Employees > Attendance sub-section

### Relationship with Customer 360
Employees are assignees in Customer 360. When a contact's assigned agent is shown in Customer 360 > Profile, clicking the agent name navigates to their Employee profile (Manager/Admin only). Employee performance metrics do not appear in Customer 360.

---

## Module 7 — Analytics

### Purpose
Understand how the business is performing across customers, pipeline, conversations, and team.

### One-sentence description
*"The place where you understand what is working and what is not."*

### What belongs
- Pipeline funnel: conversion rates per stage, velocity, win/loss breakdown
- Lead acquisition by source with conversion rate per source
- Product interest conversion funnel (KYC → Demat → MF → Insurance → PMS)
- Team performance: per-agent call volume, lead creation, conversion, response time
- Conversation metrics: message volume, response time distribution, resolution rate, 24h window expiry rate
- Lifecycle distribution: how many contacts at each lifecycle stage
- Revenue pipeline: total expected deal value by stage
- Trend charts: period-over-period comparisons

### What never belongs
- Any mutations (Analytics is strictly read-only)
- Individual customer data in detail (aggregate only)
- System configuration
- Employee management actions

### Role-filtered access
- Owner: all data, all agents, all time ranges
- Admin: all data, all agents, all time ranges
- Manager: their team only (agents they manage)
- Sales: their own data only (accessible on Home, not in the Analytics module)
- Support: not visible

### Entry points
- Sidebar nav (Manager+ only)
- Home > "View Analytics" CTA (Manager+ only)

### Exit points
- Click a data point (e.g., a stage with high drop-off) → Sales > Pipeline filtered to that stage
- Click an agent's row → Employees > that agent's detail
- Click a source metric → Customers filtered by that source

### Relationship with Customer 360
Analytics aggregates data that originates from Customer 360 records. It does not display individual customer data — it surfaces trends, counts, and rates. Clicking through analytics data navigates to the relevant list (Customers or Sales), not to Customer 360 directly.

---

## Module 8 — Automation

### Purpose
Define what should happen automatically, without an agent taking a manual action.

### One-sentence description
*"The place where you set up rules so the system works for you."*

### What belongs
- Event-triggered workflows: if [trigger] then [action]
- Multi-step message sequences (timed, drip-style)
- Instant auto-replies for specific keyword triggers
- Lifecycle transition automations (e.g., stage = Won → promote to Customer)
- Follow-up reminder automations (e.g., task overdue → notify agent)
- Inactivity alerts (e.g., no contact in 14 days → flag in Communications)

### What never belongs
- Individual customer management (→ Customer 360)
- Campaign broadcasts to a list (→ future Campaigns module)
- Analytics on automation performance (→ Analytics, future)
- Manual tasks (→ Customer 360 > Tasks tab)

### Entry points
- Sidebar nav (Admin / Owner only)

### Exit points
- No exit to customer-facing modules from Automation
- Save automation → stays in Automation
- Click "View triggered contacts" (future) → Customers filtered by automation tag

### Relationship with Customer 360
Automation writes events to Customer 360 Timeline when rules trigger (e.g., "Automation: Welcome message sent"). The Timeline event is read-only. Automation does not directly edit Customer 360 fields — it fires mutations through the same API paths that agents use.

---

## Module 9 — Settings

### Purpose
Configure how APForce behaves for this organization.

### One-sentence description
*"The place where you set up APForce for your business."*

### What belongs
- Organisation identity: name, logo, timezone, locale, industry
- Pipeline stage configuration: add, reorder, rename, color-code, delete stages
- Product interest taxonomy: add, rename, deactivate products
- Tag catalog management: create, merge, archive tags
- Role and permission configuration: custom permission overrides per role
- Lead form builder: embeddable forms that create leads automatically
- WhatsApp integration: number connection, WABA ID, API key
- Template management: approved WhatsApp templates
- Webhook configuration: outbound event webhooks for integrations
- API key management: for external integrations
- Billing: plan, usage, payment method, invoices (Owner only)

### What never belongs
- Customer data
- Employee performance management (→ Employees)
- Analytics (→ Analytics)
- Automation rules (→ Automation — Settings contains configuration, not live rules)

### Entry points
- Sidebar nav (Admin / Owner only)
- Onboarding flow (forced Settings completion on first login)
- Any "Configure" or "Manage" link from other modules

### Exit points
- Save settings → stays in Settings
- No direct navigation to customer-facing modules

### Relationship with Customer 360
Settings defines what Customer 360 can contain. Pipeline stages configured in Settings appear in the CRM tab stage selector. Tags created in Settings appear in the Profile tab tag selector. Product interests configured in Settings appear in the product interest field. Settings is upstream of Customer 360 — it defines the vocabulary.

---

## Feature Ownership Summary

| Action | Owns It | Never In |
|---|---|---|
| Send WhatsApp message | Communications + C360 Conversation | Sales, Customers, Home |
| Read message thread | Communications + C360 Conversation | All others |
| Change pipeline stage | C360 CRM tab (+ Sales kanban drag-drop) | Communications sidebar, Customers rows |
| Assign contact to agent | C360 Profile tab | Sales list inline, Customers rows |
| Assign conversation to agent | Communications sidebar | Customer 360 |
| Manage tags | C360 Profile tab | Communications sidebar, Customers rows, Sales |
| Create internal notes | C360 Notes tab | Communications sidebar, Sales |
| Create follow-up tasks | C360 Tasks tab (+ CRM tab) | Communications, Sales, Home |
| Create new contact | Customers > New Contact button | Communications pane, Sales board |
| Promote lifecycle stage | C360 Profile tab | All others |
| View customer history | C360 Timeline tab | All others (aggregate only in Analytics) |
| Bulk stage changes | Sales > Pipeline (select + bulk action) | Communications, Customers, Home |
| Export contacts | Customers (bulk) | Sales, Analytics, Home |
| Import contacts | Customers > Import | All others |
| Configure pipeline | Settings > Pipeline | Sales, Customers, C360 |
| Create automation | Automation | All others |
| View team performance | Analytics > Team, Home (manager role) | Customer 360 |
| Manage employees | Employees | All others |
