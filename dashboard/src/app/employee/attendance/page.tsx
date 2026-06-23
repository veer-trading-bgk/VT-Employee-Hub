'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface AttendanceRecord {
  date: string;
  checkInTime: string;
  source: string;
}

interface AttendanceResponse {
  success: boolean;
  userId: string;
  month: string;
  daysPresent: number;
  daysInMonth: number;
  attendancePct: number;
  records: AttendanceRecord[];
}

interface LeaveRequest {
  leaveId: string;
  startDate: string;
  endDate: string;
  reason: string;
  type: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reviewNote?: string | null;
}

const LEAVE_TYPES = [
  { key: 'casual',   label: 'Casual Leave' },
  { key: 'sick',     label: 'Sick Leave' },
  { key: 'earned',   label: 'Earned Leave' },
  { key: 'halfday',  label: 'Half Day' },
  { key: 'wfh',      label: 'Work From Home' },
];

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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildCalendar(month: string) {
  const [y, mo] = month.split('-').map(Number);
  const firstDay = new Date(y, mo - 1, 1).getDay();
  const daysInMonth = new Date(y, mo, 0).getDate();
  const startOffset = (firstDay + 6) % 7;
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function leaveStatusChip(status: LeaveRequest['status']) {
  if (status === 'approved')  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  if (status === 'rejected')  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
}

function leaveStatusLabel(status: LeaveRequest['status']) {
  if (status === 'approved') return '✓ Approved';
  if (status === 'rejected') return '✕ Rejected';
  return '⏳ Pending';
}

function dateRange(start: string, end: string) {
  if (start === end) return new Date(start + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${new Date(start + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(end + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

export default function EmployeeAttendancePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonthStr());
  const isCurrentMonth = month === currentMonthStr();
  const today = todayISO();

  // Leave form state
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    startDate: today,
    endDate: today,
    type: 'casual',
    reason: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['emp-attendance', user?.id, month],
    queryFn: () => apiFetch<AttendanceResponse>(`/api/attendance/${user?.id}?month=${month}`),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const { data: leaveData, isLoading: leaveLoading } = useQuery({
    queryKey: ['emp-leaves', user?.id],
    queryFn: () => apiFetch<{ success: boolean; leaves: LeaveRequest[] }>('/api/attendance/leave'),
    enabled: !!user?.id,
    staleTime: 2 * 60_000,
  });

  const markMutation = useMutation({
    mutationFn: () => apiFetch('/api/attendance/mark', { method: 'POST', body: JSON.stringify({ source: 'manual' }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emp-attendance', user?.id, month] }),
  });

  const leaveMutation = useMutation({
    mutationFn: (body: typeof leaveForm) =>
      apiFetch('/api/attendance/leave', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emp-leaves', user?.id] });
      setShowLeaveForm(false);
      setLeaveForm({ startDate: today, endDate: today, type: 'casual', reason: '' });
    },
  });

  const presentDates = new Set((data?.records ?? []).map((r) => r.date));
  const alreadyMarkedToday = presentDates.has(today);
  const calendar = buildCalendar(month);

  const streak = (() => {
    let count = 0;
    const d = new Date(today);
    while (true) {
      const iso = d.toISOString().slice(0, 10);
      if (!presentDates.has(iso)) break;
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  })();

  const leaves = leaveData?.leaves ?? [];
  const pendingLeaves = leaves.filter((l) => l.status === 'pending').length;

  const handleLeaveSubmit = () => {
    if (!leaveForm.reason.trim()) return;
    if (leaveForm.startDate > leaveForm.endDate) return;
    leaveMutation.mutate(leaveForm);
  };

  return (
    <>
      <Navbar title="My Attendance" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-lg space-y-5 p-4 pb-10">

          {/* Month nav */}
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-slate-900 dark:text-white">My Attendance</h1>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-1 dark:border-slate-700 dark:bg-slate-900">
              <button onClick={() => setMonth(prevMonth(month))} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">‹</button>
              <span className="min-w-32 text-center text-sm font-medium text-slate-700 dark:text-slate-300">{monthLabel(month)}</span>
              <button onClick={() => setMonth(nextMonth(month))} disabled={isCurrentMonth} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">›</button>
            </div>
          </div>

          {/* Check-in button */}
          {isCurrentMonth && (
            <button
              onClick={() => markMutation.mutate()}
              disabled={alreadyMarkedToday || markMutation.isPending}
              className={`w-full rounded-2xl py-4 text-base font-semibold transition-all ${
                alreadyMarkedToday
                  ? 'bg-emerald-50 text-emerald-600 border-2 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400 cursor-default'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-md shadow-indigo-200 dark:shadow-indigo-900'
              }`}
            >
              {alreadyMarkedToday
                ? `✓ Marked Present Today · ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}`
                : markMutation.isPending
                  ? 'Marking…'
                  : `Mark Present Today · ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}`}
            </button>
          )}

          {/* Stats */}
          {isLoading ? (
            <div className="flex justify-center py-12"><Loading /></div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{data?.daysPresent ?? 0}</p>
                  <p className="mt-0.5 text-xs text-slate-500">Days Present</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{data?.attendancePct ?? 0}%</p>
                  <p className="mt-0.5 text-xs text-slate-500">Attendance</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{streak}</p>
                  <p className="mt-0.5 text-xs text-slate-500">Day Streak</p>
                </div>
              </div>

              {/* Calendar */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-2 grid grid-cols-7 text-center">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                    <p key={d} className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{d}</p>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calendar.map((day, idx) => {
                    if (day === null) return <div key={idx} />;
                    const [y, mo] = month.split('-').map(Number);
                    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isPresent = presentDates.has(iso);
                    const isToday = iso === today;
                    const isFuture = iso > today;
                    const isSunday = (new Date(iso).getDay() === 0);
                    return (
                      <div key={idx}
                        className={`flex aspect-square items-center justify-center rounded-lg text-xs font-medium
                          ${isPresent ? 'bg-emerald-500 text-white'
                            : isFuture ? 'text-slate-300 dark:text-slate-700'
                            : isSunday ? 'text-slate-300 dark:text-slate-700'
                            : 'bg-red-50 text-red-400 dark:bg-red-900/20 dark:text-red-500'}
                          ${isToday ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                      >
                        {day}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Present</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-100 dark:bg-red-900/30" /> Absent</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm ring-2 ring-indigo-500" /> Today</span>
                </div>
              </div>

              {/* Recent check-ins */}
              {(data?.records ?? []).length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <p className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800">
                    Recent Check-ins
                  </p>
                  <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
                    {[...(data?.records ?? [])].reverse().slice(0, 7).map((r) => (
                      <div key={r.date} className="flex items-center justify-between px-4 py-2.5">
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          {new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.source === 'login' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                            {r.source}
                          </span>
                          <p className="text-xs tabular-nums text-slate-400">
                            {new Date(r.checkInTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Leave Request Section ─────────────────────────────────────── */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Leave Requests</h2>
                {pendingLeaves > 0 && (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
                    {pendingLeaves} pending
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowLeaveForm((v) => !v)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                {showLeaveForm ? 'Cancel' : '+ Apply Leave'}
              </button>
            </div>

            {/* Leave form */}
            {showLeaveForm && (
              <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-3 dark:border-indigo-900/50 dark:bg-indigo-950/20">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">From</label>
                    <input type="date" value={leaveForm.startDate}
                      onChange={(e) => setLeaveForm((f) => ({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate }))}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">To</label>
                    <input type="date" value={leaveForm.endDate}
                      min={leaveForm.startDate}
                      onChange={(e) => setLeaveForm((f) => ({ ...f, endDate: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Leave Type</label>
                  <select value={leaveForm.type}
                    onChange={(e) => setLeaveForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                    {LEAVE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Reason</label>
                  <textarea
                    value={leaveForm.reason}
                    onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder="Brief reason for leave…"
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <button
                  onClick={handleLeaveSubmit}
                  disabled={!leaveForm.reason.trim() || leaveMutation.isPending}
                  className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {leaveMutation.isPending ? 'Submitting…' : 'Submit Leave Request'}
                </button>
                {leaveMutation.isError && (
                  <p className="text-xs text-red-500 text-center">Failed to submit. Please try again.</p>
                )}
              </div>
            )}

            {/* Leave history */}
            {leaveLoading ? (
              <Loading size="sm" />
            ) : leaves.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm text-slate-400">No leave requests yet</p>
                <p className="mt-1 text-xs text-slate-400">Your applied leaves will appear here</p>
              </div>
            ) : (
              <div className="space-y-2">
                {leaves.map((leave) => (
                  <div key={leave.leaveId} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {dateRange(leave.startDate, leave.endDate)}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">
                            {LEAVE_TYPES.find((t) => t.key === leave.type)?.label ?? leave.type}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{leave.reason}</p>
                        {leave.reviewNote && (
                          <p className="mt-1 text-xs text-slate-400 italic">Note: {leave.reviewNote}</p>
                        )}
                      </div>
                      <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${leaveStatusChip(leave.status)}`}>
                        {leaveStatusLabel(leave.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
