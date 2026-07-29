'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    // Offline caching/push support is a production-only concern. In
    // development it only adds a stale-cache failure mode -- every
    // Playwright spec in this repo already has to explicitly block the
    // service worker (serviceWorkers: 'block') to get reliable runs, and
    // public/sw.js's own cache-version comment ("bumped -- forces all
    // browsers to purge apforce-v1") documents a prior stale-cache
    // incident. A dev build isn't meant to work offline, so registering it
    // locally buys nothing while risking exactly this class of confusing,
    // hard-to-reproduce failure.
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() => { /* sw registration is best-effort */ });
    }
  }, []);

  return null;
}
