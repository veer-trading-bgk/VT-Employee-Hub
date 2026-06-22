'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import type { Role } from '@/types';

interface Employee {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  totpEnabled?: boolean;
  createdAt?: string;
}

interface EmployeeDetail extends Employee {
  mobileNumber?: string;
  panNumber?: string;
  aadhaarNumber?: string;
  homeAddress?: string;
  teamLeadId?: string;
  baseSalary?: number;
}

interface EditForm {
  name: string;
  email: string;
  mobileNumber: string;
  role: Role;
  status: 'active' | 'inactive';
  panNumber: string;
  aadhaarNumber: string;
  homeAddress: string;
  teamLeadId: string;
  baseSalary: string; // stored as string in input, parsed to number on save
}

interface Props {
  employee: Employee;
  onClose: () => void;
}

const inputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/30';

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function FieldError({ msg }: { msg: string }) {
  return <p className="mt-1 text-xs text-rose-500">{msg}</p>;
}

function validatePAN(v: string) {
  if (!v) return null;
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v) ? null : 'Format: ABCDE1234F (5 letters, 4 digits, 1 letter)';
}

function validateAadhaar(v: string) {
  if (!v) return null;
  return /^\d{12}$/.test(v) ? null : 'Must be exactly 12 digits';
}

export function EditEmployeeModal({ employee, onClose }: Props) {
  const queryClient = useQueryClient();
  const [showAdditional, setShowAdditional] = useState(false);
  const [form, setForm] = useState<EditForm>({
    name: employee.name ?? '',
    email: employee.email ?? '',
    mobileNumber: '',
    role: employee.role,
    status: (employee.status ?? 'active') as 'active' | 'inactive',
    panNumber: '',
    aadhaarNumber: '',
    homeAddress: '',
    teamLeadId: '',
    baseSalary: '',
  });

  // Fetch full employee detail to pre-populate all fields
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['employee-detail', employee.id],
    queryFn: () => apiFetch<{ success: boolean; employee: EmployeeDetail }>(`/api/admin/employees/${employee.id}`),
    staleTime: 0,
  });

  // Fetch team leads for the TL assignment dropdown
  const { data: allEmpData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: Employee[] }>('/api/admin/employees'),
    staleTime: 5 * 60 * 1000,
  });
  const teamLeads = (allEmpData?.data ?? []).filter(
    (e) => e.role === 'team_lead' && e.status !== 'inactive'
  );

  useEffect(() => {
    if (!detail?.employee) return;
    const d = detail.employee;
    setForm((f) => ({
      ...f,
      name: d.name ?? f.name,
      email: d.email ?? f.email,
      mobileNumber: d.mobileNumber ?? '',
      role: d.role ?? f.role,
      status: (d.status ?? f.status) as 'active' | 'inactive',
      panNumber: d.panNumber ?? '',
      aadhaarNumber: d.aadhaarNumber ?? '',
      homeAddress: d.homeAddress ?? '',
      teamLeadId: d.teamLeadId ?? '',
      baseSalary: d.baseSalary != null ? String(d.baseSalary) : '',
    }));
    if (d.mobileNumber || d.panNumber || d.aadhaarNumber || d.homeAddress || d.baseSalary) {
      setShowAdditional(true);
    }
  }, [detail]);

  const mobileError  = form.mobileNumber && !/^\d{10}$/.test(form.mobileNumber) ? 'Must be exactly 10 digits' : null;
  const panError     = validatePAN(form.panNumber.toUpperCase());
  const aadhaarError = validateAadhaar(form.aadhaarNumber);
  const hasErrors    = !!mobileError || !!panError || !!aadhaarError;

  const mutation = useMutation({
    mutationFn: () => {
      const d = detail?.employee;
      const changes: Record<string, string> = {};
      if (form.name   !== (d?.name   ?? employee.name))   changes.name   = form.name;
      if (form.email  !== (d?.email  ?? employee.email))  changes.email  = form.email;
      if (form.role   !== (d?.role   ?? employee.role))   changes.role   = form.role;
      if (form.status !== (d?.status ?? employee.status)) changes.status = form.status;

      const mob  = form.mobileNumber.trim();
      const pan  = form.panNumber.toUpperCase().trim();
      const aad  = form.aadhaarNumber.trim();
      const addr = form.homeAddress.trim();
      const tl   = form.teamLeadId.trim();
      if (mob  !== (d?.mobileNumber  ?? '')) changes.mobileNumber  = mob  || '';
      if (pan  !== (d?.panNumber     ?? '')) changes.panNumber     = pan  || '';
      if (aad  !== (d?.aadhaarNumber ?? '')) changes.aadhaarNumber = aad  || '';
      if (addr !== (d?.homeAddress   ?? '')) changes.homeAddress   = addr || '';
      if (tl   !== (d?.teamLeadId    ?? '')) (changes as Record<string, unknown>).teamLeadId = tl || null;

      const salaryStr = form.baseSalary.trim();
      const salaryNum = salaryStr !== '' ? Number(salaryStr) : null;
      const prevSalary = d?.baseSalary ?? null;
      if (salaryNum !== prevSalary) (changes as Record<string, unknown>).baseSalary = salaryNum;

      // Remove empty-string values (no point storing blank)
      Object.keys(changes).forEach((k) => {
        if (changes[k] === '') delete changes[k];
      });

      if (Object.keys(changes).length === 0) throw new Error('No changes to save');
      return api.updateEmployee(employee.id, changes);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      queryClient.invalidateQueries({ queryKey: ['employee-detail', employee.id] });
      toast.success(`${employee.name} updated`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isValid = form.name.trim().length > 0 && form.email.trim().length > 0 && !hasErrors;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Edit Employee</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{employee.email}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 py-5">
          {detailLoading ? (
            <div className="flex justify-center py-8">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
            </div>
          ) : (
            <div className="space-y-4">

              {/* ── Core fields ── */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Full Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
                  className={inputCls}
                >
                  <option value="telecaller">Telecaller</option>
                  <option value="agent">Agent</option>
                  <option value="intern">Intern</option>
                  <option value="team_lead">Team Lead</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Status</label>
                <div className="flex gap-2">
                  {(['active', 'inactive'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, status: s }))}
                      className={`flex-1 rounded border py-3 text-xs font-semibold transition ${
                        form.status === s
                          ? s === 'active'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                            : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          : 'border-slate-200 text-slate-400 hover:border-slate-300 dark:border-slate-700 dark:text-slate-500'
                      }`}
                    >
                      {s === 'active' ? 'Active' : 'Inactive'}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Team Lead assignment (performers only) ── */}
              {['agent', 'telecaller', 'intern'].includes(form.role) && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Assigned Team Lead
                    <span className="ml-1 text-slate-400 text-[10px] font-normal">(optional)</span>
                  </label>
                  <select
                    value={form.teamLeadId}
                    onChange={(e) => setForm((f) => ({ ...f, teamLeadId: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">— Unassigned —</option>
                    {teamLeads.map((tl) => (
                      <option key={tl.id} value={tl.id}>
                        {tl.name} ({tl.email})
                      </option>
                    ))}
                  </select>
                  {form.teamLeadId && (
                    <p className="mt-0.5 text-[11px] text-indigo-600 dark:text-indigo-400">
                      ✓ Assigned — TL can add entries for this employee
                    </p>
                  )}
                </div>
              )}

              {/* ── Collapsible additional info ── */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowAdditional((v) => !v)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Additional Information
                    {(detail?.employee?.mobileNumber || detail?.employee?.panNumber || detail?.employee?.aadhaarNumber || detail?.employee?.homeAddress) && (
                      <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        Saved
                      </span>
                    )}
                  </span>
                  <ChevronIcon open={showAdditional} />
                </button>

                {showAdditional && (
                  <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Mobile Number <span className="text-slate-400">(optional)</span>
                      </label>
                      <input
                        type="tel"
                        inputMode="numeric"
                        value={form.mobileNumber}
                        onChange={(e) => setForm((f) => ({ ...f, mobileNumber: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                        placeholder="9876543210"
                        maxLength={10}
                        className={`${inputCls} font-mono tracking-widest`}
                      />
                      {mobileError && <FieldError msg={mobileError} />}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                        PAN Number <span className="text-slate-400">(optional)</span>
                      </label>
                      <input
                        value={form.panNumber}
                        onChange={(e) => setForm((f) => ({ ...f, panNumber: e.target.value.toUpperCase() }))}
                        maxLength={10}
                        placeholder="ABCDE1234F"
                        className={`${inputCls} font-mono uppercase tracking-widest`}
                      />
                      {panError && <FieldError msg={panError} />}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Aadhaar Number <span className="text-slate-400">(optional)</span>
                      </label>
                      <input
                        value={form.aadhaarNumber}
                        onChange={(e) => setForm((f) => ({ ...f, aadhaarNumber: e.target.value.replace(/\D/g, '').slice(0, 12) }))}
                        placeholder="123456789012"
                        inputMode="numeric"
                        className={`${inputCls} font-mono tracking-widest`}
                      />
                      {aadhaarError && <FieldError msg={aadhaarError} />}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Fixed Base Salary / Stipend <span className="text-slate-400">(optional)</span>
                      </label>
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-slate-400">₹</span>
                        <input
                          type="number"
                          min={0}
                          max={1000000}
                          step={500}
                          value={form.baseSalary}
                          onChange={(e) => setForm((f) => ({ ...f, baseSalary: e.target.value }))}
                          placeholder="0 — pure incentive"
                          className={inputCls}
                        />
                        <span className="whitespace-nowrap text-xs text-slate-400">/ month</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Added to metric earnings every month automatically. Leave blank or 0 for pure incentive.
                      </p>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Home Address <span className="text-slate-400">(optional)</span>
                      </label>
                      <textarea
                        value={form.homeAddress}
                        onChange={(e) => setForm((f) => ({ ...f, homeAddress: e.target.value }))}
                        rows={3}
                        placeholder="Street, City, State, PIN"
                        className={inputCls}
                      />
                    </div>
                  </div>
                )}
              </div>

              {mutation.error && (
                <p className="text-xs text-rose-500">{(mutation.error as Error).message}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !isValid || detailLoading}
            className="flex-1 rounded bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 transition"
          >
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            onClick={onClose}
            className="rounded border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
