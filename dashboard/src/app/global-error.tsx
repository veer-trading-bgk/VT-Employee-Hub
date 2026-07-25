'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Catches errors that escape the root layout itself — ErrorBoundary (in
// layout.tsx) only wraps `{children}`, so a crash in the layout's own tree
// (providers, shell chrome) would otherwise reach neither it nor Sentry.
// This file replaces the entire document when it renders, per Next.js's
// global-error convention, so it must render its own <html>/<body>.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          <p className="text-lg font-semibold">Something went wrong.</p>
          <p className="mt-1 text-sm">Please refresh the page. Our team has been notified.</p>
        </div>
      </body>
    </html>
  );
}
