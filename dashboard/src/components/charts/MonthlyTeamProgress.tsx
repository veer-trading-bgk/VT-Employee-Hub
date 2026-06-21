'use client';

import { useMemo } from 'react';
import type { MetricUnit } from '@/components/charts/ProgressBarChart';

// ─── Types ─────────────────────────────────────────────────────────────────────
type Group = 'critical' | 'at-risk' | 'on-pace' | 'not-started';

export interface ProgressRow {
  label: string;
  icon: string;
  value: number;
  target: number;
  progress: number;
  color: string;
  unit: MetricUnit;
}

interface EnrichedRow extends ProgressRow {
  group: Group;
  forecast: number;
  needPerDay: number;
  sparkline: number[];
}

const GROUP_ORDER: Group[] = ['critical', 'at-risk', 'on-pace', 'not-started'];

const GROUP_STYLE: Record<Group, { label: string; dot: string; heading: string; border: string; bg: string; pct: string }> = {
  critical:     { label: 'Critical',     dot: 'bg-rose-500',    heading: 'text-rose-600 dark:text-rose-400',    border: 'border-rose-200 dark:border-rose-900/50',    bg: 'bg-rose-50 dark:bg-rose-950/20',     pct: 'text-rose-600 dark:text-rose-400' },
  'at-risk':    { label: 'At Risk',      dot: 'bg-amber-500',   heading: 'text-amber-600 dark:text-amber-400',  border: 'border-amber-200 dark:border-amber-800/50',  bg: 'bg-amber-50 dark:bg-amber-950/20',   pct: 'text-amber-600 dark:text-amber-400' },
  'on-pace':    { label: 'On Pace',      dot: 'bg-emerald-500', heading: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-900/50', bg: 'bg-emerald-50 dark:bg-emerald-950/20', pct: 'text-emerald-600 dark:text-emerald-400' },
  'not-started':{ label: 'Not Started',  dot: 'bg-slate-400',   heading: 'text-slate-500 dark:text-slate-400',  border: 'border-slate-200 dark:border-slate-700/50',  bg: 'bg-slate-50 dark:bg-slate-800/30',   pct: 'text-slate-400 dark:text-slate-500' },
};

// ─── Formatting helpers ─────────────────────────────────────────────────────────
function fmtVal(unit: MetricUnit, v: number): string {
  return unit === 'currency'
    ? `₹${Math.round(v).toLocaleString('en-IN')}`
    : v.toLocaleString('en-IN');
}

function fmtRate(unit: MetricUnit, v: number): string {
  if (unit === 'currency') return `₹${Math.round(v).toLocaleString('en-IN')}`;
  return v < 10 ? v.toFixed(1) : Math.round(v).toString();
}

// ─── Sparkline SVG ──────────────────────────────────────────────────────────────
// Points are normalized 0-1 values (7 entries).
function SparklineSVG({ points }: { points: number[] }) {
  const W = 52;
  const H = 18;
  if (points.every((p) => p === 0)) {
    return <svg width={W} height={H} />;
  }
  const coords = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - Math.max(0, Math.min(v, 1)) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const isUp = points[points.length - 1] >= points[0];
  return (
    <svg width={W} height={H} className="overflow-visible flex-shrink-0">
      <polyline
        points={coords}
        fill="none"
        stroke={isUp ? '#22c55e' : '#f43f5e'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Health score gauge ────────────────────────────────────────────────────────
function HealthGauge({ score }: { score: number }) {
  const R = 30;
  const circ = 2 * Math.PI * R;
  const clamped = Math.min(Math.max(score, 0), 100);
  const offset = circ - (clamped / 100) * circ;
  const stroke = clamped >= 70 ? '#22c55e' : clamped >= 40 ? '#f59e0b' : '#f43f5e';

  return (
    <svg width={80} height={80} viewBox="0 0 80 80" className="flex-shrink-0">
      <circle cx="40" cy="40" r={R} fill="none" strokeWidth="6"
        className="stroke-slate-200 dark:stroke-slate-700" />
      <circle
        cx="40" cy="40" r={R} fill="none"
        stroke={stroke} strokeWidth="6"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 40 40)"
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
      <text x="40" y="44" textAnchor="middle" fontSize="15" fontWeight="700" fill={stroke}>
        {Math.round(clamped)}
      </text>
    </svg>
  );
}

// ─── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({
  row,
  expectedPace,
  daysLeft,
}: {
  row: EnrichedRow;
  expectedPace: number;
  daysLeft: number;
}) {
  const style = GROUP_STYLE[row.group];
  const clampedPct = Math.min(row.progress, 100);

  const statusText = (() => {
    if (row.progress === 0) return 'No entries yet';
    if (row.progress >= 100) return 'Target hit!';
    if (row.group === 'on-pace') return `On track · Need ${fmtRate(row.unit, row.needPerDay)}/day`;
    return `Need ${fmtRate(row.unit, row.needPerDay)}/day to hit target`;
  })();

  const forecastLabel =
    row.progress > 0 && daysLeft > 0
      ? `At this pace: ${Math.min(row.forecast, 999)}% end of month`
      : null;

  return (
    <div
      className={`min-w-[210px] flex-shrink-0 snap-start rounded-xl border p-4 sm:min-w-0 sm:flex-shrink ${style.border} ${style.bg}`}
    >
      {/* Top: icon + label + sparkline */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex-shrink-0 text-base leading-none">{row.icon}</span>
          <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
            {row.label}
          </span>
        </div>
        <SparklineSVG points={row.sparkline} />
      </div>

      {/* Thick bar with expected-pace marker */}
      <div className="relative mt-3 h-4 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/60">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${clampedPct}%`,
            backgroundColor: row.color,
            minWidth: clampedPct > 0 ? '6px' : '0',
          }}
        />
        {/* Expected pace tick mark */}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-slate-500/70 dark:bg-white/40"
          style={{ left: `${Math.min(expectedPace, 98.5)}%` }}
          title={`Expected: ${Math.round(expectedPace)}% by today`}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-slate-400 dark:text-slate-500">
        <span>0%</span>
        <span>↑ {Math.round(expectedPace)}% exp.</span>
        <span>100%</span>
      </div>

      {/* Value / target + % */}
      <div className="mt-2 flex items-baseline justify-between gap-1">
        <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
          {fmtVal(row.unit, row.value)} / {fmtVal(row.unit, Math.round(row.target))}
        </span>
        <span className={`text-sm font-bold tabular-nums ${style.pct}`}>
          {Math.round(row.progress)}%
        </span>
      </div>

      {/* Status */}
      <p className={`mt-1 text-xs font-medium ${style.pct}`}>{statusText}</p>

      {/* Forecast */}
      {forecastLabel && (
        <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">{forecastLabel}</p>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────────
interface MonthlyTeamProgressProps {
  data: ProgressRow[];
  teamSize: number;
}

export function MonthlyTeamProgress({ data, teamSize }: MonthlyTeamProgressProps) {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - dayOfMonth;
  const expectedPace = (dayOfMonth / daysInMonth) * 100;

  const enriched = useMemo<EnrichedRow[]>(() => {
    return data.map((row) => {
      const forecast =
        dayOfMonth > 0 && row.target > 0
          ? Math.round((row.value / dayOfMonth) * daysInMonth * 100 / row.target)
          : 0;

      const needed = Math.max(0, row.target - row.value);
      const needPerDay = daysLeft > 0 ? needed / daysLeft : 0;

      let group: Group;
      if (row.progress === 0) {
        group = 'not-started';
      } else if (row.progress >= expectedPace * 0.95) {
        group = 'on-pace';
      } else if (row.progress >= expectedPace * 0.5) {
        group = 'at-risk';
      } else {
        group = 'critical';
      }

      // Estimated 7-day sparkline from MTD linear run rate (normalized 0-1)
      const daily = dayOfMonth > 0 ? row.value / dayOfMonth : 0;
      const rawPoints = Array.from({ length: 7 }, (_, i) => {
        const d = Math.max(1, dayOfMonth - (6 - i));
        return daily * d;
      });
      const peak = Math.max(...rawPoints, row.target, 1);
      const sparkline = rawPoints.map((v) => Math.min(v / peak, 1));

      return { ...row, group, forecast, needPerDay, sparkline };
    });
  }, [data, dayOfMonth, daysInMonth, daysLeft, expectedPace]);

  const grouped = useMemo(() => {
    const map: Record<Group, EnrichedRow[]> = { critical: [], 'at-risk': [], 'on-pace': [], 'not-started': [] };
    for (const row of enriched) map[row.group].push(row);
    return map;
  }, [enriched]);

  const onPaceCount = grouped['on-pace'].length;
  const healthScore =
    enriched.length > 0
      ? Math.round(enriched.reduce((s, r) => s + Math.min(r.progress, 100), 0) / enriched.length)
      : 0;

  const delta = healthScore - expectedPace;
  const paceLabel =
    delta >= 0
      ? `Ahead of pace +${delta.toFixed(0)}%`
      : `Behind pace −${Math.abs(delta).toFixed(0)}%`;
  const paceColor = delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400';

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">No metrics configured.</p>;
  }

  return (
    <div className="space-y-5">
      {/* ── Health score header ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-4 dark:border-slate-700 dark:from-slate-800/50 dark:to-slate-900/40">
        <HealthGauge score={healthScore} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-bold text-slate-900 dark:text-white">Team Health Score</span>
            <span className={`text-xs font-semibold ${paceColor}`}>{paceLabel}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            <span>
              <span className="inline-block mr-1 h-2 w-2 rounded-full bg-emerald-500 align-middle" />
              {onPaceCount}/{enriched.length} on pace
            </span>
            <span>Day {dayOfMonth}/{daysInMonth}</span>
            <span>{daysLeft} days left</span>
            <span>{teamSize} performers</span>
          </div>

          {/* Overall pace bar */}
          <div className="relative mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-700"
              style={{ width: `${Math.min(healthScore, 100)}%` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-slate-500/60 dark:bg-white/30"
              style={{ left: `${Math.min(expectedPace, 98.5)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-slate-400 dark:text-slate-500">
            <span>0%</span>
            <span>↑ {Math.round(expectedPace)}% expected today</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      {/* ── Metric groups ──────────────────────────────────────────────────────── */}
      {GROUP_ORDER.map((group) => {
        const rows = grouped[group];
        if (rows.length === 0) return null;
        const style = GROUP_STYLE[group];
        return (
          <div key={group}>
            {/* Group heading */}
            <div className="mb-2 flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
              <span className={`text-[11px] font-bold uppercase tracking-wider ${style.heading}`}>
                {style.label}
              </span>
              <span className="text-[11px] text-slate-400">({rows.length})</span>
            </div>

            {/* Mobile: horizontal snap-scroll cards | Desktop: vertical stack */}
            <div className="flex gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:flex-col sm:overflow-x-visible sm:pb-0 snap-x snap-mandatory">
              {rows.map((row) => (
                <MetricCard
                  key={row.label}
                  row={row}
                  expectedPace={expectedPace}
                  daysLeft={daysLeft}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
