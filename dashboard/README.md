# VT Employee Metrics Dashboard

Next.js (App Router, TypeScript, Tailwind CSS) dashboard for the VT Employee Bot backend.

## Stack
- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 (class-based dark mode)
- Recharts for all charts (bar, line, gauge)
- Cookie-based JWT auth against the existing Express backend (`../server.js`)

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

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the Express backend | `http://localhost:3000` |
| `NEXT_PUBLIC_REFRESH_INTERVAL_MS` | Auto-refresh polling interval for widgets | `30000` |
| `NEXT_PUBLIC_SESSION_TIMEOUT_MS` | Idle time before auto-logout | `900000` (15 min) |

## Adding a new metric

Everything is config-driven from a single file: [`src/lib/metrics.config.ts`](src/lib/metrics.config.ts).
Add one entry to the `METRICS` array (key must match the `metric_type` the backend stores) and it
automatically appears in summary cards, the daily progress bar chart, the trend chart selector,
the leaderboard sort dropdown, and CSV exports. No other code changes required.

## Project structure

```
src/
  app/             # routes: /login /dashboard /leaderboard /analytics /profile /settings
  components/
    charts/         # ProgressBarChart, TrendLineChart, GaugeChart (Recharts)
    layout/          # AppShell, Sidebar, ProtectedRoute
    ui/                # MetricCard, Leaderboard, DataTable, Skeleton, ErrorBoundary, ErrorMessage, DateRangeFilter
  context/         # AuthContext (session/JWT), ThemeContext (dark/light)
  hooks/             # useFetch (polling + retry), useMetrics (role-scoped data)
  lib/                # api.ts (fetch client w/ retry), metrics.config.ts, csv.ts
  types/             # shared TS interfaces matching backend response shapes
```

## Role-based views

- **admin**: dashboard/profile/analytics (own data) + leaderboard (all employees) + `/api/metrics/all`
- **manager**: same as admin minus the all-employees raw feed; leaderboard shows team summary
- **telecaller**: dashboard/profile/analytics for their own metrics only; leaderboard is hidden

`ProtectedRoute` (used by `AppShell`) redirects unauthenticated users to `/login` and
redirects users without an allowed role away from restricted pages (e.g. `/leaderboard`).

## Known gaps / follow-ups

- The backend's `/login` route supports an optional TOTP 2FA step (`requiresTOTP`); this UI
  does not yet have a 2FA entry screen - it assumes 2FA is not enabled for the logging-in user.
- "Remember login state" relies on the backend's `refreshToken` cookie (30-day) but there is no
  automatic refresh-token exchange wired up yet; once the 1h `accessToken` expires, the user is
  prompted to log in again rather than being silently refreshed.
- CSV export and date-range filtering operate on the currently loaded page of data (up to 90 days
  via `/api/metrics/my`), not a server-side paginated export.

## Deployment (Vercel)

1. Push this `dashboard/` folder as (or to) its own Vercel project root.
2. Set `NEXT_PUBLIC_API_URL` to your deployed backend's HTTPS URL in Vercel's project env vars.
3. Set the backend's `FRONTEND_URL` to your Vercel deployment URL, and ensure cookies use
   `Secure` (already conditional on `NODE_ENV=production` in the backend).
