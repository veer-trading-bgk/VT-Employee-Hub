'use client';

import { useState, useCallback } from 'react';
import { METRIC_KEYS } from '@/lib/metrics.config';
import type { MetricConfig } from '@/lib/metrics.config';
import { useMetricsConfig } from './useMetricsConfig';

const storageKey = (userId: string) => `apforce_metric_order_${userId}`;

function loadOrder(userId: string): string[] {
  if (typeof window === 'undefined') return [...METRIC_KEYS];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [...METRIC_KEYS];
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) return [...METRIC_KEYS];
    // Keep saved positions for known keys, append any newly added metrics at end
    const known = (saved as string[]).filter((k) => METRIC_KEYS.includes(k));
    const missing = METRIC_KEYS.filter((k) => !known.includes(k));
    return [...known, ...missing];
  } catch {
    return [...METRIC_KEYS];
  }
}

export function useMetricOrder(userId: string) {
  const { metrics } = useMetricsConfig();
  const [order, setOrder] = useState<string[]>(() => loadOrder(userId));

  const isCustomOrder = order.join(',') !== METRIC_KEYS.join(',');

  const sortedMetrics: MetricConfig[] = order
    .map((key) => metrics.find((m) => m.key === key))
    .filter((m): m is MetricConfig => m !== undefined);

  const saveOrder = useCallback(
    (newOrder: string[]) => {
      setOrder(newOrder);
      try {
        localStorage.setItem(storageKey(userId), JSON.stringify(newOrder));
      } catch { /* storage quota exceeded — silently skip */ }
    },
    [userId],
  );

  const resetOrder = useCallback(() => {
    setOrder([...METRIC_KEYS]);
    try {
      localStorage.removeItem(storageKey(userId));
    } catch { /* ignore */ }
  }, [userId]);

  return { order, sortedMetrics, saveOrder, resetOrder, isCustomOrder };
}
