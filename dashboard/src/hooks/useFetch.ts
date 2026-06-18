'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const REFRESH_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_REFRESH_INTERVAL_MS ?? 30000);

interface UseFetchOptions {
  /** Poll on this interval (ms). Pass 0 to disable auto-refresh. */
  refreshIntervalMs?: number;
  enabled?: boolean;
}

interface UseFetchResult<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  refetch: () => void;
}

/** Generic polling data-fetch hook used by every widget that talks to the API. */
export function useFetch<T>(fetcher: () => Promise<T>, options: UseFetchOptions = {}): UseFetchResult<T> {
  const { refreshIntervalMs = REFRESH_INTERVAL_MS, enabled = true } = options;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Intentional: this is the data-fetching effect itself (load() sets loading/data/error
    // internally); polling requires triggering it here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    if (refreshIntervalMs > 0) {
      const id = setInterval(load, refreshIntervalMs);
      return () => clearInterval(id);
    }
  }, [enabled, refreshIntervalMs, load]);

  return { data, error, loading, refetch: load };
}
