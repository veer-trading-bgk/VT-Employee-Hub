'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { METRICS, formatMetricValue, getMetricConfig } from '@/lib/metrics.config';
import type { VerificationStatus } from '@/types';

interface PendingMetric {
  PK: string;
  SK: string;
  metricId: string;
  userId: string;
  email: string;
  name: string;
  metric_type: string;
  value: number;
  date: string;
  enteredAt: string;
  enteredFrom: string;
  verificationStatus?: VerificationStatus;
  verified: boolean;
  flagged?: boolean;
  notes?: string;
}

interface PendingResponse {
  data: PendingMetric[];
  total: number;
}

interface VerifyPayload {
  metricId: string;
  approved: boolean;
  notes?: string;
}

const STATUS_BADGE: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-700',
  approved: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700',
  rejected: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-700',
};

const SOURCE_LABEL: Record<string, string> = {
  web:            'Web',
  bulk_web:       'Bulk',
  telegram:       'Telegram',
  web_correction: 'Correction',
};

function NoteModal({
  item,
  action,
  onConfirm,
  onClose,
  isPending,
}: {
  item: PendingMetric;
  action: 'approve' | 'reject';
  onConfirm: (notes: string) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [notes, setNotes] = useState('');
  const cfg = getMetricConfig(item.metric_type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            {action === 'approve' ? '✅ Approve' : '❌ Reject'} Metric
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">{item.name} · {item.date}</p>
            <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
              {cfg?.icon} {cfg?.label ?? item.metric_type}:{' '}
              {cfg ? formatMetricValue(cfg, item.value) : item.value}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Notes <span className="text-slate-400">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={action === 'reject' ? 'Reason for rejection…' : 'Verification notes…'}
              className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
            />
          </div>
        </div>
        <div className="flex gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <button
            onClick={() => onConfirm(notes)}
            disabled={isPending}
            className={`flex-1 rounded px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition ${
              action === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
            }`}
          >
            {isPending ? 'Saving…' : action === 'approve' ? 'Confirm Approve' : 'Confirm Reject'}
          </button>
          <button onClick={onClose} className="rounded border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800 transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VerificationPage() {
  const queryClient = useQueryClient();
  const [filterMetric, setFilterMetric] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [filterFlagged, setFilterFlagged] = useState(false);
  const [modal, setModal] = useState<{ item: PendingMetric; action: 'approve' | 'reject' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ['pending-metrics'],
    queryFn: () => apiFetch<PendingResponse>('/api/metrics/pending'),
    refetchInterval: 30_000,
  });

  const verifyMutation = useMutation({
    mutationFn: (payload: VerifyPayload) =>
      apiFetch('/api/metrics/verify', {
        method: 'POST',
        body: JSON.stringify(payload),
        retries: 0,
      }),
    onSuccess: (_, vars) => {
      toast.success(vars.approved ? 'Metric approved' : 'Metric rejected');
      queryClient.invalidateQueries({ queryKey: ['pending-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['admin-team-summary'] });
      setModal(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkVerifyMutation = useMutation({
    mutationFn: async ({ ids, approved }: { ids: string[]; approved: boolean }) => {
      await Promise.all(
        ids.map((metricId) =>
          apiFetch('/api/metrics/verify', {
            method: 'POST',
            body: JSON.stringify({ metricId, approved }),
            retries: 0,
          })
        )
      );
    },
    onSuccess: (_, { approved, ids }) => {
      toast.success(`${ids.length} metrics ${approved ? 'approved' : 'rejected'}`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['pending-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['admin-team-summary'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = data?.data ?? [];

  const filtered = items.filter((item) => {
    if (filterMetric !== 'all' && item.metric_type !== filterMetric) return false;
    if (filterSource !== 'all' && item.enteredFrom !== filterSource) return false;
    if (filterFlagged && !item.flagged) return false;
    return true;
  });

  const flaggedCount = items.filter((i) => i.flagged).length;
  const allIds = filtered.map((i) => i.metricId || `${i.PK}#${i.SK}`);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  return (
    <>
      <Navbar title="Metric Verification" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl space-y-6 p-6">

          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Metric Verification</h1>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {data?.total ?? 0} pending entries
                {flaggedCount > 0 && (
                  <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                    {flaggedCount} flagged
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['pending-metrics'] })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              🔄 Refresh
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterMetric}
              onChange={(e) => setFilterMetric(e.target.value)}
              className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <option value="all">All Metrics</option>
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>{m.icon} {m.label}</option>
              ))}
            </select>
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <option value="all">All Sources</option>
              <option value="web">Web</option>
              <option value="bulk_web">Bulk</option>
              <option value="telegram">Telegram</option>
              <option value="web_correction">Correction</option>
            </select>
            <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <input
                type="checkbox"
                checked={filterFlagged}
                onChange={(e) => setFilterFlagged(e.target.checked)}
                className="h-3.5 w-3.5 accent-rose-600"
              />
              Flagged only
            </label>
          </div>

          {/* Bulk actions */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-800 dark:bg-indigo-900/20">
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                {selected.size} selected
              </span>
              <button
                onClick={() => bulkVerifyMutation.mutate({ ids: [...selected], approved: true })}
                disabled={bulkVerifyMutation.isPending}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                ✅ Approve all
              </button>
              <button
                onClick={() => bulkVerifyMutation.mutate({ ids: [...selected], approved: false })}
                disabled={bulkVerifyMutation.isPending}
                className="rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                ❌ Reject all
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400"
              >
                Clear selection
              </button>
            </div>
          )}

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20"><Loading /></div>
          ) : error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-900/20">
              <p className="text-sm font-medium text-rose-700 dark:text-rose-300">Failed to load pending metrics</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-20 text-center dark:border-slate-700">
              <span className="text-5xl">✅</span>
              <p className="mt-4 text-base font-semibold text-slate-700 dark:text-slate-300">All caught up!</p>
              <p className="mt-1 text-sm text-slate-400">No pending metric entries to verify.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          className="h-3.5 w-3.5 accent-indigo-600"
                          aria-label="Select all"
                        />
                      </th>
                      {['Employee', 'Metric', 'Value', 'Date', 'Source', 'Entered At', 'Notes', 'Actions'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                    {filtered.map((item) => {
                      const cfg = getMetricConfig(item.metric_type);
                      const itemId = item.metricId || `${item.PK}#${item.SK}`;
                      const isSelected = selected.has(itemId);
                      return (
                        <tr
                          key={itemId}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                            item.flagged ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''
                          }`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(itemId)}
                              className="h-3.5 w-3.5 accent-indigo-600"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900 dark:text-white">
                              {item.name || item.email || item.userId}
                              {item.flagged && (
                                <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                                  ⚠️ Flagged
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-400">{item.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              {cfg?.icon} {cfg?.label ?? item.metric_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 tabular-nums font-semibold text-slate-900 dark:text-white">
                            {cfg ? formatMetricValue(cfg, item.value) : item.value}
                          </td>
                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{item.date}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE.pending}`}>
                              {SOURCE_LABEL[item.enteredFrom] ?? item.enteredFrom}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">
                            {item.enteredAt ? new Date(item.enteredAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                          </td>
                          <td className="max-w-[150px] truncate px-4 py-3 text-xs text-slate-400" title={item.notes}>
                            {item.notes || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => setModal({ item, action: 'approve' })}
                                className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => setModal({ item, action: 'reject' })}
                                className="rounded bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700"
                              >
                                Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  Showing {filtered.length} of {items.length} pending entries
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {modal && (
        <NoteModal
          item={modal.item}
          action={modal.action}
          isPending={verifyMutation.isPending}
          onClose={() => setModal(null)}
          onConfirm={(notes) => {
            const metricId = modal.item.metricId || `${modal.item.userId}#${modal.item.date}#${modal.item.metric_type}`;
            verifyMutation.mutate({ metricId, approved: modal.action === 'approve', notes });
          }}
        />
      )}
    </>
  );
}
