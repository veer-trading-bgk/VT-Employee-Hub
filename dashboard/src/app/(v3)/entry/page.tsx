'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PenLine, Users, RefreshCw, ChevronDown } from 'lucide-react';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { Avatar } from '@/components/v3/ui/Avatar';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import { formatMetricValue, dailyTarget } from '@/lib/metrics.config';
import type { MyMetricsResponse, VerificationStatus } from '@/types';
import { toast } from 'sonner';

const TODAY     = new Date().toISOString().split('T')[0];
const YESTERDAY = new Date(Date.now() - 864e5).toISOString().split('T')[0];

// ── Status badge helper ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: VerificationStatus | undefined }) {
  if (!status || status === 'pending') return null;
  return (
    <Badge variant={status === 'approved' ? 'success' : 'error'} className="text-[10px]">
      {status === 'approved' ? '✓ Approved' : '✗ Rejected'}
    </Badge>
  );
}

// ── Metric entry card ──────────────────────────────────────────────────────────

interface MetricEntryCardProps {
  metricKey: string;
  label: string;
  icon: string;
  color: string;
  todayValue: number;
  yesterdayValue: number;
  target: number;
  status: VerificationStatus | undefined;
  inputValue: string;
  correctionValue: string | null;
  onInput: (v: string) => void;
  onCorrect: (v: string) => void;
  onSaveCorrection: () => void;
  onCancelCorrection: () => void;
  onStartCorrection: () => void;
  disabled: boolean;
}

