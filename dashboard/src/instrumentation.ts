// Server-side Sentry init — the Next.js 15+/16 instrumentation.ts convention
// (register() + onRequestError), which replaces the older sentry.server.config.ts
// / sentry.edge.config.ts pair. Runs once per server instance, before it
// handles requests. See node_modules/next/dist/docs/.../instrumentation.md.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
