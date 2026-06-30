# APForce V3 — Changelog

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## Purpose

This document records every material change from APForce V2 to V3, why it was made, what the expected UX improvement is, and any migration action required.

---

## Data Model Changes (Phase 2 — already shipped)

### CONTACT# replaces LEAD# and INBOX#

**What changed:** A single `CONTACT#<ulid>` entity now represents every person. The old `LEAD#<id>` and `INBOX#<phone>` partitions are removed.

**Why:** LEAD# and INBOX# were two representations of the same person. Employees had to reconcile "this lead" with "this WhatsApp contact" manually. Stage history and conversation history lived in different tables with no join. This caused: duplicate contacts, inconsistent owner assignments, and conversations being orphaned after lead deletion.

**UX improvement:** Any action taken anywhere in the system (message sent, stage changed, note added) is recorded on the single contact. Customer 360 can be reached from Communications. There is no "which table is this in?" ambiguity.

**Migration:** One-shot migration script run once before Phase 3 UI begins. No dual-write period. All LEAD# and INBOX# records are converted to CONTACT# and CONV# entities. Migration is reversible (LEAD# and INBOX# tables are not dropped until the migration is confirmed correct).

---

### CONV# replaces per-contact conversation records

**What changed:** Conversations are now `CONV#<ulid>` entities with `MSG#<timestamp>` sub-records. Each CONV belongs to a CONTACT.

**Why:** The previous model stored messages as attributes on the contact record (limited to DynamoDB item size) and made conversation history queries expensive.

**UX improvement:** All conversation history is always available. Pagination of message history is efficient. Multiple simultaneous conversations with one contact are correctly separated.

---

### FOLLOWUP# gets a FollowupByContact GSI

**What changed:** Added `GSI3: pk=CONTACT#<id>, sk=FOLLOWUP#<date>` alongside the existing date-keyed index.

**Why:** Previously, follow-ups could not be queried by contact ID in O(1). Customer 360's Follow-ups tab required a scan.

**UX improvement:** Customer 360 > Follow-ups tab loads instantly. All follow-ups for a contact are reachable without full-table operations.

---

### PHONE# lock entity added

**What changed:** A `PHONE#<e164>` entity is written atomically when a new contact is created. DynamoDB TransactWrite ensures no two contacts share a phone number.

**Why:** Duplicate contacts caused split histories and double-assignment confusion.

**UX improvement:** Creating a contact with a phone number that already exists shows "Contact already exists. [Open contact]" — no silent duplicate creation.

---

### WAMID# entity added (TTL 7 days)

**What changed:** Each WhatsApp message ID from Meta is stored as `WAMID#<wamid>` for 7 days.

**Why:** Meta sends delivery and read status webhooks keyed by message ID. Without a lookup table, it was not possible to update the correct message with its delivery status.

**UX improvement:** Message delivery ticks (sent → delivered → read) update correctly in the conversation thread.

---

## Navigation Changes

### Customer 360 removed from sidebar

**V2:** Customer 360 was a sidebar item.  
**V3:** Customer 360 is a workspace opened by clicking any customer from any module.

**Why:** A workspace that requires a specific contact cannot meaningfully exist as a navigation destination. See `02_INFORMATION_ARCHITECTURE.md` Section 5 for the full rationale.

**UX improvement:** The sidebar is always complete and relevant. No "Select a customer first" empty state. Customer 360 is always one click away from any customer-facing context.

