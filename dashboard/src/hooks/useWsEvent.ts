'use client';

import { useEffect } from 'react';
import { wsClient, type WsMessage } from '@/lib/wsClient';

/**
 * Subscribe to a specific WebSocket event type for the lifetime of the
 * calling component. Handler is stable-ref-safe: pass a useCallback-wrapped
 * function or an inline function — the hook re-subscribes automatically when
 * it changes.
 *
 * @param event  Event name to listen for (e.g. 'whatsapp_message').
 *               Pass '*' to receive every event including $open / $close.
 * @param handler Called with the full parsed message object.
 */
export function useWsEvent(
  event: string,
  handler: (msg: WsMessage) => void,
): void {
  useEffect(() => {
    wsClient.on(event, handler);
    return () => wsClient.off(event, handler);
  }, [event, handler]);
}
