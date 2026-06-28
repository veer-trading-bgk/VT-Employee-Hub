'use client';

interface Badge {
  id: string;
  name: string;
  icon: string;
  description: string;
  earnedAt?: string;
  locked?: boolean;
  progress?: number;
  requirement?: number;
}

interface Props {
  badge: Badge;
  size?: 'sm' | 'md' | 'lg';
}

export function BadgeCard({ badge, size = 'md' }: Props) {
  const locked = badge.locked ?? false;
  const sizes = { sm: 'p-3', md: 'p-4', lg: 'p-5' };
  const iconSizes = { sm: 'text-2xl', md: 'text-3xl', lg: 'text-4xl' };

  return (
    <div
      className={`rounded-xl border transition hover:shadow-md ${sizes[size]} ${
        locked
          ? 'border-slate-200 bg-slate-50 opacity-60 dark:border-slate-800 dark:bg-slate-900/50'
          : 'border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 dark:border-indigo-900/50 dark:from-indigo-950/30 dark:to-purple-950/30'
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`${iconSizes[size]} ${locked ? 'grayscale' : ''}`}>{badge.icon}</span>
        {!locked && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
            Earned
          </span>
        )}
      </div>
      <p className="text-sm font-bold text-slate-900 dark:text-white">{badge.name}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{badge.description}</p>

      {/* Progress bar for locked badges */}
      {locked && badge.progress !== undefined && badge.requirement !== undefined && (
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-slate-500 mb-1">
            <span>Progress</span>
            <span>{badge.progress}/{badge.requirement}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-indigo-400 transition-all"
              style={{ width: `${Math.min((badge.progress / badge.requirement) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Earned date */}
      {!locked && badge.earnedAt && (
        <p className="mt-1.5 text-[10px] text-slate-400">
          {new Date(badge.earnedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
        </p>
      )}
    </div>
  );
}
