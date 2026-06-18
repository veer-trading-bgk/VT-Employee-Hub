'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useMyMetrics } from '@/hooks/useMetrics';
import { METRICS } from '@/lib/metrics.config';
import { Loading } from '@/components/common/Loading';

interface Insight {
  type: 'ALERT' | 'OPPORTUNITY' | 'RECOMMENDATION';
  title: string;
  description: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface InsightsResponse {
  insights: string;
  generatedAt: string;
  confidence: number;
}

const PRIORITY_STYLES: Record<string, string> = {
  HIGH: 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/20',
  MEDIUM: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20',
  LOW: 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20',
};

const TYPE_ICONS: Record<string, string> = {
  ALERT: '⚠️',
  OPPORTUNITY: '📈',
  RECOMMENDATION: '💡',
};

export function InsightsPanel() {
  const { summary } = useMyMetrics();
  const [enabled, setEnabled] = useState(false);

  const metrics = Object.fromEntries(
    summary.map((s) => [s.metric.key, { actual: s.value, target: s.target }])
  );

  const hasMetrics = summary.some((s) => s.value > 0);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['ai-insights', JSON.stringify(metrics)],
    queryFn: () =>
      apiFetch<InsightsResponse>('/api/ai/insights', {
        method: 'POST',
        body: JSON.stringify({ metrics, period: 'today', userRole: 'employee' }),
        retries: 0,
      }),
    enabled: enabled && hasMetrics,
    staleTime: 1000 * 60 * 30,
    retry: 0,
  });

  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-5 dark:border-indigo-900/50 dark:from-indigo-950/20 dark:to-purple-950/20">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🤖</span>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">AI Insights</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Powered by Claude</p>
          </div>
        </div>
        <button
          onClick={() => {
            if (!enabled) setEnabled(true);
            else refetch();
          }}
          disabled={isFetching}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isFetching ? '⏳ Analyzing…' : enabled && data ? '🔄 Refresh' : '✨ Generate Insights'}
        </button>
      </div>

      {!enabled && (
        <div className="rounded-lg border border-dashed border-indigo-300 p-6 text-center dark:border-indigo-700">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Click <strong>Generate Insights</strong> to get AI-powered analysis of your metrics.
          </p>
          {!hasMetrics && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              ⚠️ Add some metrics first to get meaningful insights.
            </p>
          )}
        </div>
      )}

      {isLoading && enabled && <Loading label="Analyzing your metrics with AI…" size="sm" />}

      {data && !isLoading && (
        <div>
          <div className="rounded-lg border border-indigo-200 bg-white/70 p-4 dark:border-indigo-800/50 dark:bg-slate-900/50">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
              {data.insights}
            </p>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <span>Generated {new Date(data.generatedAt).toLocaleTimeString()}</span>
            <span>Confidence: {Math.round(data.confidence * 100)}% ✅</span>
          </div>
        </div>
      )}

      {enabled && !isLoading && !data && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-400">
          ⚠️ Unable to generate insights. Make sure the backend AI endpoint is configured.
        </div>
      )}
    </div>
  );
}
