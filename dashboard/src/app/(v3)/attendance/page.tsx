'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Search, CheckCircle2, XCircle, Clock, Download } from 'lucide-react';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { canAssignOwner } from '@/lib/permissions';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface EmployeeRecord { id: string; name: string; email: string; role: string; status: string; }

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
}

interface MyAttendanceResponse {
  success: boolean;
  daysPresent: number;
  daysInMonth: number;
  attendancePct: number;
  records: { date: string; checkInTime: string; source: string }[];
  leaveBalance?: { casual: number; sick: number; earned: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}
function adjMonth(m: string, delta: number) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
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
  if (pct >= 90) return 'text-success-600';
  if (pct >= 70) return 'text-warning-600';
  return 'text-error-500';
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function fmtTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function approvedLeaveDates(leaves: LeaveRequest[]): Set<string> {
  const out = new Set<string>();
  for (const leave of leaves) {
    if (leave.status !== 'approved') continue;
    for (let d = new Date(leave.startDate + 'T00:00:00'); d <= new Date(leave.endDate + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
      out.add(d.toISOString().slice(0, 10));
    }
  }
  return out;
}

// ── Month nav ─────────────────────────────────────────────────────────────────

function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const isCurrentMonth = month === currentMonthStr();
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(adjMonth(month, -1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[140px] text-center text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {monthLabel(month)}
      </span>
      <button onClick={() => onChange(adjMonth(month, 1))} disabled={isCurrentMonth} className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-30 dark:border-neutral-700 dark:hover:bg-neutral-800">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Calendar heat-map ──────────────────────────────────────────────────────────

function CalendarHeatmap({ month, presentDates, leaveDates }: { month: string; presentDates: Set<string>; leaveDates?: Set<string> }) {
  const days = buildDays(month);
  const today = new Date().toISOString().slice(0, 10);
  // Start weekday (0=Sun)
  const [y, mo] = month.split('-').map(Number);
  const startDow = new Date(y, mo - 1, 1).getDay();
  const cells = [...Array(startDow).fill(null), ...days];

  return (
    <div className="grid grid-cols-7 gap-1 text-[10px]">
      {['S','M','T','W','T','F','S'].map((d, i) => (
        <div key={i} className="text-center font-semibold text-neutral-400">{d}</div>
      ))}
      {cells.map((date, i) => {
        if (!date) return <div key={`empty-${i}`} />;
        const present = presentDates.has(date);
        const onLeave = !present && (leaveDates?.has(date) ?? false);
        const future  = date > today;
        const isToday = date === today;
        return (
          <div
            key={date}
            title={`${date}${future ? '' : onLeave ? ' — On leave' : present ? ' — Present' : ' — Absent'}`}
            className={cn(
              'aspect-square rounded flex items-center justify-center text-[9px] font-medium',
              future  ? 'text-neutral-200 dark:text-neutral-800' :
              present ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400' :
              onLeave ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400' :
                        'bg-neutral-100 text-neutral-400 dark:bg-neutral-800',
              isToday && 'ring-1 ring-primary-600',
            )}
          >
            {new Date(date + 'T00:00:00').getDate()}
          </div>
        );
      })}
    </div>
  );
}

function CalendarLegend() {
  return (
    <div className="mt-3 flex items-center gap-4 text-[11px] text-neutral-500">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success-100 dark:bg-success-900/30" /> Present</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary-100 dark:bg-primary-900/30" /> On leave</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-neutral-100 dark:bg-neutral-800" /> Absent</span>
    </div>
  );
}

// ── Leave form ─────────────────────────────────────────────────────────────────

const LEAVE_TYPES = ['casual', 'sick', 'earned', 'halfday', 'wfh'] as const;
const LEAVE_LABELS: Record<string, string> = {
  casual: 'Casual', sick: 'Sick', earned: 'Earned', halfday: 'Half Day', wfh: 'WFH',
};

function ApplyLeaveForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({ type: 'casual', startDate: '', endDate: '', reason: '' });
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => apiFetch('/api/attendance/leave', {
      method: 'POST',
      body: JSON.stringify(form),
    }),
    onSuccess: () => {
      toast.success('Leave request submitted');
      qc.invalidateQueries({ queryKey: ['my-leaves'] });
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Type</label>
          <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
            {LEAVE_TYPES.map((t) => <option key={t} value={t}>{LEAVE_LABELS[t]}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">From</label>
          <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
            className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">To</label>
          <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            min={form.startDate}
            className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200" />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Reason</label>
          <textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            rows={2} placeholder="Brief reason…"
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200" />
        </div>
      </div>
      <Button
        onClick={() => mutation.mutate()}
        loading={mutation.isPending}
        disabled={!form.startDate || !form.endDate || !form.reason.trim()}
        size="sm"
      >
        Submit Leave Request
      </Button>
    </div>
  );
}

// ── Employee view ─────────────────────────────────────────────────────────────

function EmployeeAttendanceView() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonthStr());
  const [showLeaveForm, setShowLeaveForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['my-attendance', month],
    queryFn: () => apiFetch<MyAttendanceResponse>(`/api/attendance/${user!.id}?month=${month}`),
    enabled: !!user?.id,
    staleTime: 2 * 60_000,
  });

  const { data: leavesData } = useQuery({
    queryKey: ['my-leaves'],
    queryFn: () => apiFetch<{ success: boolean; leaves: LeaveRequest[] }>('/api/attendance/leave'),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const presentDates = new Set((data?.records ?? []).map((r) => r.date));
  const myLeaves = leavesData?.leaves ?? [];
  const leaveDates = approvedLeaveDates(myLeaves);

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: 'Days Present',  value: isLoading ? '…' : String(data?.daysPresent ?? 0) },
          { label: 'Days in Month', value: isLoading ? '…' : String(data?.daysInMonth ?? 0) },
          { label: 'Attendance %',  value: isLoading ? '…' : `${data?.attendancePct ?? 0}%`, color: pctColor(data?.attendancePct ?? 0) },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <p className={cn('text-2xl font-bold', color ?? 'text-neutral-900 dark:text-neutral-100')}>{value}</p>
            <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* Calendar */}
      <Card noPadding>
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Attendance Calendar</p>
          <MonthNav month={month} onChange={setMonth} />
        </div>
        <div className="p-4">
          {isLoading ? <Skeleton className="h-40 w-full" /> : (
            <>
              <CalendarHeatmap month={month} presentDates={presentDates} leaveDates={leaveDates} />
              <CalendarLegend />
            </>
          )}
        </div>
      </Card>

      {/* Leave requests */}
      <Card noPadding>
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Leave Requests</p>
          <Button size="sm" variant="secondary" onClick={() => setShowLeaveForm((v) => !v)}>
            {showLeaveForm ? 'Cancel' : '+ Apply Leave'}
          </Button>
        </div>
        {showLeaveForm && (
          <div className="border-b border-neutral-100 p-4 dark:border-neutral-800">
            <ApplyLeaveForm onSuccess={() => setShowLeaveForm(false)} />
          </div>
        )}
        {myLeaves.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">No leave requests</div>
        ) : (
          <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
            {myLeaves.map((leave) => (
              <li key={leave.leaveId} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {LEAVE_LABELS[leave.type] ?? leave.type}
                    <span className="ml-2 text-xs text-neutral-400">
                      {fmtDate(leave.startDate)}{leave.startDate !== leave.endDate ? ` – ${fmtDate(leave.endDate)}` : ''}
                    </span>
                  </p>
                  <p className="text-xs text-neutral-400 truncate">{leave.reason}</p>
                </div>
                <Badge variant={leave.status === 'approved' ? 'success' : leave.status === 'rejected' ? 'error' : 'warning'}>
                  {leave.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Admin/Manager view ────────────────────────────────────────────────────────

function AdminAttendanceView() {
  const qc = useQueryClient();
  const [month, setMonth]               = useState(currentMonthStr());
  const [search, setSearch]             = useState('');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [leaveTab, setLeaveTab]         = useState<'pending' | 'all'>('pending');
  const [reviewingLeave, setReviewingLeave] = useState<LeaveRequest | null>(null);
  const [reviewNote, setReviewNote]     = useState('');

  const { data: summaryData, isLoading } = useQuery({
    queryKey: ['admin-attendance', month],
    queryFn: () => apiFetch<AdminAttendanceResponse>(`/api/attendance?month=${month}`),
    staleTime: 2 * 60_000,
  });

  const { data: empData } = useQuery({
    queryKey: ['v3-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/admin/employees')
      .catch(() => ({ success: true, data: [] as EmployeeRecord[] })),
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
    staleTime: 60_000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ leave, status }: { leave: LeaveRequest; status: 'approved' | 'rejected' }) =>
      apiFetch(`/api/attendance/leave/${leave.userId}/${leave.leaveId}`, {
        method: 'PUT',
        body: JSON.stringify({ status, reviewNote: reviewNote.trim() || null }),
      }),
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ['admin-leaves'] });
      setReviewingLeave(null);
      setReviewNote('');
      toast.success(`Leave ${status === 'approved' ? 'approved' : 'rejected'}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const empMap = Object.fromEntries((empData?.data ?? []).map((e) => [e.id, e]));
  const summary = summaryData?.summary ?? [];

  const allIds = (empData?.data ?? [])
    .filter((e) => ['agent', 'telecaller', 'intern', 'team_lead', 'manager'].includes(e.role) && e.status !== 'inactive')
    .map((e) => e.id);

  const summaryMap = Object.fromEntries(summary.map((s) => [s.userId, s]));
  const fullList = allIds.map((id) => summaryMap[id] ?? {
    userId: id, daysPresent: 0,
    daysInMonth: summaryData?.daysInMonth ?? 0,
    attendancePct: 0, presentDates: [],
  });

  const filtered = fullList.filter((e) => {
    if (!search) return true;
    const emp = empMap[e.userId];
    const q = search.toLowerCase();
    return emp?.name?.toLowerCase().includes(q) || emp?.email?.toLowerCase().includes(q);
  }).sort((a, b) => b.attendancePct - a.attendancePct);

  const avgPct = filtered.length > 0
    ? Math.round(filtered.reduce((s, e) => s + e.attendancePct, 0) / filtered.length) : 0;
  const fullAttendance = filtered.filter((e) => e.attendancePct === 100).length;

  const detailPresentDates = new Set((detailData?.records ?? []).map((r) => r.date));
  const leaves = leavesData?.leaves ?? [];
  const detailLeaveDates = approvedLeaveDates(leaves.filter((l) => l.userId === selectedUser));
  const selectedAvgCheckIn = selectedUser ? summaryMap[selectedUser]?.avgCheckIn : null;

  const exportCSV = () => {
    const rows = [['Name', 'Email', 'Days Present', 'Days in Month', 'Attendance %']];
    filtered.forEach((e) => {
      const emp = empMap[e.userId];
      rows.push([emp?.name ?? e.userId, emp?.email ?? '', String(e.daysPresent), String(e.daysInMonth), String(e.attendancePct)]);
    });
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `attendance_${month}.csv`;
    a.click();
  };

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card><p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{isLoading ? '…' : filtered.length}</p><p className="text-xs text-neutral-500 mt-0.5">Team size</p></Card>
        <Card><p className={cn('text-2xl font-bold', isLoading ? 'text-neutral-900 dark:text-neutral-100' : pctColor(avgPct))}>{isLoading ? '…' : `${avgPct}%`}</p><p className="text-xs text-neutral-500 mt-0.5">Avg attendance</p></Card>
        <Card><p className="text-2xl font-bold text-success-600">{isLoading ? '…' : fullAttendance}</p><p className="text-xs text-neutral-500 mt-0.5">Perfect attendance</p></Card>
      </div>

      {/* Team table */}
      <Card noPadding>
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Team Attendance</p>
            <MonthNav month={month} onChange={setMonth} />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-8 rounded-lg border border-neutral-200 bg-neutral-50 pl-7 pr-3 text-xs focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <Button size="sm" variant="ghost" iconLeft={<Download className="h-3.5 w-3.5" />} onClick={exportCSV}>CSV</Button>
          </div>
        </div>

        {isLoading ? (
          <div className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
            {[0,1,2,3,4].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-12 ml-auto" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">No attendance data for this period</div>
        ) : (
          <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
            {filtered.map((e) => {
              const emp = empMap[e.userId];
              return (
                <li
                  key={e.userId}
                  onClick={() => setSelectedUser(e.userId === selectedUser ? null : e.userId)}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30"
                >
                  <Avatar name={emp?.name ?? e.userId} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{emp?.name ?? e.userId}</p>
                    <p className="text-xs text-neutral-400 truncate">{emp?.email}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn('text-sm font-bold tabular-nums', pctColor(e.attendancePct))}>{e.attendancePct}%</p>
                    <p className="text-[10px] text-neutral-400">{e.daysPresent}/{e.daysInMonth} days</p>
                    {e.avgCheckIn && <p className="text-[10px] text-neutral-400">Avg in {fmtTime(e.avgCheckIn)}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Expanded detail */}
        {selectedUser && (
          <div className="border-t border-neutral-100 p-4 dark:border-neutral-800">
            <p className="mb-3 text-xs font-semibold text-neutral-500">
              Detail: {empMap[selectedUser]?.name ?? selectedUser}
              {selectedAvgCheckIn && ` · Avg check-in ${fmtTime(selectedAvgCheckIn)}`}
            </p>
            <CalendarHeatmap month={month} presentDates={detailPresentDates} leaveDates={detailLeaveDates} />
            <CalendarLegend />
          </div>
        )}
      </Card>

      {/* Leave approvals */}
      <Card noPadding>
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Leave Requests</p>
          <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
            {(['pending', 'all'] as const).map((t) => (
              <button key={t} onClick={() => setLeaveTab(t)}
                className={cn('rounded-md px-3 py-1 text-xs font-medium transition', leaveTab === t ? 'bg-primary-600 text-white' : 'text-neutral-500')}>
                {t === 'pending' ? 'Pending' : 'All'}
              </button>
            ))}
          </div>
        </div>
        {leavesLoading ? (
          <div className="divide-y divide-neutral-50 dark:divide-neutral-800">
            {[0,1,2].map((i) => <div key={i} className="flex items-center gap-3 px-4 py-3"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-3 w-40" /><Skeleton className="h-6 w-16 ml-auto rounded-lg" /></div>)}
          </div>
        ) : leaves.length === 0 ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-success-400 mb-2" />
            <p className="text-sm text-neutral-400">No {leaveTab === 'pending' ? 'pending ' : ''}leave requests</p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
            {leaves.map((leave) => {
              const isReviewing = reviewingLeave?.leaveId === leave.leaveId;
              return (
                <li key={leave.leaveId} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <Avatar name={leave.userName ?? leave.userEmail ?? '?'} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {leave.userName ?? leave.userEmail}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {LEAVE_LABELS[leave.type] ?? leave.type} ·{' '}
                        {fmtDate(leave.startDate)}{leave.startDate !== leave.endDate ? ` – ${fmtDate(leave.endDate)}` : ''}
                      </p>
                      <p className="text-xs text-neutral-400 mt-0.5 truncate">{leave.reason}</p>
                    </div>
                    {leave.status === 'pending' && !isReviewing ? (
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => { setReviewingLeave(leave); setReviewNote(''); }}
                          className="flex h-7 items-center gap-1 rounded-lg bg-success-50 px-2.5 text-xs font-semibold text-success-700 hover:bg-success-100 dark:bg-success-900/20 dark:text-success-400">
                          <CheckCircle2 className="h-3 w-3" /> Review
                        </button>
                      </div>
                    ) : (
                      <Badge variant={leave.status === 'approved' ? 'success' : leave.status === 'rejected' ? 'error' : 'warning'}>
                        {leave.status}
                      </Badge>
                    )}
                  </div>
                  {isReviewing && (
                    <div className="mt-2 ml-11 space-y-2">
                      <input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)}
                        placeholder="Note (optional)"
                        className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" loading={reviewMutation.isPending}
                          onClick={() => reviewMutation.mutate({ leave, status: 'approved' })}>
                          Approve
                        </Button>
                        <Button size="sm" variant="danger" loading={reviewMutation.isPending}
                          onClick={() => reviewMutation.mutate({ leave, status: 'rejected' })}>
                          Reject
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setReviewingLeave(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const { user } = useAuth();
  // Raw role, not v3Role — v3Role collapses 'manager' and 'team_lead' into one
  // bucket, which would wrongly show AdminAttendanceView (incl. leave approve/
  // reject) to team_lead: GET /leave/admin and PUT /leave/:userId/:leaveId are
  // both checkRole(['admin','manager']), the exact scope canAssignOwner already
  // encodes — team_lead would see a broken admin view, its own fetch 403ing.
  const isAdmin = canAssignOwner(user?.role);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <CalendarDays className="h-5 w-5 text-primary-600" />
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Attendance</h1>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          {isAdmin ? <AdminAttendanceView /> : <EmployeeAttendanceView />}
        </div>
      </div>
    </div>
  );
}
