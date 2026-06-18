export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div style={style} className={`animate-pulse rounded-md bg-slate-200 dark:bg-slate-800 ${className}`} />;
}

export function MetricCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <Skeleton className="h-8 w-8" />
      <Skeleton className="mt-3 h-4 w-24" />
      <Skeleton className="mt-2 h-7 w-16" />
      <Skeleton className="mt-3 h-2 w-full" />
    </div>
  );
}

export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return <Skeleton className="w-full" style={{ height }} />;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
