'use client';

import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from './useFetch';
import { useAuth } from '@/context/AuthContext';
import { dailyTarget } from '@/lib/metrics.config';
import { useMetricsConfig } from './useMetricsConfig';
import type { MyMetricsResponse, AllMetricsResponse, TeamSummaryResponse } from '@/types';

export function useMyMetrics(days = 30) {
  const { metrics } = useMetricsConfig();
  const { data, error, loading, refetch } = useFetch<MyMetricsResponse>(
    () => api.myMetrics(days) as Promise<MyMetricsResponse>
  );

  const summary = useMemo(() => {
    if (!data) return [];
    const allDates = data.data ?? {};
    const apiTargets = data.targets ?? {};

    // Generate every calendar date in the range so the trend chart has no gaps.
    // Dates are UTC-based (same as what the backend stores).
    const dateRange: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      dateRange.push(new Date(Date.now() - i * 864e5).toISOString().split('T')[0]);
    }
    const today = dateRange[dateRange.length - 1];

    return metrics.map((metric) => {
      // Gap-filled: every date in range, 0 for days with no entry
      const history = dateRange.map((date) => ({
        date,
        value: allDates[date]?.[metric.key] ?? 0,
      }));

      const value = allDates[today]?.[metric.key] ?? 0;
      // Prefer the backend-returned target (already divided to daily cadence);
      // fall back to frontend config for metrics not yet in the API response.
      const target =
        (apiTargets[metric.key] as number | undefined) ?? dailyTarget(metric);

      return {
        metric,
        value,
        target,
        progress: target > 0 ? Math.min(Math.round((value / target) * 100), 999) : 0,
        history,
      };
    });
  }, [data, days, metrics]);

  return { summary, raw: data, error, loading, refetch };
}

export function useAllMetrics(days = 30, enabled = true) {
  return useFetch<AllMetricsResponse>(
    () => api.allMetrics(days) as Promise<AllMetricsResponse>,
    { enabled }
  );
}

export function useTeamSummary(enabled = true) {
  return useFetch<TeamSummaryResponse>(
    () => api.teamSummary() as Promise<TeamSummaryResponse>,
    { enabled }
  );
}

export function useRoleScopedMetrics() {
  const { user } = useAuth();
  const isAdmin   = user?.role === 'admin';
  const isManager = user?.role === 'manager';

  const my   = useMyMetrics();
  const all  = useAllMetrics(30, isAdmin);
  const team = useTeamSummary(isAdmin || isManager);

  return { my, all, team, isAdmin, isManager };
}
