'use client';

import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useFetch } from './useFetch';
import { useAuth } from '@/context/AuthContext';
import { METRICS, dailyTarget } from '@/lib/metrics.config';
import type { MyMetricsResponse, AllMetricsResponse, TeamSummaryResponse } from '@/types';

/** Today's value + target/progress for every configured metric, for the current user. */
export function useMyMetrics(days = 30) {
  const { data, error, loading, refetch } = useFetch<MyMetricsResponse>(() => api.myMetrics(days) as Promise<MyMetricsResponse>);

  const today = new Date().toISOString().split('T')[0];

  const summary = useMemo(() => {
    if (!data) return [];
    const allDates = data.data ?? {};
    return METRICS.map((metric) => {
      const history = Object.entries(allDates)
        .filter(([, dayData]) => dayData[metric.key] !== undefined)
        .map(([date, dayData]) => ({ date, value: dayData[metric.key] ?? 0 }));
      const value = allDates[today]?.[metric.key] ?? 0;
      const target = dailyTarget(metric);
      return {
        metric,
        value,
        target,
        progress: target > 0 ? Math.min(Math.round((value / target) * 100), 999) : 0,
        history,
      };
    });
  }, [data, today]);

  return { summary, raw: data, error, loading, refetch };
}

/** Admin-only: all metric records across employees. */
export function useAllMetrics(days = 30, enabled = true) {
  return useFetch<AllMetricsResponse>(() => api.allMetrics(days) as Promise<AllMetricsResponse>, { enabled });
}

/** Manager/Admin: today's team summary with per-metric progress %. */
export function useTeamSummary(enabled = true) {
  return useFetch<TeamSummaryResponse>(() => api.teamSummary() as Promise<TeamSummaryResponse>, { enabled });
}

export function useRoleScopedMetrics() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isManager = user?.role === 'manager';

  const my = useMyMetrics();
  const all = useAllMetrics(30, isAdmin);
  const team = useTeamSummary(isAdmin || isManager);

  return { my, all, team, isAdmin, isManager };
}
