# APForce V3 — Product Vision

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## 1. What APForce Is

APForce is a Business Operating System for Indian financial advisors — authorised persons (APs), sub-brokers, and SEBI-registered investment advisors — who manage customer relationships, WhatsApp communications, and sales pipelines as a single daily workflow.

It is not a CRM with a chat widget.  
It is not a WhatsApp inbox with a contacts list.  
It is not an HR tool with analytics layered on.

It is the single workspace where every advisor manages their customers, every employee manages their conversations, and every manager manages their team — without switching tools.

**Positioning statement:**
> APForce gives Indian financial advisory businesses the same operational clarity that HubSpot gives SaaS companies — built around WhatsApp, KYC workflows, and the relationship-first culture of Indian financial services.

---

## 2. Target Users

### Primary: The Financial Advisor (Sales Role)

An authorised person or sub-broker who:
- Manages 50–500 active customer relationships
- Uses WhatsApp as their primary communication channel
- Follows a KYC → Demat → Product onboarding sequence
- Works from a mobile phone for 40–60% of the day
- Has 10–15 years of financial services experience but limited enterprise software exposure
- Measures success by: KYC completions, demat openings, SIP activations, customer retention

**Design contract:** This user must become productive within 15 minutes of first login. Every screen must be self-explanatory. No training documentation should be required for daily work.

### Secondary: The Team Manager

A senior advisor or branch manager who:
- Oversees 5–20 financial advisors
- Reviews team performance daily
- Assigns leads, monitors pipeline health, unblocks stuck deals
- Needs cross-team conversation visibility
- Reports aggregate metrics to the principal

**Design contract:** This user needs management and assignment tools without touching individual customer records directly. Analytics and team views are their primary surfaces.

### Tertiary: The Support Agent

Handles inbound WhatsApp conversations — customer queries, document requests, account status. Does not manage pipeline. Needs conversation management without sales context noise.

**Design contract:** This user lives in Communications. Everything else is either read-only context or hidden entirely.

### Administrative: The Owner / Principal

The business owner who configures the workspace, reviews company-wide performance, and makes strategic decisions. Rarely does day-to-day customer management.

**Design contract:** Settings and Analytics are this user's primary surfaces. The product stays out of their way until they need it.

### Out of Scope (V3)

- End customers / investors (no self-service portal)
- SEBI compliance automation (reserved for future)
- Multi-company management (single workspace per organisation)

---

## 3. Design Philosophy

### Action First, Reports Last

The opening screen answers: *What should I do in the next 30 minutes?*  
Not: *How did the team perform last month?*

Every screen prioritises action over information. Data is shown in service of decisions, not as decoration. On My Work, urgent replies appear before KPI charts. On Sales, the pipeline appears before conversion stats.

### Zero Navigation Tax

An employee should be able to reply to a customer, update their stage, add a follow-up, and move to the next customer — without leaving the Communications screen.

Every common action is reachable in one or two interactions from the current screen. Navigation is a deliberate context switch, not a requirement for completing a task.

### One Surface Per Customer

Every person in APForce has one canonical workspace: their Customer 360. It opens from every context that references that person — a conversation, a kanban card, a search result, a notification. It is never navigated to directly from a sidebar item, because customers are not a "module" — they are the centre of the product.

### Consistency Over Cleverness

APForce uses established enterprise SaaS patterns (Linear, HubSpot, Notion, Slack). Familiarity is a feature. Novel interactions are introduced only where WhatsApp-native workflows have no enterprise precedent. When in doubt, use the conventional pattern.

### Fast by Default

Every interaction has an immediate visual response under 100ms. No loading spinners on page navigation — only skeletons. Optimistic updates everywhere appropriate. The application never shows a blank screen.

### Mobile Is Real Work

The mobile layout is a first-class experience designed for advisors who manage their entire day from a phone. Every daily action available on desktop is available on mobile with no feature degradation. The mobile experience is designed independently — not derived from desktop.

