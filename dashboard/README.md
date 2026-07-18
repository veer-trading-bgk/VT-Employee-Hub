# APForce Dashboard

Next.js (App Router, TypeScript, Tailwind CSS) dashboard for APForce — a SaaS platform for AP/sub-broker management.

**Current version:** v2.1.0-phase2

---

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 (class-based dark mode)
- Recharts for charts (bar, line, gauge)
- TanStack Query (React Query v5) for all server state
- Cookie-based JWT auth against the Express backend (`../server.js`)

---

## Setup

```bash
cd dashboard
npm install
cp .env.example .env.local   # adjust NEXT_PUBLIC_API_URL if the backend isn't on localhost:3000
npm run dev                  # runs on http://localhost:3001
```

The backend (`F:\aws\vt-employee-bot\server.js`) must be running on the URL configured in
`NEXT_PUBLIC_API_URL` (default `http://localhost:3000`), and its `FRONTEND_URL` env var must
match this app's origin (`http://localhost:3001` by default) for CORS + cookies to work.

```bash
npm run build   # production build
npm start        # serve the production build on :3001
```

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the Express backend | `http://localhost:3000` |
| `NEXT_PUBLIC_REFRESH_INTERVAL_MS` | Auto-refresh polling interval for widgets | `30000` |
| `NEXT_PUBLIC_SESSION_TIMEOUT_MS` | Idle time before auto-logout | `900000` (15 min) |

---

## Module Overview

### Customer 360 (Phase 2)

The canonical customer workspace. Every contact opens in `/admin/contacts/[id]`.

**7-tab architecture (frozen):**

| Tab | Purpose |
|---|---|
| Profile | Identity, editable fields, source tracking, tags, analytics |
| Conversation | WhatsApp send/receive with media and reply support |
| Timeline | Unified chronological feed of all messages, notes, and events |
| CRM | Stage, deal value, closure deadline, assignment, follow-ups, tags |
| Tasks | Follow-up management: create, complete, delete with undo |
| Notes | Internal agent notes (not visible to customer) |
| Documents | Phase 3 placeholder |

**Global Search:** Cmd+K / Ctrl+K opens a command palette. Search by name or phone.

**Back navigation:** Every Customer 360 link carries `?from=hub|inbox|crm|search` so the back button always shows the right label.

**Architecture docs:** [`docs/phase2/CUSTOMER_360_ARCHITECTURE.md`](docs/phase2/CUSTOMER_360_ARCHITECTURE.md)

---

### CRM Pipeline

`/admin/crm` — Kanban and list view of all leads across pipeline stages.

- Stage drag-and-drop
- Bulk assignment
- Follow-up tracking
- CSV export
- Import from spreadsheet

---

### WhatsApp Inbox

`/admin/whatsapp` — Real-time WhatsApp conversation management.

- WebSocket-powered message delivery
- Conversation list with tab filters (all, unassigned, mine)
- Lead sidebar with tag management and contact linking
- "CRM ↗" shortcut opens Customer 360 CRM tab

---

### Performance Metrics Dashboard

`/admin/dashboard` — Agent and team performance metrics.

Config-driven from [`src/lib/metrics.config.ts`](src/lib/metrics.config.ts). Add one entry to the `METRICS` array (key must match the `metric_type` the backend stores) and it automatically appears in summary cards, charts, leaderboard, and CSV exports.

---

## Project Structure

```
src/
  app/admin/
    contacts/          # Contact Hub (/contacts) + Customer 360 (/contacts/[id])
    crm/               # CRM Pipeline + sub-pages (analytics, followups, import…)
    whatsapp/          # WhatsApp Inbox
    dashboard/         # Performance metrics dashboard
    employees/         # Employee management (admin only)
    …

  components/
    contacts/          # Customer 360 components
      tabs/            # ProfileTab, ConversationTab, TimelineTab, CrmTab, TasksTab, NotesTab
      ActivityPanel    # Right sidebar (status, priority, next task, tags, quick actions)
      ContactHeader    # Contact identity block at top of page
      ContactTabNav    # Tab navigation bar
    layout/            # Navbar (with GlobalSearch), Sidebar, CrmSubNav
    whatsapp/          # MediaPreviewModal, TemplatePicker (both used by Customer 360's ConversationTab)
    ui/                # ErrorBoundary, Skeleton, UndoToast, FollowUpForm
    common/            # Shared components

  contexts/
    Customer360Context # Single provider for all Customer 360 data
    WebSocketContext   # Real-time connection management
    # InboxContext was deleted — (v3)/inbox/page.tsx owns its own local state
    # (useState + React Query) directly, no separate context layer.

  context/ (singular — different folder from contexts/ above)
    AuthContext        # Session and JWT
    ThemeContext       # Dark / light mode

  hooks/
    useContactMutations  # Contact field updates, CRM mutations
    useMetrics           # Role-scoped performance metrics
    useRealTime          # Polling with visibility awareness
    useWebSocket         # WebSocket connection hook

  lib/
    contacts/types.ts    # ContactDetail, TabId, CONTACT_TABS, Followup types
    api.ts               # Fetch client with retry and auth
    metrics.config.ts    # Metric definitions (config-driven dashboard)
```

---

## Role-Based Access

| Role | Access |
|---|---|
| `superadmin` | Full access to all modules |
| `admin` | CRM, Contacts, WhatsApp, own metrics |
| `manager` | Team metrics, CRM, Contacts, WhatsApp |
| `telecaller` | Own metrics, WhatsApp, Contacts |

`ProtectedRoute` (via `AppShell`) redirects unauthenticated users to `/login`.

---

## Engineering Rules

See [`CLAUDE.md`](CLAUDE.md) for permanent engineering rules including:
- Customer 360 Boundary Rule
- Frozen Tab Architecture
- Commit Discipline Rules
- Architecture Principles

See [`docs/phase2/`](docs/phase2/) for Phase 2 architecture decisions.

---

## Known Limitations

- **2FA login screen** — Backend supports TOTP; frontend assumes 2FA is disabled.
- **Refresh token auto-renewal** — After the 1-hour access token expires, user is redirected to `/login` rather than silently renewed.
- **Documents tab** — Phase 3 placeholder; shows "Coming Soon".
- **AI Health Score** — Shows "— / 100, AI not enabled"; Phase 3 integration point.

---

## Deployment (Vercel)

1. Push the `dashboard/` folder as (or to) its own Vercel project root.
2. Set `NEXT_PUBLIC_API_URL` to your deployed backend's HTTPS URL in Vercel's project env vars.
3. Set the backend's `FRONTEND_URL` to your Vercel deployment URL, and ensure cookies use
   `Secure` (already conditional on `NODE_ENV=production` in the backend).

---

## Release History

| Version | Description |
|---|---|
| v2.1.0-phase2 | Customer 360, Global Search, CRM migration, Tasks, Navigation |
| v2.0.x | CRM Foundation, WhatsApp WebSocket, production hardening |
| v1.x | Performance metrics dashboard, basic CRM, attendance |
