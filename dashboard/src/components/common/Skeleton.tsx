'use client';

export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 dark:bg-slate-700 ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60">
      <div className="flex items-start justify-between gap-2">
        <SkeletonLine className="h-4 w-32" />
        <SkeletonLine className="h-6 w-6 rounded-full" />
      </div>
      <SkeletonLine className="mt-1.5 h-3 w-24" />
      <div className="mt-2 flex gap-1">
        <SkeletonLine className="h-4 w-14 rounded-full" />
        <SkeletonLine className="h-4 w-10 rounded-full" />
      </div>
      <SkeletonLine className="mt-2.5 h-1.5 w-full rounded-full" />
      <div className="mt-2 flex gap-2">
        <SkeletonLine className="h-3 w-10" />
        <SkeletonLine className="h-3 w-16" />
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <tr>
      {[32, 24, 16, 20, 28, 16, 12, 10].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <SkeletonLine className={`h-4 w-${w}`} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonConversation() {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <SkeletonLine className="h-10 w-10 flex-shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <SkeletonLine className="h-3.5 w-28" />
          <SkeletonLine className="h-3 w-10" />
        </div>
        <SkeletonLine className="mt-1.5 h-3 w-44" />
      </div>
    </div>
  );
}