### Role Clarity Over Feature Richness

An employee does not see a disabled "Export All Contacts" button. They do not see a greyed-out "Automation" sidebar item. If they cannot access it, it does not render. The UI is always complete for the current user's role.

---

## 4. Product Principles

**P1 — One customer, one workspace, one source of truth**  
Every person is a Contact. Their sales stage, conversations, notes, tasks, and documents all live in one Customer 360. There is no separate "lead" record and "customer" record for the same person.

**P2 — Never make the user navigate to complete a common action**  
If an action is performed more than once a day, it must be available inline. Navigation is for intentional context switches, not task completion.

**P3 — Roles determine what you see, not just what you can do**  
Role-filtered items are absent from the UI — not disabled, not locked, not greyed. The product is always complete for the role logged in.

**P4 — Every number is a link**  
No metric is decorative. Every stat in Analytics is tappable and leads to the filtered list that produced it.

**P5 — Errors are recoverable, never catastrophic**  
All deletes are soft by default. All failed network actions surface a Retry button. The product never shows a blank screen. Optimistic updates revert cleanly on failure.

**P6 — WhatsApp is infrastructure, not a feature**  
WhatsApp messaging is as fundamental to APForce as email is to Gmail. The channel architecture is built to accommodate email, Instagram, and SMS — but WhatsApp is the primary medium the entire product is designed around.

**P7 — The product grows with the business**  
A team of 2 and a team of 50 should both feel like APForce was built for them. Complexity surfaces progressively. A 2-person team does not encounter automation builders or team management on day one.

**P8 — Enterprise quality means predictability**  
Buttons do what their labels say. Destructive actions confirm before executing. Bulk actions show exactly what will happen before committing. The system communicates its state at all times.

**P9 — Never lose context**  
Every action in APForce preserves the user's working context. Replying to a message, assigning a lead, changing a stage, adding a note, or creating a follow-up must never transport the user to a different screen. Customer 360 is a workspace, not a navigation destination — opening it and pressing Back returns the user to exactly the previous position, scroll state, and filter. The user should never need to mentally remember where they came from.

---

## 5. UX Rules

These rules govern specific interaction decisions throughout the product. When two design options conflict, apply the relevant rule.

**Rule 1 — One canonical detail page per entity**  
Every important object has exactly one detail workspace. Customer → Customer 360. Employee → Employee Profile (Universal Drawer from Settings > Employees). Broadcast → Broadcast Detail (stats panel). Automation → Automation Detail (workflow builder). Never create a second detail view for the same entity type.

**Rule 2 — One way to create or edit**  
All create and edit actions open in the Universal Right Drawer. No random modals, no dedicated edit pages, no mixed patterns. One mechanism, everywhere, always.

**Rule 3 — Every page answers exactly one question**

| Screen | The question it answers |
|---|---|
| My Work | "What should I do right now?" |
| Communications | "Who is waiting for me?" |
| Customers | "Who are my customers?" |
| Sales | "Which deals will close?" |
| Analytics | "What happened?" |
| Automation | "What runs automatically?" |
| Settings | "How do I configure the system?" |

If a page attempts to answer more than one question, simplify it.

**Rule 4 — Every click must reduce work**  
No click exists to reveal another click. The path to any action is direct. Bad: Customer → Open → Edit → Assign (three clicks to assign). Good: Customer row → Assign (one click via context menu or inline action).

**Rule 5 — Progressive disclosure**  
Show 80% of what users need by default. Hide the remaining 20% behind secondary actions (⋮ menu, expanding section, keyboard shortcut). Never surface all options simultaneously — it overwhelms new users and slows down experienced ones.

**Rule 6 — Speed before beauty**  
Animations clarify transitions; they do not add visual richness. If an animation makes a task take longer, remove it. No transition should delay the user from seeing the result of their action by more than 200ms. `prefers-reduced-motion` is not a fallback — it is a legitimate preference that must be honoured first-class.

