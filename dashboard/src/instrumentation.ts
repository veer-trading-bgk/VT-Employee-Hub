// Server-side Sentry init — the Next.js 15+/16 instrumentation.ts convention
// (register() + onRequestError), which replaces the older sentry.server.config.ts
// / sentry.edge.config.ts pair. Runs once per server instance, before it
// handles requests. See node_modules/next/dist/docs/.../instrumentation.md.
import * as Sentry from '@sentry/nextjs';
import { deepScrubSecrets } from '@/lib/sentryScrub';

// See instrumentation-client.ts / dashboard/src/lib/sentryScrub.ts for the
// full rationale. Pure-JS (no Node-specific APIs), so it works unmodified
// in both the nodejs and edge runtimes below.
function beforeBreadcrumb(breadcrumb: Sentry.Breadcrumb) {
  try { return deepScrubSecrets(breadcrumb) as typeof breadcrumb; } catch { return null; }
}
function beforeSend(event: Sentry.ErrorEvent) {
  try { return deepScrubSecrets(event) as typeof event; } catch { return null; }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      beforeBreadcrumb,
      beforeSend,
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      beforeBreadcrumb,
      beforeSend,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
