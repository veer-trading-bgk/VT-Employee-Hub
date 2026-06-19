interface StatsCardProps {
  title: string;
  value: string | number;
  icon: string;
  change?: number;
  changeLabel?: string;
  accent?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'blue' | 'purple';
  loading?: boolean;
}

const ACCENTS = {
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
};

export function StatsCard({
  title,
  value,
  icon,
  change,
  changeLabel,
  accent = 'indigo',
  loading,
}: StatsCardProps) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700" />
        <div className="mb-2 h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-8 w-16 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg ${ACCENTS[accent]}`}>
          {icon}
        </span>
        {change !== undefined && (
          <span
            className={`text-xs font-semibold ${
              change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      {changeLabel && <p className="mt-0.5 text-xs text-slate-400">{changeLabel}</p>}
    </div>
  );
}
