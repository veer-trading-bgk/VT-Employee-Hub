// Client-side Sentry init — the Next.js 15.3+/16 replacement for the older
// sentry.client.config.ts convention (this file runs before hydration; see
// node_modules/next/dist/docs/.../instrumentation-client.md).
import * as Sentry from '@sentry/nextjs';
import { deepScrubSecrets } from '@/lib/sentryScrub';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Mirrors src/handler.js's backend hooks (VT-Employee-Hub repo root) —
  // see dashboard/src/lib/sentryScrub.ts for the full rationale (the
  // session JWT is embedded directly in the WebSocket URL in wsClient.ts).
  // Wrapped in try/catch for the same reason as the backend: Sentry's own
  // addBreadcrumb() has no try/catch around calling beforeBreadcrumb, so an
  // uncaught throw here would break Sentry capture entirely, which is
  // worse than the leak this exists to close.
  beforeBreadcrumb(breadcrumb) {
    try { return deepScrubSecrets(breadcrumb) as typeof breadcrumb; } catch { return null; }
  },
  beforeSend(event) {
    try { return deepScrubSecrets(event) as typeof event; } catch { return null; }
  },
});

// Required by the SDK to attach navigation breadcrumbs (what page the user
// was on right before an error) to captured events.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
