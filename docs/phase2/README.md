# APForce Phase 2 — Customer 360

## Status

| Item | Status |
|---|---|
| Frontend Architecture Audit | Complete |
| Customer 360 Specification | Approved |
| Documentation | Complete |
| Implementation | Not started |

## What is Phase 2

Phase 1 delivered a production-grade backend: unified Contact Hub, Conversation Engine, Timeline, Events, Services, WebSocket push, feature flags, and EMF metrics.

Phase 2 rebuilds the frontend to match the backend's architecture. The central principle is that the **Contact** is the canonical customer entity in APForce. Every customer-facing screen must eventually connect to a single Customer 360 page.

## Documents in This Directory

| Document | Purpose |
|---|---|
| [CUSTOMER_360_ARCHITECTURE.md](CUSTOMER_360_ARCHITECTURE.md) | Product vision, layout, header, tabs, wireframes |
| [UI_COMPONENT_ARCHITECTURE.md](UI_COMPONENT_ARCHITECTURE.md) | Every React component, props, state, reuse plan |
| [NAVIGATION_ARCHITECTURE.md](NAVIGATION_ARCHITECTURE.md) | How every page reaches Customer 360 |
| [API_MAPPING.md](API_MAPPING.md) | Tab-by-tab API mapping, React Query keys, cache strategy |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Per-commit scope, files, validation, rollback, risks |
| [ROLLOUT_PLAN.md](ROLLOUT_PLAN.md) | 13-commit rollout sequence, each independently deployable |
| [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) | Architectural decision records (ADRs) |
| [FUTURE_EXTENSIONS.md](FUTURE_EXTENSIONS.md) | Reserved architecture for future features |

## Core Principle

> The Contact is the center of APForce. Everything related to a customer must be accessible from one canonical page. There must never again be multiple customer detail pages.

## Key URLs

| Screen | Route |
|---|---|
| Contact Hub (directory) | `/admin/contacts` |
| **Customer 360 (hub)** | **`/admin/contacts/[id]`** |
| WhatsApp Inbox (queue) | `/admin/whatsapp` |
| CRM Pipeline (stage view) | `/admin/crm` |

## What Changes in Phase 2

- `/admin/contacts/[id]` is created — the Customer 360 page
- `/admin/crm/[id]` redirects to `/admin/contacts/[id]?tab=crm`
- Contact Hub row click navigates to Customer 360 (was: opens WhatsApp)
- Inbox gets a "View Contact" bridge button to Customer 360
- CRM Pipeline card click opens Customer 360 (was: CRM Lead Detail)
- Duplicate chat view in CRM Lead Detail is retired

## What Does NOT Change in Phase 2

- WhatsApp Inbox remains its own screen (operational queue)
- CRM Pipeline remains its own screen (stage kanban)
- Contact Hub list remains its own screen (directory)
- Navigation structure: Inbox, Contact Hub, CRM Pipeline stay as separate entries
- All existing APIs — Phase 2 is frontend-only

## Implementation Rule

Each of the 13 commits in the rollout plan is independently deployable with no breaking changes to existing flows. No commit removes a working page until its replacement is verified working.
