import { formatMetricValue, type MetricConfig } from '@/lib/metrics.config';
import type { VerificationStatus } from '@/types';

export interface MetricCardProps {
  metric: MetricConfig;
  value: number;
  target: number;
  progress: number;
  yesterday?: number;
  verificationStatus?: VerificationStatus;
  // Add mode
  inputValue?: string;
  onInputChange?: (v: string) => void;
  disabled?: boolean;
  // Correction mode
  correctionValue?: string;
  onCorrectionChange?: (v: string) => void;
  onCorrectionSave?: () => void;
  onCorrectionCancel?: () => void;
  onFixClick?: () => void;
}

const STATUS_CHIP: Record<VerificationStatus, { label: string; cls: string }> = {
  approved: { label: '✓ Approved', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' },
  pending:  { label: '⏳ Pending',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'       },
  rejected: { label: '✕ Rejected', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'           },
};

export function MetricCard({
  metric,
  value,
  target,
  progress,
  yesterday,
  verificationStatus,
  inputValue,
  onInputChange,
  disabled,
  correctionValue,
  onCorrectionChange,
  onCorrectionSave,
  onCorrectionCancel,
  onFixClick,
}: MetricCardProps) {
  const isEntry      = onInputChange !== undefined;
  const isCorrection = onCorrectionChange !== undefined;
  const isRejected   = verificationStatus === 'rejected';
  const done = progress >= 100;
  const mid  = progress >= 60;

  // Yesterday trend
  const hasYesterday  = yesterday !== undefined && yesterday > 0;
  const trendUp       = hasYesterday && value >= yesterday!;
  const trendDelta    = hasYesterday ? Math.abs(value - yesterday!) : 0;

  // Dynamic colors
  const progressColor = isRejected
    ? '#f43f5e'
    : done
    ? '#10b981'
    : metric.color;

  const pctPillCls = done
    ? 'bg-emerald-500 text-white'
    : mid
    ? 'text-white'
    : 'bg-rose-500 text-white';

  // Card ring: achievement green when done, rejected red, else subtle slate
  const ringCls = isRejected
    ? 'ring-rose-200 dark:ring-rose-900'
    : done
    ? 'ring-emerald-200 dark:ring-emerald-900'
    : 'ring-slate-200/80 dark:ring-slate-800';

  const targetDisplay = target > 0 && target < 1
    ? target.toFixed(1)
    : formatMetricValue(metric, Math.round(target));

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl bg-white ring-1 shadow-sm
        transition-all duration-200
        dark:bg-slate-900
        ${isEntry ? 'hover:shadow-md hover:-translate-y-0.5' : 'hover:shadow-md'}
        ${ringCls}
      `}
    >
      {/* ── Colored top accent stripe ── */}
      <div
        className="h-[3px] w-full shrink-0"
        style={{ backgroundColor: isRejected ? '#f43f5e' : done ? '#10b981' : metric.color }}
      />

      <div className="flex flex-col gap-0 p-4">

        {/* ── Top row: icon badge + fix button + progress pill ── */}
        <div className="flex items-start justify-between">
          {/* Icon in soft colored badge */}
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-lg leading-none"
            style={{ backgroundColor: `${metric.color}18` }}
          >
            {metric.icon}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Fix button */}
            {onFixClick && !isCorrection && (
              <button
                onClick={onFixClick}
                title="Fix wrong value"
                className="rounded-lg p-1 text-slate-300 transition
                  hover:bg-amber-50 hover:text-amber-500
                  dark:text-slate-600 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
            )}

            {/* Progress % pill */}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${pctPillCls}`}
              style={!done && !isRejected && mid ? { backgroundColor: metric.color } : undefined}
            >
              {progress}%
            </span>
          </div>
        </div>

        {/* ── Metric label ── */}
        <p className="mt-2 text-xs font-semibold leading-tight text-slate-500 dark:text-slate-400">
          {metric.label}
        </p>

        {/* ── Verification chip ── */}
        {verificationStatus && (
          <span className={`mt-1 inline-block w-fit rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CHIP[verificationStatus].cls}`}>
            {STATUS_CHIP[verificationStatus].label}
          </span>
        )}

        {/* ── Value (large, bold) ── */}
        <p
          className={`mt-1.5 text-3xl font-black leading-none tabular-nums tracking-tight
            ${isRejected ? 'text-slate-300 line-through dark:text-slate-700' : 'text-slate-900 dark:text-white'}`}
        >
          {formatMetricValue(metric, value)}
        </p>

        {/* ── Target + yesterday trend ── */}
        <div className="mt-1 flex items-center justify-between gap-1">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            of {targetDisplay} target
          </p>
          {hasYesterday && (
            <span
              className={`flex items-center gap-0.5 text-[10px] font-bold tabular-nums
                ${trendUp ? 'text-emerald-500' : 'text-rose-400'}`}
            >
              {trendUp ? '▲' : '▼'} {formatMetricValue(metric, trendDelta)} yest
            </span>
          )}
        </div>

        {/* ── Progress bar (thicker, metric color) ── */}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(progress, 100)}%`,
              backgroundColor: progressColor,
              minWidth: progress > 0 ? '6px' : '0',
            }}
          />
        </div>

        {/* ── Done glow label ── */}
        {done && !isRejected && (
          <p className="mt-1.5 text-[10px] font-bold text-emerald-500 dark:text-emerald-400">
            ✓ Target achieved
          </p>
        )}

        {/* ── Rejected notice ── */}
        {isRejected && !isCorrection && (
          <p className="mt-1.5 text-[11px] font-semibold text-rose-500 dark:text-rose-400">
            Entry rejected — use Fix ✏️ to resubmit
          </p>
        )}

        {/* ── Correction mode ── */}
        {isCorrection ? (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              {isRejected ? '🔄 Resubmit corrected value:' : value > 0 ? '✏️ Set correct total:' : '✏️ Set exact value:'}
            </p>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              placeholder="Correct value…"
              value={correctionValue ?? ''}
              onChange={(e) => onCorrectionChange!(e.target.value)}
              disabled={disabled}
              autoFocus
              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-medium
                text-slate-900 placeholder-slate-400 outline-none transition
                focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-400/20
                disabled:cursor-not-allowed disabled:opacity-50
                dark:border-amber-700 dark:bg-amber-950/30 dark:text-white dark:placeholder-slate-500
                dark:focus:bg-slate-800"
            />
            <div className="flex gap-2">
              <button
                onClick={onCorrectionSave}
                disabled={disabled || !correctionValue}
                className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-bold text-white
                  hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40 transition"
              >
                Save
              </button>
              <button
                onClick={onCorrectionCancel}
                disabled={disabled}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600
                  hover:bg-slate-50 disabled:opacity-40 transition
                  dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>

        ) : isEntry ? (
          /* ── Add mode input ── */
          <div className="mt-3">
            <input
              type="number"
              inputMode="numeric"
              min="0"
              placeholder={value > 0 ? 'Add more…' : 'Enter value…'}
              value={inputValue ?? ''}
              onChange={(e) => onInputChange!(e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium
                text-slate-900 placeholder-slate-400 outline-none transition
                focus:bg-white focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50
                dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500
                dark:focus:bg-slate-900"
              style={{
                // Focus ring in metric color
                '--tw-ring-color': `${metric.color}40`,
                borderColor: inputValue && parseInt(inputValue) > 0 ? metric.color : undefined,
              } as React.CSSProperties}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
