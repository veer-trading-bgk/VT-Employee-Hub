'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { wsClient, type WsMessage } from '@/lib/wsClient';
import { useAuth } from '@/context/AuthContext';

interface WsContextValue {
  connected: boolean;
}

const WsContext = createContext<WsContextValue>({ connected: false });

// Map WS event names → React Query keys to invalidate on each push.
// Keep keys aligned with queryKey arrays used in each page's useQuery() calls.
const EVENT_QUERY_MAP: Record<string, string[][]> = {
  metric_added:      [['admin-team-summary'], ['my-metrics'], ['admin-leaderboard-monthly']],
  metric_verified:   [['admin-team-summary'], ['my-metrics'], ['pending-metrics']],
  lead_created:      [['crm-leads'], ['dashboard-crm']],
  lead_updated:      [['crm-leads'], ['dashboard-crm']],
  whatsapp_message:  [['wa-inbox'], ['dashboard-wa']],
  attendance_marked: [['attendance']],
};

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  // ── Lifecycle: connect when logged in, disconnect on logout ────────────────
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_WS_URL ?? 'wss://j3zbw8ex9h.execute-api.ap-south-1.amazonaws.com/prod';
    if (!url || !user) {
      wsClient.disconnect();
      setConnected(false);
      return;
    }
    wsClient.connect(url);
    return () => {
      wsClient.disconnect();
      setConnected(false);
    };
  }, [user]);

  // ── Track connection state via $open / $close synthetic events ─────────────
  useEffect(() => {
    const onOpen  = () => setConnected(true);
    const onClose = () => setConnected(false);
    wsClient.on('$open',  onOpen);
    wsClient.on('$close', onClose);
    return () => {
      wsClient.off('$open',  onOpen);
      wsClient.off('$close', onClose);
    };
  }, []);

  // ── Query invalidation on push events ─────────────────────────────────────
  const handleMessage = useCallback(
    (msg: WsMessage) => {
      const keys = EVENT_QUERY_MAP[msg.event];
      if (!keys) return;
      keys.forEach((qk) => qc.invalidateQueries({ queryKey: qk }));
    },
    [qc],
  );

  useEffect(() => {
    wsClient.on('*', handleMessage);
    return () => wsClient.off('*', handleMessage);
  }, [handleMessage]);

  return (
    <WsContext.Provider value={{ connected }}>
      {children}
    </WsContext.Provider>
  );
}

export function useWsContext(): WsContextValue {
  return useContext(WsContext);
}
