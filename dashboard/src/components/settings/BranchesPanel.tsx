'use client';

import { useState } from 'react';
import { Building2, Plus, Trash2, Pencil } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch, ApiClientError } from '@/lib/api';
import { toast } from 'sonner';
import type { Branch } from '@/components/automation/BranchSelect';

const EMPTY_FORM = { name: '', address: '', latitude: '', longitude: '' };

/**
 * Branch directory (Item 1c) — the office list the Send Location canvas
 * node's dropdown and the Inbox composer's own "Send Location" button both
 * read from (['wa-branches'] cache, shared with BranchSelect.tsx).
 */
export function BranchesPanel() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ['wa-branches'],
    queryFn: () => apiFetch<{ branches: Branch[] }>('/api/whatsapp/branches'),
    staleTime: 30_000,
  });
  const branches = data?.branches ?? [];

  const saveMut = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        name: form.name.trim(),
        address: form.address.trim(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      });
      return editingId
        ? apiFetch(`/api/whatsapp/branches/${editingId}`, { method: 'PUT', body })
        : apiFetch('/api/whatsapp/branches', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success(editingId ? 'Branch updated' : 'Branch added');
      qc.invalidateQueries({ queryKey: ['wa-branches'] });
      closeForm();
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiClientError ? (e.body?.error as string | undefined) ?? e.message : 'Failed to save branch';
      toast.error(msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (branchId: string) => apiFetch(`/api/whatsapp/branches/${branchId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Branch deleted');
      qc.invalidateQueries({ queryKey: ['wa-branches'] });
    },
    onError: () => toast.error('Failed to delete branch'),
  });

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }
  function openEdit(b: Branch) {
    setEditingId(b.branchId);
    setForm({ name: b.name, address: b.address ?? '', latitude: String(b.latitude), longitude: String(b.longitude) });
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  const canSave = form.name.trim().length > 0 && form.latitude.trim() !== '' && form.longitude.trim() !== ''
    && !Number.isNaN(Number(form.latitude)) && !Number.isNaN(Number(form.longitude));

  if (isLoading) {
    return (
      <Card className="mt-4">
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-neutral-400" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Branches</p>
            <p className="text-xs text-neutral-500">
              Saved office locations for the Send Location automation node and the Inbox &quot;Send Location&quot; button
            </p>
          </div>
        </div>
        {!formOpen && (
          <Button size="sm" variant="secondary" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={openAdd}>
            Add Branch
          </Button>
        )}
      </div>

      {branches.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {branches.map((b) => (
            <div key={b.branchId} className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{b.name}</p>
                <p className="truncate text-xs text-neutral-500">{b.address || `${b.latitude}, ${b.longitude}`}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => openEdit(b)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800" aria-label="Edit branch">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { if (window.confirm(`Delete "${b.name}"?`)) deleteMut.mutate(b.branchId); }}
                  className="rounded p-1 text-neutral-400 hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-900/20"
                  aria-label="Delete branch"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="mt-4 space-y-3 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-neutral-500">Name</label>
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="HQ Office" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Address (optional)</label>
            <input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} placeholder="1 MG Road, Bengaluru" className={inputCls} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-neutral-500">Latitude</label>
              <input value={form.latitude} onChange={(e) => setForm((p) => ({ ...p, latitude: e.target.value }))} placeholder="12.9716" className={inputCls} />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-neutral-500">Longitude</label>
              <input value={form.longitude} onChange={(e) => setForm((p) => ({ ...p, longitude: e.target.value }))} placeholder="77.5946" className={inputCls} />
            </div>
          </div>
          <p className="text-[11px] text-neutral-400">Tip: right-click a location on Google Maps to copy its coordinates.</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={closeForm}>Cancel</Button>
            <Button size="sm" loading={saveMut.isPending} disabled={!canSave} onClick={() => saveMut.mutate()}>
              {editingId ? 'Save Changes' : 'Add Branch'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
