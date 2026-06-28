'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface UseRealTimeOptions {
  /** Query keys to invalidate on each tick */
  queryKeys: string[][];
  /** Polling interval in ms — default 30 000 */
  intervalMs?: number;
  /** Whether polling is active */
  enabled?: boolean;
}

export interface RealTimeState {
  isLive: boolean;
  lastUpdated: Date | null;
  nextRefreshIn: number;  // seconds
  refresh: () => void;
  pause: () => void;
  resume: () => void;
}

export function useRealTime({
  queryKeys,
  intervalMs = 300_000,
  enabled = true,
}: UseRealTimeOptions): RealTimeState {
  const queryClient = useQueryClient();
  const [isLive, setIsLive] = useState(enabled);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [nextRefreshIn, setNextRefreshIn] = useState(Math.floor(intervalMs / 1000));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const invalidateAll = useCallback(() => {
    queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
    setLastUpdated(new Date());
    setNextRefreshIn(Math.floor(intervalMs / 1000));
  }, [queryClient, queryKeys, intervalMs]);

  const startPolling = useCallback(() => {
    // Main interval
    intervalRef.current = setInterval(invalidateAll, intervalMs);
    // Countdown ticker
    countdownRef.current = setInterval(() => {
      setNextRefreshIn((v) => (v <= 1 ? Math.floor(intervalMs / 1000) : v - 1));
    }, 1000);
    setIsLive(true);
  }, [invalidateAll, intervalMs]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setIsLive(false);
  }, []);

  const refresh = useCallback(() => {
    invalidateAll();
  }, [invalidateAll]);

  const pause = useCallback(() => {
    stopPolling();
  }, [stopPolling]);

  const resume = useCallback(() => {
    startPolling();
  }, [startPolling]);

  useEffect(() => {
    if (!enabled) return;
    setLastUpdated(new Date());
    startPolling();
    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { isLive, lastUpdated, nextRefreshIn, refresh, pause, resume };
}
