'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';

interface AttendanceSummaryEntry {
  userId: string;
  daysPresent: number;
  daysInMonth: number;
  attendancePct: number;
}

interface AdminAttendanceResponse {
  success: boolean;
  month: string;
  daysInMonth: number;
  summary: AttendanceSummaryEntry[];
}

interface EmployeeRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

interface UserAttendanceDetail {
  success: boolean;
  daysPresent: number;
  daysInMonth: number;
  attendancePct: number;
  records: { date: string; checkInTime: string; source: string }[];
}

function currentMonthStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}
function prevMonth(m: string) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nextMonth(m: string) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}
function buildDays(month: string): string[] {
  const [y, mo] = month.split('-').map(Number);
  const n = new Date(y, mo, 0).getDate();
  return Array.from({ length: n }, (_, i) => {
    const day = i + 1;
    return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });
}
function pctColor(pct: number) {
  if (pct >= 90) return 'text-emerald-600 dark:text-emerald-400';
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}
function dotColor(pct: number) {
  if (pct >= 90) return 'bg-emerald-500';
  if (pct >= 70) return 'bg-amber-400';
  return 'bg-red-400';
}

export default function AdminAttendancePage() {
  const [month, setMonth] = useState(currentMonthStr());
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const isCurrentMonth = month === currentMonthStr();
  const today = new Date().toISOString().slice(0, 10);

  const { data: summaryData, isLoading } = useQuery({
    queryKey: ['admin-attendance', month],
    queryFn: () => apiFetch<AdminAttendanceResponse>(`/api/attendance?month=${month}`),
    staleTime: 2 * 60_000,
  });

  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/admin/employees').catch(() => ({ success: true, data: [] })),
    staleTime: 10 * 60_000,
  });

  const { data: detailData } = useQuery({
    queryKey: ['admin-attendance-detail', selectedUser, month],
    queryFn: () => apiFetch<UserAttendanceDetail>(`/api/attendance/${selectedUser}?month=${month}`),
    enabled: !!selectedUser,
    staleTime: 60_000,
  });

  const empMap = Object.fromEntries((empData?.data ?? []).map((e) => [e.id, e]));
  const days = buildDays(month);
  const summary = summaryData?.summary ?? [];

  // Merge: add employees in emp list who have zero attendance (won't appear in summary)
  const allEmployeeIds = (empData?.data ?? [])
    .filter((e) => ['agent', 'telecaller', 'intern', 'team_lead'].includes(e.role) && e.status !== 'inactive')
    .map((e) => e.id);

  const summaryMap = Object.fromEntries(summary.map((s) => [s.userId, s]));
  const fullList = allEmployeeIds.map((id) => summaryMap[id] ?? {
    userId: id, daysPresent: 0, daysInMonth: summaryData?.daysInMonth ?? days.length, attendancePct: 0,
  });

  const filtered = fullList.filter((e) => {
    if (!search) return true;
    const emp = empMap[e.userId];
    const q = search.toLowerCase();
    return emp?.name?.toLowerCase().includes(q) || emp?.email?.toLowerCase().includes(q);
  }).sort((a, b) => b.attendancePct - a.attendancePct);

  const detailPresentDates = new Set((detailData?.records ?? []).map((r) => r.date));

  const avgAttendance = filtered.length > 0
    ? Math.round(filtered.reduce((s, e) => s + e.attendancePct, 0) / filtered.length)
    : 0;
  const fullAttendance = filtered.filter((e) => e.attendancePct === 100).length;
  const absent = filtered.filter((e) => e.daysPresent === 0).length;

  return (
    <>
      <Navbar title="Attendance" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl space-y-6 p-6">

          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Team Attendance</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{filtered.length} employees · {monthLabel(month)}</p>
            </div>
            {/* Month picker */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-1 dark:border-slate-700 dark:bg-slate-900">
              <button onClick={() => setMonth(prevMonth(month))} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">‹</button>
              <input
                type="month" value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="border-0 bg-transparent text-sm font-medium text-slate-700 outline-none dark:text-slate-300"
              />
              <button onClick={() => setMonth(nextMonth(month))} disabled={isCurrentMonth} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">›</button>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Avg Attendance</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-300">{avgAttendance}%</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">Perfect Attendance</p>
              <p className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-300">{fullAttendance}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">Total Employees</p>
              <p className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-300">{filtered.length}</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-red-500 dark:text-red-400">Zero Attendance</p>
              <p className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">{absent}</p>
            </div>
          </div>

          <div className="flex gap-6">
            {/* Main table */}
            <div className="min-w-0 flex-1 space-y-4">
              <input
                placeholder="Search employee…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
              />

              {isLoading ? (
                <div className="flex justify-center py-16"><Loading /></div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Employee</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">Days</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 min-w-40">This Month</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                        {filtered.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-16 text-center text-sm text-slate-400">
                              No attendance data for this month
                            </td>
                          </tr>
                        ) : filtered.map((entry) => {
                          const emp = empMap[entry.userId];
                          const isSelected = selectedUser === entry.userId;
                          return (
                            <tr
                              key={entry.userId}
                              onClick={() => setSelectedUser(isSelected ? null : entry.userId)}
                              className={`cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                            >
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-900 dark:text-white">{emp?.name ?? entry.userId}</p>
                                <p className="text-xs text-slate-400">{emp?.role}</p>
                              </td>
                              <td className="px-4 py-3 text-center tabular-nums">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">{entry.daysPresent}</span>
                                <span className="text-slate-400">/{entry.daysInMonth}</span>
                              </td>
                              <td className="px-4 py-3">
                                {/* Mini dot chart — one dot per day */}
                                <div className="flex flex-wrap gap-0.5">
                                  {days.map((date) => {
                                    const isFuture = date > today;
                                    const isSun = new Date(date + 'T00:00:00').getDay() === 0;
                                    return (
                                      <div
                                        key={date}
                                        title={date}
                                        className={`h-2 w-2 rounded-sm ${
                                          isFuture || isSun ? 'bg-slate-100 dark:bg-slate-800' :
                                          entry.attendancePct >= 90 ? 'bg-emerald-400' :
                                          entry.attendancePct >= 70 ? 'bg-amber-400' :
                                          entry.attendancePct > 0 ? 'bg-red-300' :
                                          'bg-slate-100 dark:bg-slate-800'
                                        }`}
                                      />
                                    );
                                  })}
                                </div>
                              </td>
                              <td className={`px-4 py-3 text-right tabular-nums font-bold ${pctColor(entry.attendancePct)}`}>
                                {entry.attendancePct}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Detail panel */}
            {selectedUser && (
              <div className="w-72 flex-shrink-0">
                <div className="sticky top-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{empMap[selectedUser]?.name ?? selectedUser}</p>
                      <p className="text-xs text-slate-400">{empMap[selectedUser]?.email}</p>
                    </div>
                    <button onClick={() => setSelectedUser(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                  </div>

                  {/* Mini stats */}
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-800">
                      <p className={`text-xl font-bold ${pctColor(detailData?.attendancePct ?? 0)}`}>{detailData?.attendancePct ?? 0}%</p>
                      <p className="text-[10px] text-slate-400">Attendance</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-800">
                      <p className="text-xl font-bold text-slate-700 dark:text-slate-300">{detailData?.daysPresent ?? 0}</p>
                      <p className="text-[10px] text-slate-400">Days Present</p>
                    </div>
                  </div>

                  {/* Mini calendar */}
                  <div className="mb-1 grid grid-cols-7 text-center">
                    {['M','T','W','T','F','S','S'].map((d, i) => (
                      <p key={i} className="text-[9px] font-semibold text-slate-400">{d}</p>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-0.5">
                    {(() => {
                      const [y, mo] = month.split('-').map(Number);
                      const firstDay = new Date(y, mo - 1, 1).getDay();
                      const daysInMonth = new Date(y, mo, 0).getDate();
                      const offset = (firstDay + 6) % 7;
                      const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
                      while (cells.length % 7 !== 0) cells.push(null);
                      return cells.map((day, idx) => {
                        if (!day) return <div key={idx} />;
                        const iso = `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const isPresent = detailPresentDates.has(iso);
                        const isFuture = iso > today;
                        const isSun = new Date(iso + 'T00:00:00').getDay() === 0;
                        return (
                          <div key={idx} className={`flex aspect-square items-center justify-center rounded text-[9px] font-medium
                            ${isPresent ? 'bg-emerald-500 text-white' : isFuture || isSun ? 'text-slate-200 dark:text-slate-700' : 'bg-red-50 text-red-400 dark:bg-red-900/20'}
                            ${iso === today ? 'ring-1 ring-indigo-500' : ''}`}>
                            {day}
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Recent check-ins */}
                  {(detailData?.records ?? []).length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Recent</p>
                      <div className="space-y-1.5">
                        {[...(detailData?.records ?? [])].reverse().slice(0, 5).map((r) => (
                          <div key={r.date} className="flex items-center justify-between text-xs">
                            <span className="text-slate-600 dark:text-slate-400">
                              {new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                            </span>
                            <span className="tabular-nums text-slate-400">
                              {new Date(r.checkInTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
