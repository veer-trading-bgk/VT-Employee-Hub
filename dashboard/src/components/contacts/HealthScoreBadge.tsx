'use client';

interface HealthScoreBadgeProps {
  score: number | null;
  aiEnabled?: boolean;
}

function scoreBarColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-rose-500';
}

function scoreTextColor(score: number): string {
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

export function HealthScoreBadge({ score, aiEnabled = false }: HealthScoreBadgeProps) {
  if (!aiEnabled || score === null || score === undefined) {
    return (
      <div
        className="flex items-center gap-2"
        title="AI Health Score — available once AI is enabled for your account"
        aria-label="Health score not yet available"
      >
        <div className="h-1.5 w-16 rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
        <span className="text-xs font-semibold tabular-nums text-slate-400 dark:text-slate-500">
          – / 100
        </span>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, score));
  return (
    <div
      className="flex items-center gap-2"
      title={`Health Score: ${score}/100`}
      aria-label={`Health score ${score} out of 100`}
    >
      <div className="h-1.5 w-16 rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
        <div
          className={`h-1.5 rounded-full transition-all ${scoreBarColor(score)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${scoreTextColor(score)}`}>
        {score}
      </span>
    </div>
  );
}
