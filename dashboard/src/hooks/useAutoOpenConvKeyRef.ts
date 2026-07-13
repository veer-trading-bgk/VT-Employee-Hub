import { useRef, useEffect } from 'react';

/**
 * Shared guard for the Templates module's Send-button deep-link
 * (/inbox?template={id}). Snapshots which conversation a pending auto-open
 * was intended for, once, at mount — never re-snapshots on later prop
 * changes, since autoOpenTemplateId is a one-time signal from the parent
 * that never flips from null to non-null after mount. Callers compare the
 * returned ref's .current against the live conversation key before firing
 * the actual send, so a conversation switched away from mid-flight is
 * correctly treated as "not the one this was for."
 */
export function useAutoOpenConvKeyRef(autoOpenTemplateId: string | null | undefined, convKey: string) {
  const ref = useRef<string | null>(null);
  useEffect(() => {
    if (autoOpenTemplateId) ref.current = convKey;
    // Runs once, at mount, by design — see this hook's own doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}
