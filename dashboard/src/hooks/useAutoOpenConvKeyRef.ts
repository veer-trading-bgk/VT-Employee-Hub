import { useRef, useEffect } from 'react';

/**
 * Shared guard for the Templates module's Send-button deep-link
 * (/inbox?template={id}). Snapshots which conversation a pending auto-open
 * was intended for, once, at mount — never re-snapshots on later prop
 * changes, since autoOpenTemplateId is a one-time signal from the parent
 * that never flips from null to non-null after mount. Callers compare the
 * returned convKeyRef's .current against the live conversation key before
 * firing the actual send, so a conversation switched away from mid-flight is
 * correctly treated as "not the one this was for."
 *
 * hasFiredRef is a second, independent guard: the send is only ever supposed
 * to fire once per deep-link, but the thing that stops the effect from
 * re-running — the parent clearing its pendingSendTemplateId prop — is an
 * async round trip through a different component. If a React Query-sourced
 * effect dependency (e.g. the template list) changes reference before that
 * cleared prop propagates back down, convKeyRef.current alone would still
 * match and the effect would re-send. Callers must set hasFiredRef.current
 * = true synchronously, before calling the send, so even a same-tick
 * re-entrant call can't slip through.
 */
export function useAutoOpenConvKeyRef(autoOpenTemplateId: string | null | undefined, convKey: string) {
  const convKeyRef = useRef<string | null>(null);
  const hasFiredRef = useRef(false);
  useEffect(() => {
    if (autoOpenTemplateId) convKeyRef.current = convKey;
    // Runs once, at mount, by design — see this hook's own doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { convKeyRef, hasFiredRef };
}
