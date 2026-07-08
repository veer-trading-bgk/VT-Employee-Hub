'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Search, FlaskConical, ShieldCheck, HelpCircle } from 'lucide-react';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { Table, TableColumn } from '@/components/v3/ui/Table';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { Toggle } from '@/components/v3/ui/Toggle';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import type {
  AiCostSource, AiCostByCompany, AiCostByUseCase,
  PlatformAiCostsResponse, PlatformAiCostEntityResponse,
} from '@/lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

const USE_CASE_LABELS: Record<string, string> = {
  'conversational-sales-agent': 'Conversation (AI sales agent)',
  'conversation-handoff-summary': 'Handoff summary',
  'inbox-template-suggestion': 'Suggested reply',
  'inbox-intent-detection': 'Intent detection',
  'template-creation': 'Template creation',
};
function useCaseLabel(key: string): string {
  return USE_CASE_LABELS[key] ?? key;
}

function fmtUsd(v: number): string {
  return `$${v.toFixed(v < 1 ? 4 : 2)}`;
}
function fmtInr(v: number): string {
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: v < 1 ? 4 : 2 })}`;
}

const RANGE_OPTIONS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

const SOURCE_META: Record<AiCostSource, { label: string; icon: typeof ShieldCheck; badge: 'success' | 'warning' | 'default' }> = {
  production: { label: 'Production', icon: ShieldCheck, badge: 'success' },
  admin_test: { label: 'Admin Test', icon: FlaskConical, badge: 'warning' },
  untagged: { label: 'Untagged (pre-tracking)', icon: HelpCircle, badge: 'default' },
};

// ── Source summary cards — always all three, never blended ───────────────────
//
// Headline number is registered (real, onboarded) companies only — Era 39:
// some earlier verification scripts tagged scratch companyIds
// source:'production' directly, so source alone can't be trusted as the
// real-vs-test signal. The unregistered subtotal is always shown alongside,
// never hidden — "Show blended" is an explicit opt-in for debugging only.

function SourceSummaryCards({ data, selected, onSelect, showBlended }: {
  data: PlatformAiCostsResponse;
  selected: AiCostSource;
  onSelect: (s: AiCostSource) => void;
  showBlended: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {(Object.keys(SOURCE_META) as AiCostSource[]).map((key) => {
        const meta = SOURCE_META[key];
        const bucket = data.bySource[key];
        const Icon = meta.icon;
        const headlineInr = showBlended ? bucket.totalCostInr : bucket.registeredCostInr;
        const headlineUsd = showBlended ? bucket.totalCostUsd : bucket.registeredCostUsd;
        const headlineCalls = showBlended ? bucket.calls : bucket.registeredCalls;
        return (
          <Card
            key={key}
            variant={selected === key ? 'elevated' : 'default'}
            className={cn('cursor-pointer transition-all', selected === key && 'ring-2 ring-primary-500')}
            onClick={() => onSelect(key)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                <Icon className="h-3.5 w-3.5" />
                {meta.label}
              </div>
              <Badge variant={meta.badge}>{headlineCalls} calls</Badge>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
              {fmtInr(headlineInr)}
            </p>
            <p className="text-xs tabular-nums text-neutral-400">{fmtUsd(headlineUsd)}</p>
            {!showBlended && bucket.unregisteredCalls > 0 && (
              <p className="mt-1.5 text-[11px] text-neutral-400">
                + {fmtInr(bucket.unregisteredCostInr)} from {bucket.unregisteredCompanyCount} unregistered/scratch{' '}
                {bucket.unregisteredCompanyCount === 1 ? 'identity' : 'identities'}
              </p>
            )}
            {showBlended && bucket.unregisteredCalls > 0 && (
              <p className="mt-1.5 text-[11px] text-neutral-400">
                blended — includes {bucket.unregisteredCompanyCount} unregistered/scratch{' '}
                {bucket.unregisteredCompanyCount === 1 ? 'identity' : 'identities'}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── Per-useCase bar chart ──────────────────────────────────────────────────────

const BAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9'];

function UseCaseBarChart({ rows }: { rows: AiCostByUseCase[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-neutral-400">No calls in this bucket for the selected range.</p>;
  }
  const chartData = rows.map((r) => ({ name: useCaseLabel(r.useCase), costInr: r.costInr }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 44)}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-neutral-200 dark:stroke-neutral-800" />
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}`} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
        <Tooltip formatter={(v) => [`₹${Number(v).toLocaleString('en-IN')}`, 'Cost']} contentStyle={{ borderRadius: 8, border: 'none', fontSize: 12 }} />
        <Bar dataKey="costInr" radius={[0, 4, 4, 0]}>
          {chartData.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Per-company table ──────────────────────────────────────────────────────────

function CompanyCostTable({ rows }: { rows: AiCostByCompany[] }) {
  const columns: TableColumn<AiCostByCompany>[] = [
    {
      key: 'companyId',
      header: 'Company',
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="font-medium">{r.companyId}</span>
          {!r.registered && (
            <span
              title="Not in COMPANY_PROFILE — unregistered/scratch identity, not a real onboarded company"
              className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
            >
              <FlaskConical className="h-2.5 w-2.5" /> Unregistered
            </span>
          )}
        </span>
      ),
    },
    { key: 'calls', header: 'Calls', cell: (r) => <span className="tabular-nums">{r.calls}</span> },
    { key: 'costInr', header: 'Cost (INR)', cell: (r) => <span className="tabular-nums font-semibold">{fmtInr(r.costInr)}</span> },
    { key: 'costUsd', header: 'Cost (USD)', cell: (r) => <span className="tabular-nums text-neutral-400">{fmtUsd(r.costUsd)}</span> },
  ];
  return (
    <Table
      columns={columns}
      data={rows}
      keyExtractor={(r) => r.companyId}
      emptyState={<span className="text-sm text-neutral-400">No companies in this bucket for the selected range.</span>}
    />
  );
}

