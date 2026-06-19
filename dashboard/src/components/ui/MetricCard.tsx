import { formatMetricValue, type MetricConfig } from '@/lib/metrics.config';
import type { VerificationStatus } from '@/types';

interface MetricCardProps {
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
  pending:  { label: '⏳ Pending',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'     },
  rejected: { label: '✕ Rejected', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'         },
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

  const barColor  = done ? 'bg-emerald-500' : mid ? 'bg-amber-400' : 'bg-rose-400';
  const borderCls = isRejected
    ? 'border-rose-300 dark:border-rose-800'
    : done
    ? 'border-emerald-200 dark:border-emerald-800'
    : 'border-slate-200 dark:border-slate-800';

  return (
    <div
      className={`group rounded-xl border bg-white p-4 shadow-sm transition-all duration-200
        dark:bg-slate-900
        ${isEntry ? 'hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800' : 'hover:shadow-md'}
        ${borderCls}
      `}
    >
      {/* Top row: icon left, controls right */}
      <div className="flex items-center justify-between">
        <span className="text-xl leading-none">{metric.icon}</span>
        <div className="flex items-center gap-1">
          {onFixClick && !isCorrection && (
            <button
              onClick={onFixClick}
              title="Fix wrong value"
              className="rounded-md p-0.5 text-slate-300 transition
                hover:bg-amber-50 hover:text-amber-500
                dark:text-slate-600 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </button>
          )}
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums
              ${done
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
          >
            {progress}%
          </span>
        </div>
      </div>

      {/* Label */}
      <p className="mt-1.5 text-xs font-semibold leading-tight text-slate-600 dark:text-slate-400">
        {metric.label}
      </p>

      {/* Verification status chip */}
      {verificationStatus && (
        <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CHIP[verificationStatus].cls}`}>
          {STATUS_CHIP[verificationStatus].label}
        </span>
      )}

      {/* Logged value */}
      <p className={`mt-2 text-2xl font-bold tabular-nums leading-none ${isRejected ? 'text-slate-400 dark:text-slate-600 line-through' : 'text-slate-900 dark:text-white'}`}>
        {formatMetricValue(metric, value)}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
        of {formatMetricValue(metric, Math.round(target))} daily target
        {yesterday !== undefined && yesterday > 0 && (
          <span className="ml-2 text-slate-300 dark:text-slate-600">
            · yest: {formatMetricValue(metric, yesterday)}
          </span>
        )}
      </p>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isRejected ? 'bg-rose-300 dark:bg-rose-800' : barColor}`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      {/* Rejected notice */}
      {isRejected && !isCorrection && (
        <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
          Entry rejected — use Fix to resubmit
        </p>
      )}

      {/* Correction mode */}
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
        <div className="mt-3">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            placeholder={value > 0 ? 'Add more…' : 'Enter…'}
            value={inputValue ?? ''}
            onChange={(e) => onInputChange!(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium
              text-slate-900 placeholder-slate-400 outline-none transition
              focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20
              disabled:cursor-not-allowed disabled:opacity-50
              dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500
              dark:focus:border-indigo-500 dark:focus:bg-slate-900"
          />
        </div>
      ) : null}
    </div>
  );
}