function MetricEntryCard({
  metricKey, label, icon, color, todayValue, yesterdayValue,
  target, status, inputValue, correctionValue,
  onInput, onCorrect, onSaveCorrection, onCancelCorrection, onStartCorrection,
  disabled,
}: MetricEntryCardProps) {
  const isLocked     = status === 'approved' || status === 'rejected';
  const pct          = target > 0 ? Math.min(Math.round((todayValue / target) * 100), 100) : 0;
  const inCorrection = correctionValue !== null;

  return (
    <div className={cn(
      'relative flex flex-col gap-2 rounded-xl border bg-white p-3 transition dark:bg-neutral-900',
      isLocked ? 'border-neutral-200 dark:border-neutral-800' : 'border-neutral-200 hover:border-primary-300 dark:border-neutral-800 dark:hover:border-primary-700',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-base leading-none">{icon}</span>
          <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 truncate max-w-[100px]" title={label}>
            {label}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Today's value + progress */}
      <div>
        <p className="text-xl font-bold" style={{ color }}>
          {todayValue > 0 ? todayValue.toLocaleString('en-IN') : <span className="text-neutral-300 dark:text-neutral-600">—</span>}
        </p>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        <p className="mt-0.5 text-[10px] text-neutral-400">{pct}% · target {target.toLocaleString('en-IN')}
          {yesterdayValue > 0 && <span className="ml-1">· yday {yesterdayValue.toLocaleString('en-IN')}</span>}
        </p>
      </div>

      {/* Input: locked correction flow vs normal add flow */}
      {inCorrection ? (
        <div className="space-y-1.5">
          <input
            type="number"
            min="0"
            value={correctionValue ?? ''}
            onChange={(e) => onCorrect(e.target.value)}
            placeholder={isLocked ? 'Additional value…' : 'New total…'}
            disabled={disabled}
            autoFocus
            className="w-full rounded-lg border border-primary-300 bg-primary-50 px-2.5 py-1.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-primary-700 dark:bg-primary-900/20 dark:text-neutral-100"
          />
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" className="flex-1 text-xs" onClick={onSaveCorrection} loading={disabled}>
              Save
            </Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={onCancelCorrection}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {!isLocked && (
            <input
              type="number"
              min="0"
              value={inputValue}
              onChange={(e) => onInput(e.target.value)}
              placeholder="Add…"
              disabled={disabled}
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-sm text-neutral-900 placeholder-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
            />
          )}
          <button
            onClick={onStartCorrection}
            disabled={disabled}
            className="shrink-0 rounded-lg border border-neutral-200 px-2 py-1.5 text-[10px] font-medium text-neutral-500 hover:border-primary-400 hover:text-primary-600 transition dark:border-neutral-700 dark:hover:border-primary-700"
            title={isLocked ? 'Submit correction' : 'Correct value'}
          >
            {isLocked ? 'Correct' : 'Fix'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Performer picker (admin/manager bulk entry) ────────────────────────────────

interface Performer { id: string; name: string; email: string; role?: string; }

function PerformerPicker({
  selected, onSelect,
}: {
  selected: Performer | null;
  onSelect: (p: Performer | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data } = useQuery({
    queryKey: ['entry-performers'],
    queryFn: () => apiFetch<{ success: boolean; data: Performer[] }>('/api/metrics/performers'),
    staleTime: 5 * 60_000,
  });

  const performers = (data?.data ?? []).filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q);
  });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-left hover:border-primary-400 transition dark:border-neutral-700 dark:bg-neutral-900"
      >
        {selected ? (
          <>
            <Avatar name={selected.name} size={24} />
            <span className="flex-1 font-medium text-neutral-900 dark:text-neutral-100 truncate">{selected.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(null); }}
              aria-label="Clear selected employee"
              className="text-xs text-neutral-400 hover:text-neutral-700"
            >✕</button>
          </>
        ) : (
          <>
            <Users className="h-4 w-4 text-neutral-400" />
            <span className="flex-1 text-neutral-400">Select employee for bulk entry…</span>
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="border-b border-neutral-100 p-2 dark:border-neutral-800">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto divide-y divide-neutral-50 dark:divide-neutral-800">
            {performers.length === 0 ? (
              <li className="py-6 text-center text-xs text-neutral-400">No employees found</li>
            ) : performers.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => { onSelect(p); setOpen(false); setSearch(''); }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <Avatar name={p.name} size={24} />
                  <div className="min-w-0 text-left">
                    <p className="font-medium text-neutral-900 dark:text-neutral-100 truncate">{p.name}</p>
                    <p className="text-[10px] text-neutral-400 truncate">{p.email}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EntryPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { metrics } = useMetricsConfig();

  // Raw role, not v3Role (DL-021, docs/v3/12_DECISION_LOG.md: display buckets
  // must never be used for permission gating, only raw roles). Mirrors
  // metrics.js's resolveTargetUserId() CAN_ACT_FOR_OTHERS set exactly — the
  // real backend gate for acting on another employee's metrics — plus the
  // same superadmin bypass convention used everywhere else in this codebase.
  const rawRole = user?.role;
  const CAN_ACT_FOR_OTHERS = new Set(['admin', 'manager', 'team_lead']);
  const canBulk = rawRole === 'superadmin' || (!!rawRole && CAN_ACT_FOR_OTHERS.has(rawRole));

  const [tab, setTab] = useState<'my' | 'team'>('my');
  const [selectedPerformer, setSelectedPerformer] = useState<Performer | null>(null);

  // Per-metric input/correction state
  const [values, setValues]           = useState<Record<string, string>>({});
  const [corrections, setCorrections] = useState<Record<string, string | null>>({});

  // Whose data are we showing? My own, or a selected performer?
  const targetUserId = tab === 'team' && selectedPerformer ? selectedPerformer.id : null;

  const metricsQuery = useQuery({
    queryKey: ['entry-metrics', targetUserId ?? 'me'],
    queryFn: () => {
      const url = targetUserId
        ? `/api/metrics/my?userId=${targetUserId}&days=2`
        : '/api/metrics/my?days=2';
      return apiFetch<MyMetricsResponse>(url);
    },
    staleTime: 60_000,
  });

  const todayData     = metricsQuery.data?.data?.[TODAY]      ?? {};
  const yesterdayData = metricsQuery.data?.data?.[YESTERDAY]  ?? {};
  const apiTargets    = metricsQuery.data?.targets             ?? {};
  const todayStatus   = metricsQuery.data?.statuses?.[TODAY]  ?? {};

  // ── Save new values ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      const toSave = metrics.filter((m) => parseInt(values[m.key] ?? '0') > 0);
      if (toSave.length === 0) throw new Error('Enter at least one value');
      await Promise.all(
        toSave.map((m) =>
          apiFetch('/api/metrics/add', {
            method: 'POST',
            body: JSON.stringify({
              metric_type: m.key,
              value: parseInt(values[m.key]),
              date: TODAY,
              ...(targetUserId ? { userId: targetUserId } : {}),
            }),
          })
        )
      );
    },
    onSuccess: () => {
      toast.success(targetUserId ? `Entry saved for ${selectedPerformer?.name}` : 'Metrics saved!');
      setValues({});
      qc.invalidateQueries({ queryKey: ['entry-metrics'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Correct/set value (pending records) ──
  const correctMutation = useMutation({
    mutationFn: ({ key, newValue }: { key: string; newValue: number }) =>
      apiFetch('/api/metrics/set', {
        method: 'PUT',
        body: JSON.stringify({
          metric_type: key,
          value: newValue,
          ...(targetUserId ? { userId: targetUserId } : {}),
        }),
      }),
    onSuccess: (_res, { key }) => {
      toast.success('Value corrected!');
      setCorrections((p) => ({ ...p, [key]: null }));
      qc.invalidateQueries({ queryKey: ['entry-metrics'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Add correction (approved/rejected records) ──
  const addCorrectionMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: number }) =>
      apiFetch('/api/metrics/correction', {
        method: 'POST',
        body: JSON.stringify({
          metric_type: key,
          value,
          date: TODAY,
          ...(targetUserId ? { userId: targetUserId } : {}),
        }),
      }),
    onSuccess: (_res, { key }) => {
      toast.success('Correction submitted for approval!');
      setCorrections((p) => ({ ...p, [key]: null }));
      qc.invalidateQueries({ queryKey: ['entry-metrics'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isBusy = saveMutation.isPending || correctMutation.isPending || addCorrectionMutation.isPending;
  const hasAnyValue = metrics.some((m) => parseInt(values[m.key] ?? '0') > 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Daily Entry</h1>
          <p className="text-xs text-neutral-400">{TODAY}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { qc.invalidateQueries({ queryKey: ['entry-metrics'] }); }}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50 sm:h-8 sm:w-8 dark:border-neutral-700 dark:hover:bg-neutral-800"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs — only for admin/manager */}
      {canBulk && (
        <div className="flex border-b border-neutral-200 bg-white px-6 dark:border-neutral-800 dark:bg-neutral-950">
          {(['my', 'team'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setValues({}); setCorrections({}); if (t === 'my') setSelectedPerformer(null); }}
              className={cn(
                'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                tab === t
                  ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300',
              )}
            >
              {t === 'my' ? 'My Entry' : 'Team Entry'}
            </button>
          ))}
        </div>
      )}

      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {/* Performer picker for team tab */}
          {tab === 'team' && (
            <PerformerPicker selected={selectedPerformer} onSelect={(p) => { setSelectedPerformer(p); setValues({}); setCorrections({}); }} />
          )}

          {(tab === 'my' || selectedPerformer) && (
            <>
              {/* Metric grid */}
              {metricsQuery.isLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {metrics.map((m) => {
                      const status    = todayStatus[m.key] as VerificationStatus | undefined;
                      const isLocked  = status === 'approved' || status === 'rejected';
                      const inCorr    = corrections[m.key] !== undefined && corrections[m.key] !== null;
                      const target    = (apiTargets[m.key] as number) ?? dailyTarget(m);

                      return (
                        <MetricEntryCard
                          key={m.key}
                          metricKey={m.key}
                          label={m.label}
                          icon={m.icon}
                          color={m.color}
                          todayValue={todayData[m.key] ?? 0}
                          yesterdayValue={yesterdayData[m.key] ?? 0}
                          target={target}
                          status={status}
                          inputValue={!isLocked && !inCorr ? (values[m.key] ?? '') : ''}
                          correctionValue={inCorr ? (corrections[m.key] ?? '') : null}
                          onInput={(v) => setValues((p) => ({ ...p, [m.key]: v }))}
                          onCorrect={(v) => setCorrections((p) => ({ ...p, [m.key]: v }))}
                          onStartCorrection={() => setCorrections((p) => ({ ...p, [m.key]: isLocked ? '' : String(todayData[m.key] ?? 0) }))}
                          onSaveCorrection={() => {
                            const raw = corrections[m.key];
                            const v = parseFloat(raw ?? '');
                            if (isNaN(v) || v < 0) { toast.error('Enter a valid number'); return; }
                            if (isLocked) addCorrectionMutation.mutate({ key: m.key, value: v });
                            else          correctMutation.mutate({ key: m.key, newValue: v });
                          }}
                          onCancelCorrection={() => setCorrections((p) => ({ ...p, [m.key]: null }))}
                          disabled={isBusy}
                        />
                      );
                    })}
                  </div>

                  {/* Today's summary card */}
                  {Object.values(todayData).some((v) => v > 0) && (
                    <Card noPadding>
                      <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
                        <p className="text-xs font-semibold text-neutral-500">Today's summary</p>
                      </div>
                      <div className="grid grid-cols-3 gap-0 divide-x divide-neutral-100 dark:divide-neutral-800 sm:grid-cols-5">
                        {metrics.filter((m) => (todayData[m.key] ?? 0) > 0).map((m) => {
                          return (
                            <div key={m.key} className="px-3 py-2.5 text-center">
                              <p className="text-[10px] text-neutral-400">{m.icon} {m.label}</p>
                              <p className="text-sm font-bold" style={{ color: m.color }}>
                                {formatMetricValue(m, todayData[m.key] ?? 0)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  )}

                  {/* Save button */}
                  <div className="sticky bottom-0 pb-safe">
                    <Button
                      onClick={() => saveMutation.mutate()}
                      loading={saveMutation.isPending}
                      disabled={!hasAnyValue || isBusy}
                      className="w-full"
                      size="lg"
                      iconLeft={<PenLine className="h-4 w-4" />}
                    >
                      Save Today&apos;s Metrics
                    </Button>
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'team' && !selectedPerformer && (
            <div className="py-16 text-center">
              <Users className="mx-auto h-8 w-8 text-neutral-300 mb-3" />
              <p className="text-sm text-neutral-500">Select an employee above to enter their metrics</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
