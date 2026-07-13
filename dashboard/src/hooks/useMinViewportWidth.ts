'use client';

import { useSyncExternalStore } from 'react';

// M2-D: Automation canvas mobile guard. A CSS-only (two sibling divs,
// md:hidden / hidden md:block) gate would still MOUNT the hidden branch —
// ReactFlow's canvas setup (nodes, edges, viewport listeners) is expensive
// enough that mounting it off-screen on a phone is a real cost, not just a
// visual no-op. useSyncExternalStore is the React-recommended way to read
// external (window) state during render without a useEffect+setState
// flash-then-correct cycle — the same rationale this repo already uses
// elsewhere for avoiding that pattern (see canvas/[id]/page.tsx's
// key={automation.id} remount note).
//
// getServerSnapshot defaults to `false` (below the breakpoint) — SSR/initial
// hydration has no real viewport to check, and defaulting to "not wide
// enough" means the canvas never even briefly mounts on a phone waiting for
// hydration to correct it. A desktop user instead pays a one-frame
// synchronous re-check immediately after hydration (React re-invokes
// getSnapshot() right after commit and re-renders before paint if it
// differs), not a visible flash.
export function useMinViewportWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;

  function subscribe(onStoreChange: () => void) {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onStoreChange);
    return () => mql.removeEventListener('change', onStoreChange);
  }

  function getSnapshot() {
    return window.matchMedia(query).matches;
  }

  function getServerSnapshot() {
    return false;
  }

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
