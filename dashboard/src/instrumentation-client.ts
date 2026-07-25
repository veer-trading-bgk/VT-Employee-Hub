// Client-side Sentry init — the Next.js 15.3+/16 replacement for the older
// sentry.client.config.ts convention (this file runs before hydration; see
// node_modules/next/dist/docs/.../instrumentation-client.md).
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

// Required by the SDK to attach navigation breadcrumbs (what page the user
// was on right before an error) to captured events.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
