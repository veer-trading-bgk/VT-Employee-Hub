'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface Employee {
  id: string;
  name: string;
  email: string;
}

interface Props {
  employee: Employee;
  onClose: () => void;
}

export function DeleteEmployeeDialog({ employee, onClose }: Props) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.deleteEmployee(employee.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      toast.success(`${employee.name} permanently deleted`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isConfirmed = confirm === employee.email;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-rose-900/50 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-600/20 text-2xl">
            ⚠️
          </div>
          <h2 className="text-base font-bold text-white">Permanently Delete Employee?</h2>
          <p className="mt-1.5 text-sm text-slate-400">
            <strong className="text-white">{employee.name}</strong> will be removed from the system entirely.
            All login access is revoked immediately. This cannot be undone.
          </p>
        </div>

        <div className="mb-4 rounded-lg border border-rose-800/40 bg-rose-950/20 px-3 py-3 text-xs text-rose-400">
          🗑️ This permanently removes the record from the database. There is no recovery.
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Type <span className="font-mono text-white">{employee.email}</span> to confirm
          </label>
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={employee.email}
            autoComplete="off"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/30"
          />
        </div>

        {mutation.error && (
          <p className="mb-3 text-sm text-rose-400">{(mutation.error as Error).message}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !isConfirmed}
            className="flex-1 rounded-lg bg-rose-600 py-3 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation.isPending ? 'Deleting…' : 'Permanently Delete'}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-3 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
