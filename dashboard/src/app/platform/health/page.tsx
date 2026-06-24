'use client';

import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';

interface HealthResponse { status: string; timestamp: string; }

export default function PlatformHealthPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
    refetchInterval: 30_000,
  });

  return (
    <>
      <Navbar title="System Health" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">

          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Lambda API</h2>
            {isLoading ? (
              <div className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            ) : (
              <div className="flex items-center gap-3">
                <span className={`h-3 w-3 rounded-full ${data?.status === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'} animate-pulse`} />
                <span className={`text-sm font-semibold ${data?.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {data?.status === 'ok' ? 'Operational' : 'Degraded'}
                </span>
                <span className="text-xs text-slate-400">
                  Last check: {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '—'}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col items-center gap-3">
              <span className="text-4xl">📡</span>
              <p className="text-sm text-slate-400">
                DynamoDB, CloudWatch metrics, and error rate graphs coming soon.
              </p>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