// ── Drill-down: look up one entityId (conversationId) ─────────────────────────

function EntityDrilldown() {
  const [input, setInput] = useState('');
  const [lookupId, setLookupId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform-ai-cost-entity', lookupId],
    queryFn: () => api.platformAiCostEntity(lookupId as string),
    enabled: !!lookupId,
  });

  function handleLookup() {
    if (input.trim()) setLookupId(input.trim());
  }

  return (
    <Card>
      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Drill into a conversation</p>
      <p className="mt-0.5 text-xs text-neutral-400">Paste a conversationId to see every AI/embedding call tied to it, with its own cost.</p>
      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
          placeholder="conv_01KX07KEX1MMQX18M47ZF77QKN"
          className="h-9 flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
        <button
          onClick={handleLookup}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700"
        >
          <Search className="h-3.5 w-3.5" /> Look up
        </button>
      </div>

      {lookupId && (
        <div className="mt-4">
          {isLoading && <Skeleton className="h-24 w-full" />}
          {isError && <p className="text-sm text-error-600">Lookup failed — check the conversationId and try again.</p>}
          {data && <EntityDrilldownResult data={data} />}
        </div>
      )}
    </Card>
  );
}

function EntityDrilldownResult({ data }: { data: PlatformAiCostEntityResponse }) {
  if (data.aiUsage.length === 0 && data.embedUsage.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No records found"
        description={`No AIUSAGE#/EMBEDUSAGE# records match entityId "${data.entityId}".`}
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>Total AI cost: <strong className="tabular-nums">{fmtInr(data.totals.aiCostInr)}</strong> <span className="text-neutral-400">({fmtUsd(data.totals.aiCostUsd)}, {data.totals.aiCalls} calls)</span></span>
        <span>Embeddings: <strong className="tabular-nums">{data.totals.embedTokens.toLocaleString('en-IN')} tokens</strong> <span className="text-neutral-400">(~{fmtInr(data.totals.embedEstimatedCostInr)} estimated, {data.totals.embedCalls} calls)</span></span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-neutral-500">
            <tr>
              <th className="px-2 py-1 text-left">When</th>
              <th className="px-2 py-1 text-left">Use case</th>
              <th className="px-2 py-1 text-left">Source</th>
              <th className="px-2 py-1 text-left">Model</th>
              <th className="px-2 py-1 text-right">Cost (INR)</th>
              <th className="px-2 py-1 text-right">Attempts</th>
            </tr>
          </thead>
          <tbody>
            {data.aiUsage.map((r, i) => (
              <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-2 py-1 text-neutral-400">{r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '—'}</td>
                <td className="px-2 py-1">{r.useCase ? useCaseLabel(r.useCase) : '—'}</td>
                <td className="px-2 py-1">
                  {r.source
                    ? <Badge variant={SOURCE_META[r.source].badge}>{SOURCE_META[r.source].label}</Badge>
                    : <Badge>Untagged</Badge>}
                </td>
                <td className="px-2 py-1 text-neutral-400">{r.model ?? '—'}</td>
                <td className="px-2 py-1 text-right tabular-nums font-medium">{fmtInr(r.costInr)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.attempts ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main tab ────────────────────────────────────────────────────────────────────

export function AiCostsTab() {
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [selectedSource, setSelectedSource] = useState<AiCostSource>('production');
  // Off by default — headline cards show registered (real) companies only
  // until a superadmin explicitly opts into seeing the blended debug view.
  const [showBlended, setShowBlended] = useState(false);

  const { from, to } = useMemo(() => {
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - rangeDays * 86_400_000);
    return { from: fromDate.toISOString(), to: toDate.toISOString() };
  }, [rangeDays]);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-ai-costs', from, to],
    queryFn: () => api.platformAiCosts({ from, to }),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const bucket = data.bySource[selectedSource];

  return (
    <div className="space-y-5">
      {/* Low-data disclosure — real, not cosmetic (per Era 36/38) */}
      <Card variant="ghost" className="flex items-start gap-3 border border-warning-200 bg-warning-50/50 dark:border-warning-900/40 dark:bg-warning-900/10">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning-600 dark:text-warning-400" />
        <p className="text-xs text-warning-800 dark:text-warning-300">
          Cost tagging (entityType/entityId/source) went live 2026-07-08. Real tagged data covers{' '}
          <strong>{data.meta.daysOfTaggedData} day{data.meta.daysOfTaggedData === 1 ? '' : 's'}</strong> so far
          ({data.meta.taggedAiUsageRecordsInRange} of {data.meta.totalAiUsageRecordsInRange} records in this range).
          Numbers below are real, not placeholders — they will simply be small until more usage accumulates.
          Per Era 36: almost all data to date is <strong>Admin Test</strong>, not real customer traffic — the three
          buckets below are never blended, look at Production for genuine customer cost.
        </p>
      </Card>

      {/* Range selector + debug-only blended toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">AI Cost Report</p>
        <div className="flex flex-wrap items-center gap-4">
          <Toggle
            size="sm"
            label="Show blended (all identities)"
            checked={showBlended}
            onChange={(e) => setShowBlended(e.target.checked)}
          />
          <div className="flex gap-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setRangeDays(opt.days)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition',
                  rangeDays === opt.days ? 'bg-primary-600 text-white' : 'border border-neutral-200 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {showBlended && (
        <p className="text-xs text-neutral-400">
          Debug view — headline figures now include unregistered/scratch identities. Turn off for the real, registered-companies-only view.
        </p>
      )}

      {/* Always all three, never blended — click to focus the tables below */}
      <SourceSummaryCards data={data} selected={selectedSource} onSelect={setSelectedSource} showBlended={showBlended} />

      {/* Focused breakdown for the selected bucket */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Cost per use case — {SOURCE_META[selectedSource].label}
          </p>
          <UseCaseBarChart rows={bucket.byUseCase} />
        </Card>
        <Card noPadding>
          <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Cost per company — {SOURCE_META[selectedSource].label}
            </p>
          </div>
          <CompanyCostTable rows={bucket.byCompany} />
        </Card>
      </div>

      {/* Embeddings — separate, estimate-labeled */}
      <Card variant="ghost">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Embeddings (Voyage)</p>
        <p className="mt-0.5 text-xs text-neutral-400">{data.embeddings.note}</p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <span>{data.embeddings.totalTokens.toLocaleString('en-IN')} tokens</span>
          <span>~{fmtInr(data.embeddings.estimatedCostInr)} <span className="text-neutral-400">({fmtUsd(data.embeddings.estimatedCostUsd)} estimated)</span></span>
          <span className="text-neutral-400">{data.embeddings.calls} calls</span>
        </div>
      </Card>

      {/* Drill-down */}
      <EntityDrilldown />
    </div>
  );
}