**Rule 7 — Everything is searchable**  
Customers, employees, templates, automations, broadcasts, notes, follow-ups, and tags must all be reachable through search. The Command Palette is the universal entry point. No object in the system should require navigation to find.

**Rule 8 — Zero dead ends**  
Every empty state explains three things: why it is empty, what to do next, and provides a primary action button. "No data." is never acceptable. "No follow-ups today. [Add follow-up]" is the minimum standard.

**Rule 9 — One source of truth**  
Every editable piece of customer information has exactly one editor. Stage is edited in one place; all other views read from that source. Owner, tags, phone, and all contact fields follow the same rule. Never duplicate editable state across multiple modules.

**Rule 10 — Enterprise simplicity**  
When choosing between more powerful and more understandable, choose more understandable. APForce's target users have deep domain expertise (Indian financial services) but limited enterprise software exposure. Complexity must be earnable through use — not required on day one.

---

## 6. UX Goals

| Goal | Measure |
|---|---|
| New employee productive | Sends first reply and creates first follow-up within 15 minutes of login |
| Zero required training | Core daily workflow completed without documentation |
| Daily engagement | Employee opens APForce before opening WhatsApp |
| Manager insight speed | Team performance readable in under 60 seconds |
| Mobile parity | All daily tasks completable on mobile |
| Interaction response | Every tap/click has visual response in under 100ms |
| Page load time (P95) | Under 2 seconds on a 4G connection |

---

## 7. Enterprise Principles

### Accessibility

WCAG 2.1 AA compliance. Every interactive element has a keyboard equivalent. Focus states are always visible. Screen readers receive meaningful ARIA labels. Colour is never the sole signal — always paired with shape or text. Reduced motion is respected.

### Security and Privacy

Role-based UI: unauthorised data is not rendered, not merely disabled. All destructive actions are logged in the Audit Log. Sensitive fields (access tokens, phone numbers in URLs) are never exposed in browser history or local storage.

### Performance at Scale

Designed to perform with 10 million contacts and 100 million messages. Lists are always paginated. Virtual scrolling for long message threads. Shared React Query caches eliminate duplicate network requests. Optimistic updates prevent perceived slowness.

### Developer Experience

The design specification is the implementation contract. No design decisions are made during coding. Components are built once and reused exactly — there is one Table, one Drawer, one Toast, one EmptyState. The design system is the first deliverable; it makes every subsequent screen faster to build and cheaper to maintain.

### Observability

Every mutation that changes a customer record is auditable. The Audit Log in Settings captures who did what, when, and to which record. Automation execution is logged with success/failure status per run.

---

## 8. What APForce V3 Is Not

- **Not a generic CRM.** Salesforce and HubSpot exist. APForce is purpose-built for the Indian AP/sub-broker market with WhatsApp, KYC workflows, and financial product lifecycles.
- **Not a WhatsApp chatbot platform.** APForce is a relationship operating system. WhatsApp is one channel.
- **Not a compliance platform.** APForce supports audit trails but does not replace SEBI regulatory reporting tools.
- **Not an investment platform.** APForce manages the relationship and the pipeline. It does not execute trades or hold customer assets.

---

## 9. Version History

| Version | Summary |
|---|---|
| V1 | WhatsApp inbox + basic lead tracking |
| V2 | Customer 360 workspace, CRM pipeline, Contact Hub, Employees module |
| V3 | Unified Business OS: 7-module sidebar, locked schema, universal drawer, notification center, shared Customers/Sales design language, role-aware navigation, design system |

---

## 10. Success Statement

An advisor opens APForce at 9am. They see their urgent replies and today's follow-ups. They reply to three customers without switching screens. They move one customer to "KYC Done." They create a follow-up for another. They check the pipeline and close the app.

They did not navigate to five different screens.  
They did not wonder where a feature was.  
They did not wait for a page to load.  
They did not read a tooltip.

That is APForce V3.