**Migration for employees:** No training required. The natural action (clicking a customer's name or row) still opens their workspace. The sidebar entry disappears — nothing replaces it because nothing needs to.

---

### Employees moved from sidebar to Settings > Organisation

**V2:** Employees was a top-level sidebar item (visible to Managers and Admins).  
**V3:** Employees is under Settings > Organisation.

**Why:** Employee management (invite, deactivate, assign roles) is an infrequent administrative action. It was given equal visual weight to modules used dozens of times per day.

**UX improvement:** Primary sidebar shrinks from 8 to 7 items. All remaining items are daily-use operational tools. Sidebar is immediately scannable.

**Migration for admins:** First time an admin tries to access Employees, they will find it in Settings > Organisation. No functional capability is lost — just relocated.

---

### Module renamed: Inbox → Communications

**V2:** "Inbox" (implied email vocabulary, channel-specific name).  
**V3:** "Communications" (channel-agnostic, accommodates WhatsApp + future Email/Instagram/SMS).

**Why:** "Inbox" hardcodes the channel concept. "Communications" is the job to be done, not the implementation.

**UX improvement:** Naming clarity for employees who may not think of WhatsApp as an "inbox". Future channels are accommodated without renaming the module.

---

### Module renamed: CRM / Contact Hub → Customers

**V2:** Various names across versions ("Leads", "Contact Hub", "CRM").  
**V3:** "Customers".

**Why:** "CRM" is a software category name. "Customers" is the business word for who these people are.

**UX improvement:** No ambiguity about purpose. Every employee understands "Customers" on day one.

---

### Module renamed: Pipeline → Sales

**V2:** "Pipeline" (described only the Kanban view).  
**V3:** "Sales" (the job to be done, not the view).

**Why:** "Pipeline" assumes the user knows there is a Kanban view. "Sales" communicates purpose.

---

## UX Pattern Changes

### Universal Right Drawer replaces all modals

**V2:** Various centered modals for create, edit, and assign actions.  
**V3:** Single 420px right-side drawer for all creation, editing, and assignment actions. No centered modals.

**Why:** Centered modals block the content the user is working with. A right drawer keeps context visible. One component pattern is easier to maintain and produces a more consistent experience.

**UX improvement:** Users can reference the list or table behind the drawer while filling a form. The pattern is consistent — muscle memory transfers across all modules.

---

### Optimistic UI for all common mutations

**V2:** Most mutations waited for server confirmation before updating the UI.  
**V3:** All common mutations are applied to the UI immediately; server confirmation happens in the background.

**Why:** Modern SaaS products feel instant. Waiting 300–800ms for a stage change or assignment to update makes the product feel slow.

**UX improvement:** Kanban drag, assign, resolve, stage change, tag add — all update in ≤16ms from user action. Rollback is automatic and animated on server failure.

---

### Skeleton loading states replace all spinners

**V2:** Sections showed spinners while loading.  
**V3:** Sections show skeleton placeholders that match the final layout.

**Why:** Spinners provide no spatial context. Skeletons prepare the user's eye for the incoming content and eliminate layout shift.

**UX improvement:** No layout shift when data arrives. The page always looks structured, even during load. Loading feels faster because the user can see the shape of the result immediately.

---

### Inline editing replaces edit modals in Customer 360

**V2:** Editing contact fields opened a modal with a form.  
**V3:** Every field in Customer 360 is inline editable. Click the field, edit, blur to save.

**Why:** Modal for a field edit is disproportionate. It hides the contact's other information while editing a single value.

**UX improvement:** Zero-friction updates. Edit name, phone, stage, tags, notes without leaving the page or closing a window.

---

### Customer Snapshot Panel replaces navigation for common Communications actions

**V2:** To change a lead's stage from the inbox, the employee had to navigate to the CRM.  
**V3:** The Snapshot Panel in Communications allows stage, owner, tag, note, and task changes without leaving the conversation.

**Why:** Requiring navigation breaks flow. Employees mid-conversation should not lose the conversation thread to update a field.

**UX improvement:** Stage changes, notes, and tasks are added without navigating away. The conversation stays visible.

---

### In-product Notification Center replaces browser notifications

**V2:** Browser push notification prompts (most users deny these).  
**V3:** Notification Center as a panel in the product, server-side, persistent across sessions and devices.

**Why:** Browser push notifications require permission grants that most users decline. In-product notifications are always available and visible from any device.

**UX improvement:** Employees never miss a notification. Notifications persist until dismissed — no "I missed it while the tab was in the background" problem.

---

### My Work replaces generic Dashboard

**V2:** Dashboard showed KPI charts as the first screen.  
**V3:** My Work is action-first. Urgent replies and overdue follow-ups appear above KPI charts.

**Why:** A dashboard answers "how am I doing?" A sales employee opening the app at 9am needs "what do I do right now?" Charts are a management tool, not an operational tool.

**UX improvement:** Employees see their most urgent tasks immediately on login. KPIs are still visible below — for context, not as the primary interface.

---

### Floating Action Button (FAB) available on all screens

**V2:** "New contact" buttons were module-specific (only available in the Contacts list).  
**V3:** FAB provides global access to create contact, create lead, add follow-up, add note, and start broadcast from any screen.

**Why:** Employees often need to create a contact or log a follow-up while working in a different part of the product.

**UX improvement:** Zero navigation required to start common creation tasks. `/` keyboard shortcut makes it accessible without mouse.

---

### Command Palette (Cmd+K) for instant navigation and search

**V2:** Global navigation required clicking the sidebar. No quick-jump.  
**V3:** Command Palette provides instant access to any module, any recent contact, and any global action.

**Why:** Power users navigate faster via keyboard. A command palette is now a standard pattern in enterprise SaaS (Linear, Notion, Figma, Vercel).

**UX improvement:** Navigate to any module with 2–3 keystrokes. Find a customer by name without navigating to the Customers module.

---

## Accessibility Changes

**V2:** No explicit accessibility specification.  
**V3:** WCAG 2.1 AA compliance as a hard requirement for all components, documented in `04_DESIGN_SYSTEM.md` and `05_COMPONENT_LIBRARY.md`.

Specific changes:
- All interactive elements have visible focus rings
- All form fields have associated labels
- All images and icons have alt text or `aria-label`
- All dynamic regions (toasts, modals, drawer) use `aria-live` regions
- Skip-to-content link on every page
- Minimum 44px touch targets on mobile
- `prefers-reduced-motion` respected

---

## Performance Changes

| Metric | V2 | V3 Target |
|---|---|---|
| First Contentful Paint | ~3.5s | < 1.2s |
| Module navigation (warm) | ~500ms | < 100ms |
| Command Palette open | n/a | < 50ms |
| Message send latency (perceived) | ~300ms (waited for server) | ~0ms (optimistic) |

V3 performance improvements come from:
- Optimistic UI eliminating perceived server latency
- React Query caching eliminating redundant fetches
- Skeleton states eliminating layout shift
- Code-splitting per module (only load what is needed)
- Prefetching Customer 360 data on hover

---

## Deprecated Patterns (do not recreate in V3)

| Pattern | Reason deprecated |
|---|---|
| Centered modals | Right drawer is the V3 pattern |
| Full-page spinners | Skeletons are the V3 pattern |
| "Edit" modals for contact fields | Inline editing is the V3 pattern |
| `/admin/` route prefix | Routes are not prefixed; access is enforced by auth guard |
| Greyed-out / disabled nav items for non-permitted roles | Items are not rendered, not disabled |
| Browser push notification prompts | In-product notification center is the V3 pattern |
| Dashboard-first home screen | My Work (action-first) is the V3 pattern |
| phoneNorm field | E.164 phone field is the canonical format; phoneNorm is deprecated |
| LEAD# and INBOX# DynamoDB partitions | CONTACT# is the single canonical entity |

---

## Version History

| Version | Date | Author | Summary |
|---|---|---|---|
| 3.0 | June 2025 | Product / Design | Complete V3 specification — 11-document suite |
| 2.x | April 2025 | Product | Phase 2: CONTACT# data model, Employee Inbox |
| 1.x | February 2025 | Product | Phase 1: WhatsApp connection, Lead CRM |
