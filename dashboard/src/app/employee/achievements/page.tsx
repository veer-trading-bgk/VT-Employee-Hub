'use client';

import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { BadgeCard } from '@/components/badges/BadgeCard';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

interface BadgesResponse {
  earned: { id: string; name: string; icon: string; description: string; earnedAt: string }[];
  progress: { id: string; name: string; icon: string; description: string; progress: number; requirement: number }[];
  totalPoints: number;
}

interface PointsLeaderboardResponse {
  data: { rank: number; name: string; email: string; totalPoints: number; badgeCount: number }[];
}

export default function AchievementsPage() {
  const { user } = useAuthStore();

  const { data: badges, isLoading: badgesLoading } = useQuery({
    queryKey: ['my-badges'],
    queryFn: () => apiFetch<BadgesResponse>(`/api/badges/user/${user?.id ?? 'me'}`),
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  const { data: leaderboard, isLoading: lbLoading } = useQuery({
    queryKey: ['points-leaderboard'],
    queryFn: () => apiFetch<PointsLeaderboardResponse>('/api/points/leaderboard'),
    staleTime: 1000 * 60 * 5,
  });

  const earned = badges?.earned ?? [];
  const progress = badges?.progress ?? [];
  const totalPoints = badges?.totalPoints ?? 0;
  const lb = leaderboard?.data ?? [];
  const myRank = lb.findIndex((r) => r.email === user?.email) + 1;

  const MEDAL = ['🥇', '🥈', '🥉'];

  return (
    <>
      <Navbar title="Achievements" showBack />
      <div className="space-y-6 p-4 md:p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">🏅 Achievements</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {earned.length} badges earned · {totalPoints.toLocaleString()} total points
            </p>
          </div>
          {myRank > 0 && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-center dark:border-indigo-900/40 dark:bg-indigo-950/30">
              <p className="text-xs text-indigo-500 dark:text-indigo-400">My Rank</p>
              <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-400">#{myRank}</p>
            </div>
          )}
        </div>

        {/* Points summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">Points</p>
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">⭐ {totalPoints.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">Badges</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">🏅 {earned.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">In Progress</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">🎯 {progress.length}</p>
          </div>
        </div>

        {/* Earned badges */}
        {badgesLoading ? (
          <Loading />
        ) : (
          <>
            {earned.length > 0 && (
              <div>
                <h2 className="mb-3 font-semibold text-slate-900 dark:text-white">Earned Badges</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {earned.map((b) => (
                    <BadgeCard key={b.id} badge={b} size="sm" />
                  ))}
                </div>
              </div>
            )}

            {progress.length > 0 && (
              <div>
                <h2 className="mb-3 font-semibold text-slate-900 dark:text-white">In Progress</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {progress.map((b) => (
                    <BadgeCard key={b.id} badge={{ ...b, locked: true }} size="sm" />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Points leaderboard */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">🏆 Points Leaderboard</h2>
          {lbLoading ? (
            <Loading size="sm" />
          ) : lb.length === 0 ? (
            <p className="text-sm text-slate-500">No data yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-2 pr-4">Rank</th>
                    <th className="pb-2 pr-4">Employee</th>
                    <th className="pb-2 pr-4">Points</th>
                    <th className="pb-2">Badges</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lb.slice(0, 20).map((row, i) => {
                    const isMe = row.email === user?.email;
                    return (
                      <tr
                        key={row.email}
                        className={`transition-colors ${
                          isMe
                            ? 'bg-indigo-50 dark:bg-indigo-950/20'
                            : i < 3
                            ? 'bg-amber-50/50 dark:bg-amber-950/10'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="py-2.5 pr-4 text-lg font-bold">{MEDAL[i] ?? `#${i + 1}`}</td>
                        <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-white">
                          {row.name ?? row.email}{isMe && <span className="ml-2 text-xs text-indigo-500">(you)</span>}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                            ⭐ {row.totalPoints.toLocaleString()}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-700 dark:text-slate-300">
                          🏅 {row.badgeCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
