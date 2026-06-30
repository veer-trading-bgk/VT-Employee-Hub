import { cn } from '@/lib/cn';

interface SkeletonProps {
  className?: string;
}

// Base pulse animation block
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-800', className)}
    />
  );
}

// Preset patterns

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-4', i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full')}
        />
      ))}
    </div>
  );
}

export function SkeletonAvatar({ size = 40 }: { size?: number }) {
  return (
    <div
      aria-hidden="true"
      className="animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-800 shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900', className)}
    >
      <div className="flex items-start gap-3">
        <SkeletonAvatar size={40} />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

export function SkeletonRow({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('flex items-center gap-3 px-4 py-3', className)}
    >
      <SkeletonAvatar size={32} />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-6 w-20 rounded-full" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true" aria-label="Loading table data">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="ml-auto h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-neutral-100 dark:border-neutral-800/50">
          <SkeletonRow />
        </div>
      ))}
    </div>
  );
}
