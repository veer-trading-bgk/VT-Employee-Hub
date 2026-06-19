'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Leaderboard } from '@/components/ui/Leaderboard';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useRoleScopedMetrics } from '@/hooks/useMetrics';
import { Navbar } from '@/components/layout/Navbar';

export default function LeaderboardPage() {
  const { team, isAdmin, isManager } = useRoleScopedMetrics();

  return (
    <AppShell allowedRoles={['admin', 'manager']}>
      <Navbar title="Leaderboard" />
      <div className="p-4 md:p-8">
      <h1 className="mb-1 text-2xl font-bold text-slate-900 dark:text-white">Leaderboard</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        {isAdmin ? 'All employees' : 'Your team'} - ranked by metric, today
      </p>

      {!isAdmin && !isManager ? (
        <p className="text-sm text-slate-400">Leaderboard is available to managers and admins only.</p>
      ) : team.error ? (
        <ErrorMessage message={team.error.message} onRetry={team.refetch} />
      ) : team.loading ? (
        <TableSkeleton />
      ) : (
        <div className="max-w-xl">
          <Leaderboard data={team.data?.data ?? {}} />
        </div>
      )}
      </div>
    </AppShell>
  );
}
