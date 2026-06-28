'use client';

import { useWsContext } from '@/contexts/WebSocketContext';

/**
 * Returns the current WebSocket connection state.
 * The connection itself is managed by WebSocketProvider in the root layout.
 */
export function useWebSocket(): { connected: boolean } {
  return useWsContext();
}
