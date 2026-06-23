'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { TeamSubNav } from '@/components/layout/TeamSubNav';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────────
interface AttendanceSummaryEntry {
  userId: string;
  daysPresent: number;
  daysInMonth: number;
  attendancePct: number;
  presentDates?: string[];
  avgCheckIn?: string | null;
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

interface LeaveRequest {
  leaveId: string;
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  startDate: string;
  endDate: string;
  reason: string;
  type: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reviewNote?: string | null;
  reviewedAt?: string | null;
}

const LEAVE_TYPES = ['casual', 'sick', 'earned', 'halfday', 'wfh'] as const;
const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: 'Casual', sick: 'Sick', earned: 'Earned', halfday: 'Half Day', wfh: 'WFH',
};

const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
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
function leaveDays(leave: LeaveRequest) {
  const a = new Date(leave.startDate + 'T00:00:00');
  const b = new Date(leave.endDate + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateRange(start: string, end: string) {
  if (start === end) return fmtDate(start);
  return `${new Date(start + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${fmtDate(end)}`;
}

function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function AdminAttendancePage() {
  const queryClient = useQueryClient();
  const [month, setMonth]                 = useState(currentMonthStr());
  const [search, setSearch]               = useState('');
  const [selectedUser, setSelectedUser]   = useState<string | null>(null);
  const [leaveTab, setLeaveTab]           = useState<'pending' | 'all' | 'summary'>('pending');
  const [reviewingLeave, setReviewingLeave] = useState<LeaveRequest | null>(null);
  const [reviewNote, setReviewNote]       = useState('');
  const isCurrentMonth = month === currentMonthStr();
  const today = new Date().toISOString().slice(0, 10);

  // ── Queries ──
  const { data: summaryData, isLoading } = useQuery({
    queryKey: ['admin-attendance', month],
    queryFn: () => apiFetch<AdminAttendanceResponse>(`/api/attendance?month=${month}`),
    staleTime: 2 * 60_000,
  });

  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ success: boolean; employees: EmployeeRecord[] }>('/api/admin/employees')
      .catch(() => ({ success: true, employees: [] })),
    staleTime: 10 * 60_000,
  });

  const { data: detailData } = useQuery({
    queryKey: ['admin-attendance-detail', selectedUser, month],
    queryFn: () => apiFetch<UserAttendanceDetail>(`/api/attendance/${selectedUser}?month=${month}`),
    enabled: !!selectedUser,
    staleTime: 60_000,
  });

  const { data: leavesData, isLoading: leavesLoading } = useQuery({
    queryKey: ['admin-leaves', leaveTab],
    queryFn: () => apiFetch<{ success: boolean; leaves: LeaveRequest[] }>(
      `/api/attendance/leave/admin${leaveTab === 'pending' ? '?status=pending' : ''}`
    ),
    enabled: leaveTab !== 'summary',
    staleTime: 60_000,
  });

  // Always-fetched for leave summary tab
  const { data: allLeavesData } = useQuery({
    queryKey: ['admin-leaves-all'],
    queryFn: () => apiFetch<{ success: boolean; leaves: LeaveRequest[] }>('/api/attendance/leave/admin'),
    staleTime: 60_000,
  });

  // ── Review mutation ──
  const reviewMutation = useMutation({
    mutationFn: ({ leave, status }: { leave: LeaveRequest; status: 'approved' | 'rejected' }) =>
      apiFetch(`/api/attendance/leave/${leave.userId}/${leave.leaveId}`, {
        method: 'PUT',
        body: JSON.stringify({ status, reviewNote: reviewNote.trim() || null }),
      }),
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-leaves'] });
      queryClient.invalidateQueries({ queryKey: ['admin-leaves-all'] });
      setReviewingLeave(null);
      setReviewNote('');
      toast.success(`Leave ${status === 'approved' ? 'approved' : 'rejected'} successfully`);
    },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to review leave'),
  });

  // ── Derived data ──
  const empMap = Object.fromEntries((empData?.employees ?? []).map((e) => [e.id, e]));
  const days   = buildDays(month);
  const summary = summaryData?.summary ?? [];

  const allEmployeeIds = (empData?.employees ?? [])
    .filter(e => ['agent', 'telecaller', 'intern', 'team_lead'].includes(e.role) && e.status !== 'inactive')
    .map(e => e.id);

  const summaryMap = Object.fromEntries(summary.map(s => [s.userId, s]));
  const fullList   = allEmployeeIds.map(id => summaryMap[id] ?? {
    userId: id, daysPresent: 0, daysInMonth: summaryData?.daysInMonth ?? days.length,
    attendancePct: 0, presentDates: [], avgCheckIn: null,
  });

  const filtered = fullList.filter(e => {
    if (!search) return true;
    const emp = empMap[e.userId];
    const q = search.toLowerCase();
    return emp?.name?.toLowerCase().includes(q) || emp?.email?.toLowerCase().includes(q);
  }).sort((a, b) => b.attendancePct - a.attendancePct);

  const detailPresentDates = new Set((detailData?.records ?? []).map(r => r.date));

  const avgAttendance = filtered.length > 0
    ? Math.round(filtered.reduce((s, e) => s + e.attendancePct, 0) / filtered.length) : 0;
  const fullAttendance = filtered.filter(e => e.attendancePct === 100).length;
  const absent = filtered.filter(e => e.daysPresent === 0).length;

  // ── Leave summary pivot ──
  const leaveSummary = (() => {
    const all = allLeavesData?.leaves ?? [];
    const byEmp: Record<string, Record<string, number>> = {};
    for (const leave of all) {
      if (leave.status === 'rejected') continue;
      if (!byEmp[leave.userId]) byEmp[leave.userId] = {};
      const t = leave.type ?? 'casual';
      byEmp[leave.userId][t] = (byEmp[leave.userId][t] ?? 0) + leaveDays(leave);
    }
    return Object.entries(byEmp).map(([userId, types]) => ({
      userId,
      ...Object.fromEntries(LEAVE_TYPES.map(t => [t, types[t] ?? 0])),
      total: LEAVE_TYPES.reduce((s, t) => s + (types[t] ?? 0), 0),
    })).sort((a, b) => (b as any).total - (a as any).total);
  })();

  // ── Pending count badge ──
  const pendingCount = (leavesData?.leaves ?? []).filter(l => l.status === 'pending').length;

  // ── CSV export handlers ──
  const exportAttendanceCSV = () => {
    const headers = ['Name', 'Role', 'Days Present', 'Days in Month', 'Attendance %', 'Avg Check-in'];
    const rows = filtered.map(e => {
      const emp = empMap[e.userId];
      return [emp?.name ?? e.userId, emp?.role ?? '', String(e.daysPresent), String(e.daysInMonth), `${e.attendancePct}%`, e.avgCheckIn ?? '-'];
    });
    downloadCSV([headers, ...rows], `attendance-${month}.csv`);
  };

  const exportLeavesCSV = () => {
    const headers = ['Employee', 'Role', ...LEAVE_TYPES.map(t => LEAVE_TYPE_LABELS[t]), 'Total Days'];
    const rows = leaveSummary.map(e => {
      const emp = empMap[e.userId];
      return [emp?.name ?? e.userId, emp?.role ?? '', ...LEAVE_TYPES.map(t => String((e as any)[t])), String(e.total)];
    });
    downloadCSV([headers, ...rows], `leaves-${month}.csv`);
  };

  return (
    <>
      <Navbar title="Attendance" showBack />
      <TeamSubNav />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl space-y-6 p-6">

          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Team Attendance</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{filtered.length} employees · {monthLabel(month)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exportAttendanceCSV}
                disabled={filtered.length === 0}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                ↓ Export CSV
              </button>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-1 dark:border-slate-700 dark:bg-slate-900">
                <button onClick={() => setMonth(prevMonth(month))} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">‹</button>
                <input
                  type="month" value={month}
                  onChange={e => e.target.value && setMonth(e.target.value)}
                  className="border-0 bg-transparent text-sm font-medium text-slate-700 outline-none dark:text-slate-300"
                />
                <button onClick={() => setMonth(nextMonth(month))} disabled={isCurrentMonth} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">›</button>
              </div>
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
                onChange={e => setSearch(e.target.value)}
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
                          <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">Avg In</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 min-w-40">This Month</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                        {filtered.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-16 text-center text-sm text-slate-400">
                              No attendance data for this month
                            </td>
                          </tr>
                        ) : filtered.map(entry => {
                          const emp = empMap[entry.userId];
                          const isSelected = selectedUser === entry.userId;
                          const presentSet = new Set(entry.presentDates ?? []);
                          return (
                            <tr
                              key={entry.userId}
                              onClick={() => setSelectedUser(isSelected ? null : entry.userId)}
                              className={`cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                            >
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-900 dark:text-white">{emp?.name ?? entry.userId}</p>
                                <p className="text-xs capitalize text-slate-400">{emp?.role}</p>
                              </td>
                              <td className="px-4 py-3 text-center tabular-nums">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">{entry.daysPresent}</span>
                                <span className="text-slate-400">/{entry.daysInMonth}</span>
                              </td>
                              <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-500">
                                {entry.avgCheckIn ?? '—'}
                              </td>
                              <td className="px-4 py-3">
                                {/* Per-day dot chart — green = present, red = absent, grey = future/sunday */}
                                <div className="flex flex-wrap gap-0.5">
                                  {days.map(date => {
                                    const isFuture  = date > today;
                                    const isSun     = new Date(date + 'T00:00:00').getDay() === 0;
                                    const isPresent = presentSet.has(date);
                                    return (
                                      <div
                                        key={date}
                                        title={date}
                                        className={`h-2 w-2 rounded-sm ${
                                          isFuture || isSun
                                            ? 'bg-slate-100 dark:bg-slate-800'
                                            : isPresent
                                              ? 'bg-emerald-400'
                                              : 'bg-red-200 dark:bg-red-900/40'
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

                  {/* Avg check-in time */}
                  {summaryMap[selectedUser]?.avgCheckIn && (
                    <div className="mb-4 rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-800">
                      <p className="text-lg font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                        {summaryMap[selectedUser].avgCheckIn}
                      </p>
                      <p className="text-[10px] text-slate-400">Avg Check-in</p>
                    </div>
                  )}

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
                        const iso = `${month}-${String(day).padStart(2, '0')}`;
                        const isPresent = detailPresentDates.has(iso);
                        const isFuture  = iso > today;
                        const isSun     = new Date(iso + 'T00:00:00').getDay() === 0;
                        return (
                          <div key={idx} className={`flex aspect-square items-center justify-center rounded text-[9px] font-medium
                            ${isPresent ? 'bg-emerald-500 text-white'
                              : isFuture || isSun ? 'text-slate-200 dark:text-slate-700'
                              : 'bg-red-50 text-red-400 dark:bg-red-900/20'}
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
                        {[...(detailData?.records ?? [])].reverse().slice(0, 5).map(r => (
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

          {/* ── Leave Management ──────────────────────────────────────────────── */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Leave Requests</h2>
                {leaveTab === 'pending' && pendingCount > 0 && (
                  <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">
                    {pendingCount} pending
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {leaveTab === 'summary' && (
                  <button
                    onClick={exportLeavesCSV}
                    disabled={leaveSummary.length === 0}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    ↓ Export CSV
                  </button>
                )}
                <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                  {(['pending', 'all', 'summary'] as const).map(tab => (
                    <button key={tab} onClick={() => setLeaveTab(tab)}
                      className={`rounded px-3 py-1 text-xs font-semibold capitalize transition ${
                        leaveTab === tab ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {tab === 'summary' ? 'Report' : tab === 'pending' ? 'Pending' : 'All'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Leave Summary / Report tab ── */}
            {leaveTab === 'summary' ? (
              <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                {leaveSummary.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-400">No approved / pending leaves found</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Employee</th>
                          {LEAVE_TYPES.map(t => (
                            <th key={t} className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
                              {LEAVE_TYPE_LABELS[t]}
                            </th>
                          ))}
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Total Days</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                        {leaveSummary.map(row => {
                          const emp = empMap[row.userId];
                          return (
                            <tr key={row.userId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <td className="px-4 py-2.5">
                                <p className="font-medium text-slate-800 dark:text-white">{emp?.name ?? row.userId}</p>
                                <p className="text-xs capitalize text-slate-400">{emp?.role}</p>
                              </td>
                              {LEAVE_TYPES.map(t => (
                                <td key={t} className="px-3 py-2.5 text-center tabular-nums text-slate-600 dark:text-slate-300">
                                  {(row as any)[t] > 0 ? (row as any)[t] : <span className="text-slate-300">—</span>}
                                </td>
                              ))}
                              <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-800 dark:text-white">
                                {row.total}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                          <td className="px-4 py-2.5 text-xs font-semibold text-slate-500">Total</td>
                          {LEAVE_TYPES.map(t => (
                            <td key={t} className="px-3 py-2.5 text-center text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                              {leaveSummary.reduce((s, r) => s + ((r as any)[t] ?? 0), 0) || '—'}
                            </td>
                          ))}
                          <td className="px-4 py-2.5 text-right text-xs font-bold tabular-nums text-slate-800 dark:text-white">
                            {leaveSummary.reduce((s, r) => s + r.total, 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

            ) : leavesLoading ? (
              <Loading size="sm" />
            ) : (leavesData?.leaves ?? []).length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm text-slate-400">
                  {leaveTab === 'pending' ? 'No pending leave requests' : 'No leave requests found'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {(leavesData?.leaves ?? []).map(leave => (
                  <div key={leave.leaveId} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {leave.userName ?? empMap[leave.userId]?.name ?? leave.userId}
                          </p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${LEAVE_STATUS_COLORS[leave.status]}`}>
                            {leave.status === 'pending' ? '⏳ Pending' : leave.status === 'approved' ? '✓ Approved' : '✕ Rejected'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          {fmtDateRange(leave.startDate, leave.endDate)}
                          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] capitalize text-slate-500 dark:bg-slate-800">
                            {LEAVE_TYPE_LABELS[leave.type] ?? leave.type}
                          </span>
                          <span className="ml-1 text-[10px] text-slate-400">{leaveDays(leave)} day{leaveDays(leave) > 1 ? 's' : ''}</span>
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{leave.reason}</p>
                        {leave.reviewNote && (
                          <p className="mt-1 text-xs italic text-slate-400">Note: {leave.reviewNote}</p>
                        )}
                      </div>
                      {leave.status === 'pending' && (
                        <button
                          onClick={() => { setReviewingLeave(leave); setReviewNote(''); }}
                          className="flex-shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                        >
                          Review
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Review Modal ──────────────────────────────────────────────────── */}
          {reviewingLeave && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Review Leave Request</h3>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {reviewingLeave.userName ?? reviewingLeave.userId} · {fmtDateRange(reviewingLeave.startDate, reviewingLeave.endDate)}
                      {' '}· {leaveDays(reviewingLeave)} day{leaveDays(reviewingLeave) > 1 ? 's' : ''}
                    </p>
                  </div>
                  <button onClick={() => setReviewingLeave(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>

                <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 capitalize dark:bg-slate-700">
                      {LEAVE_TYPE_LABELS[reviewingLeave.type] ?? reviewingLeave.type}
                    </span>
                    <span>Applied {new Date(reviewingLeave.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{reviewingLeave.reason}</p>
                </div>

                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">Note for employee (optional)</label>
                  <textarea
                    value={reviewNote}
                    onChange={e => setReviewNote(e.target.value)}
                    placeholder="Add a note…"
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {reviewMutation.isError && (
                  <p className="mb-3 text-sm text-red-500">{(reviewMutation.error as Error)?.message ?? 'Action failed'}</p>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => reviewMutation.mutate({ leave: reviewingLeave, status: 'rejected' })}
                    disabled={reviewMutation.isPending}
                    className="flex-1 rounded-lg border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => reviewMutation.mutate({ leave: reviewingLeave, status: 'approved' })}
                    disabled={reviewMutation.isPending}
                    className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {reviewMutation.isPending ? 'Saving…' : 'Approve'}
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
