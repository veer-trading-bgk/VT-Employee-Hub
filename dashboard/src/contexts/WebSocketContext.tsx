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
import { wsClient, type WsMessage, type WsConnectionState } from '@/lib/wsClient';
import { api, setMemoryToken } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface WsContextValue {
  connected: boolean;                    // backward-compatible shorthand
  wsState: WsConnectionState;            // granular connection state
  lastConnectedAt: number | null;        // timestamp of last successful connection
}

const WsContext = createContext<WsContextValue>({
  connected: false,
  wsState: 'idle',
  lastConnectedAt: null,
});

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
  const [wsState, setWsState] = useState<WsConnectionState>('idle');
  const [lastConnectedAt, setLastConnectedAt] = useState<number | null>(null);

  // ── Lifecycle: connect when logged in, disconnect on logout ────────────────
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_WS_URL ?? 'wss://j3zbw8ex9h.execute-api.ap-south-1.amazonaws.com/prod';
    if (!url || !user) {
      wsClient.setRefreshFn(null);
      wsClient.disconnect();
      setConnected(false);
      return;
    }
    wsClient.setRefreshFn(async () => {
      // Use the refresh endpoint (refresh token cookie) — not /me which requires
      // a valid access token and would always fail when the access token is expired.
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('refresh failed');
      const data = await res.json() as { token?: string };
      if (!data.token) throw new Error('no token in refresh response');
      setMemoryToken(data.token);
    });
    wsClient.connect(url);
    return () => {
      wsClient.setRefreshFn(null);
      wsClient.disconnect();
      setConnected(false);
    };
  }, [user]);

  // ── Idle-session recovery: reconnect WS immediately on tab-visible ─────────
  // After a long idle, the backoff timer can be up to 30 s. Calling reconnect()
  // cancels the timer, resets backoff to 1 s, and opens the socket immediately.
  // Only wires up when the user is logged in (same guard as the connect effect).
  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') wsClient.reconnect();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user]);

  // ── Stale-cache recovery: invalidate inbox whenever WS (re)connects ────────
  // Catches any messages that arrived while the socket was down. The $open event
  // fires both on the initial connect and on every subsequent reconnect.
  useEffect(() => {
    const onOpen = () => {
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
    };
    wsClient.on('$open', onOpen);
    return () => wsClient.off('$open', onOpen);
  }, [qc]);

  // ── Track connection state via $open / $close / $state synthetic events ───
  useEffect(() => {
    const onOpen  = () => setConnected(true);
    const onClose = () => setConnected(false);
    const onState = (msg: WsMessage) => {
      const s = msg.state as WsConnectionState;
      const ts = msg.lastConnectedAt as number | null;
      setWsState(s);
      if (ts !== null) setLastConnectedAt(ts);
    };
    wsClient.on('$open',  onOpen);
    wsClient.on('$close', onClose);
    wsClient.on('$state', onState);
    return () => {
      wsClient.off('$open',  onOpen);
      wsClient.off('$close', onClose);
      wsClient.off('$state', onState);
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
    <WsContext.Provider value={{ connected, wsState, lastConnectedAt }}>
      {children}
    </WsContext.Provider>
  );
}

export function useWsContext(): WsContextValue {
  return useContext(WsContext);
}
