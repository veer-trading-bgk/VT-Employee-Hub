'use client';

import { useQuery } from '@tanstack/react-query';
import { METRICS, type MetricConfig } from '@/lib/metrics.config';
import { apiFetch } from '@/lib/api';

interface ApiMetricConfig {
  key: string;
  label: string;
  icon: string;
  target: number;
  targetPeriod: 'day' | 'month';
  color: string;
  pointsWeight: number;
  isCurrency: boolean;
  isCustomized: boolean;
}

function toMetricConfig(m: ApiMetricConfig): MetricConfig {
  return {
    key:          m.key,
    label:        m.label,
    icon:         m.icon,
    target:       m.target,
    targetPeriod: m.targetPeriod,
    color:        m.color,
    pointsWeight: m.pointsWeight,
    unit:         m.isCurrency ? 'currency' : 'count',
  };
}

/**
 * Returns live per-company metric config (labels, icons, targets, colors).
 * Falls back to the static build-time METRICS while the API is loading.
 * Uses the same React Query cache key as the Metric Settings page,
 * so the first page to load it populates the cache for all other pages.
 */
export function useMetricsConfig() {
  const { data } = useQuery({
    queryKey: ['metrics-config'],
    queryFn: () =>
      apiFetch<{ success: boolean; config: ApiMetricConfig[] }>('/api/metrics/config'),
    staleTime: 5 * 60 * 1000, // 5-min cache — changes to names apply on next reload
  });

  const metrics: MetricConfig[] = data?.config
    ? data.config.map(toMetricConfig)
    : METRICS;

  const getMetricConfig = (key: string): MetricConfig | undefined =>
    metrics.find((m) => m.key === key);

  return { metrics, getMetricConfig };
}
