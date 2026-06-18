'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
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

interface EditForm {
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'inactive';
}

interface Props {
  employee: Employee;
  onClose: () => void;
}

const inputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/30';

export function EditEmployeeModal({ employee, onClose }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EditForm>({
    name: employee.name ?? '',
    email: employee.email ?? '',
    role: employee.role,
    status: (employee.status ?? 'active') as 'active' | 'inactive',
  });

  useEffect(() => {
    setForm({
      name: employee.name ?? '',
      email: employee.email ?? '',
      role: employee.role,
      status: (employee.status ?? 'active') as 'active' | 'inactive',
    });
  }, [employee.id]);

  const mutation = useMutation({
    mutationFn: () => {
      const changes: Record<string, string> = {};
      if (form.name !== employee.name) changes.name = form.name;
      if (form.email !== employee.email) changes.email = form.email;
      if (form.role !== employee.role) changes.role = form.role;
      if (form.status !== employee.status) changes.status = form.status;
      if (Object.keys(changes).length === 0) throw new Error('No changes to save');
      return api.updateEmployee(employee.id, changes);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      toast.success(`${employee.name} updated`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isValid = form.name.trim().length > 0 && form.email.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Edit Employee</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{employee.email}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close">✕</button>
        </div>

        {/* Fields */}
        <div className="space-y-4 px-6 py-5">
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
                      : 'border-slate-200 text-slate-400 hover:border-slate-300 dark:border-slate-700 dark:text-slate-500 dark:hover:border-slate-600'
                  }`}
                >
                  {s === 'active' ? 'Active' : 'Inactive'}
                </button>
              ))}
            </div>
          </div>

          {mutation.error && (
            <p className="text-xs text-red-500">{(mutation.error as Error).message}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !isValid}
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
