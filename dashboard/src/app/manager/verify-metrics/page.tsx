'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { EmptyState } from '@/components/common/EmptyState';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface PendingEntry {
  metricId: string;
  userId: string;
  name?: string;
  email?: string;
  metric_type: string;
  value: number;
  date: string;
  notes?: string;
  enteredAt: string;
  flagged?: boolean;
}

interface PendingResponse {
  data: PendingEntry[];
  total: number;
}

export default function VerifyMetricsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [verifyNotes, setVerifyNotes] = useState<Record<string, string>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editNotes, setEditNotes] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pending-metrics'],
    queryFn: () => apiFetch<PendingResponse>('/api/metrics/pending'),
    refetchInterval: 30_000,
  });

  const { mutate: verify, isPending: isVerifying } = useMutation({
    mutationFn: ({ metricId, approved, note }: { metricId: string; approved: boolean; note: string }) =>
      apiFetch('/api/metrics/verify', {
        method: 'POST',
        body: JSON.stringify({ metricId, approved, notes: note }),
      }),
    onSuccess: (_data, { approved }) => {
      toast.success(approved ? '✅ Metric approved' : '❌ Metric rejected');
      qc.invalidateQueries({ queryKey: ['pending-metrics'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: editMetric, isPending: isEditing } = useMutation({
    mutationFn: ({ userId, date, metricType, value, notes }: {
      userId: string; date: string; metricType: string; value: number; notes: string;
    }) =>
      apiFetch(`/api/admin/metrics/${userId}/${date}/${metricType}`, {
        method: 'PUT',
        body: JSON.stringify({ value, notes }),
      }),
    onSuccess: (_data, vars) => {
      toast.success('✏️ Entry updated and auto-approved');
      setEditingId(null);
      setEditValues((prev) => { const n = { ...prev }; delete n[vars.userId + vars.date + vars.metricType]; return n; });
      qc.invalidateQueries({ queryKey: ['pending-metrics'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const pending = data?.data ?? [];
  const total = data?.total ?? 0;
  const flagged = pending.filter((e) => e.flagged);

  const entryKey = (e: PendingEntry) => e.userId + e.date + e.metric_type;

  return (
    <>
      <Navbar title="Verify Metrics" showBack />
      <div className="space-y-6 p-4 md:p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Metrics Approval</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {total} pending · {flagged.length} flagged
            </p>
          </div>
        </div>

        {flagged.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
              ⚠️ {flagged.length} entries were auto-flagged as anomalies — unusually high values. Review carefully.
            </p>
          </div>
        )}

        {isLoading ? (
          <Loading />
        ) : pending.length === 0 ? (
          <EmptyState icon="✅" title="All caught up!" description="No pending metrics to review." />
        ) : (
          <div className="space-y-3">
            {pending.map((entry) => {
              const key = entryKey(entry);
              const isEditingThis = editingId === key;
              const displayName = entry.name || entry.email || entry.userId.slice(0, 12);

              return (
                <div
                  key={entry.metricId}
                  className={`rounded-xl border bg-white p-5 dark:bg-slate-900 ${
                    entry.flagged
                      ? 'border-amber-300 dark:border-amber-800'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Employee name / identifier */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {displayName}
                        </span>
                        {entry.email && entry.name && (
                          <span className="text-xs text-slate-400">{entry.email}</span>
                        )}
                        {entry.flagged && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                            ⚠️ Flagged
                          </span>
                        )}
                      </div>

                      {/* Metric details */}
                      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
                        <span className="font-medium uppercase text-indigo-600 dark:text-indigo-400">
                          {entry.metric_type}
                        </span>

                        {/* Value — editable if admin and in edit mode */}
                        {isEditingThis ? (
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500">Value:</span>
                            <input
                              type="number"
                              min="0"
                              autoFocus
                              value={editValues[key] ?? String(entry.value)}
                              onChange={(e) => setEditValues((prev) => ({ ...prev, [key]: e.target.value }))}
                              className="w-24 rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-white"
                            />
                            <input
                              type="text"
                              placeholder="Admin note (optional)"
                              value={editNotes[key] ?? ''}
                              onChange={(e) => setEditNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                          </div>
                        ) : (
                          <span>
                            Value:{' '}
                            <strong className="text-slate-900 dark:text-white">{entry.value}</strong>
                          </span>
                        )}

                        <span>Date: {entry.date}</span>
                        {entry.notes && <span className="text-slate-500">&quot;{entry.notes}&quot;</span>}
                      </div>
                    </div>

                    {/* Approval controls */}
                    <div className="flex w-full flex-col gap-2 sm:w-60 sm:flex-shrink-0">
                      {isEditingThis ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const v = parseFloat(editValues[key] ?? String(entry.value));
                              if (isNaN(v) || v < 0) { toast.error('Enter a valid value'); return; }
                              editMetric({
                                userId: entry.userId,
                                date: entry.date,
                                metricType: entry.metric_type,
                                value: v,
                                notes: editNotes[key] ?? '',
                              });
                            }}
                            disabled={isEditing}
                            className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
                          >
                            {isEditing ? '⏳' : '💾 Save & Approve'}
                          </button>
                          <button
                            onClick={() => { setEditingId(null); }}
                            disabled={isEditing}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <textarea
                            rows={2}
                            placeholder="Verification notes (optional)…"
                            value={verifyNotes[entry.metricId] ?? ''}
                            onChange={(e) => setVerifyNotes((n) => ({ ...n, [entry.metricId]: e.target.value }))}
                            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => verify({ metricId: entry.metricId, approved: true, note: verifyNotes[entry.metricId] ?? '' })}
                              disabled={isVerifying}
                              className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              ✅ Approve
                            </button>
                            <button
                              onClick={() => verify({ metricId: entry.metricId, approved: false, note: verifyNotes[entry.metricId] ?? '' })}
                              disabled={isVerifying}
                              className="flex-1 rounded-lg bg-rose-600 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-60"
                            >
                              ❌ Reject
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => {
                                  setEditingId(key);
                                  setEditValues((prev) => ({ ...prev, [key]: String(entry.value) }));
                                }}
                                title="Edit value"
                                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-indigo-950/30"
                              >
                                ✏️
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
