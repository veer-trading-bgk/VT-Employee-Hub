'use client';

import { useState } from 'react';
import { Workflow, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FlowRecord {
  flowId: string;
  name: string;
  bodyText: string;
  ctaLabel: string;
  screenId: string | null;
  createdAt: string;
}

const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';

const EMPTY_FORM = { flowId: '', name: '', bodyText: '', ctaLabel: '', screenId: '' };

/**
 * References a Flow already built in Meta's WhatsApp Manager by its Flow ID —
 * APForce does not build or edit the Flow's screens/JSON (out of scope; Meta's
 * own Flow Builder owns that). This panel only registers the ID + the send
 * copy (body text, button label, optional first screen) needed to trigger it.
 */
export function WhatsAppFlowsPanel() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['whatsapp-flows'],
    queryFn: () => apiFetch<{ success: boolean; flows: FlowRecord[] }>('/api/whatsapp/flows'),
    staleTime: 60_000,
  });
  const flows = data?.flows ?? [];

  const createMut = useMutation({
    mutationFn: () =>
      apiFetch('/api/whatsapp/flows', {
        method: 'POST',
        body: JSON.stringify({
          flowId: form.flowId.trim(),
          name: form.name.trim(),
          bodyText: form.bodyText.trim(),
          ctaLabel: form.ctaLabel.trim(),
          screenId: form.screenId.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-flows'] });
      setForm(EMPTY_FORM);
      setShowForm(false);
      toast.success('Flow registered');
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to register flow'),
  });

  const deleteMut = useMutation({
    mutationFn: (flowId: string) => apiFetch(`/api/whatsapp/flows/${flowId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-flows'] });
      toast.success('Flow removed');
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to remove flow'),
  });

  const canCreate =
    form.flowId.trim().length > 0 &&
    form.name.trim().length > 0 &&
    form.bodyText.trim().length > 0 &&
    form.ctaLabel.trim().length > 0 &&
    form.ctaLabel.trim().length <= 20;

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-neutral-400" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">WhatsApp Flows</p>
            <p className="text-xs text-neutral-500">
              Reference a Flow built in Meta&apos;s WhatsApp Manager — build the Flow itself there
            </p>
          </div>
        </div>
        {!showForm && (
          <Button size="sm" variant="secondary" onClick={() => setShowForm(true)}>
            Register Flow
          </Button>
        )}
      </div>

      {showForm && (
        <div className="mt-4 space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Flow ID *</label>
            <input
              value={form.flowId}
              onChange={(e) => setForm((p) => ({ ...p, flowId: e.target.value }))}
              placeholder="e.g. 1234567890123456"
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-neutral-400">From WhatsApp Manager → Flows → your Flow → ID</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Display name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. KYC Form"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Message text *</label>
            <textarea
              value={form.bodyText}
              onChange={(e) => setForm((p) => ({ ...p, bodyText: e.target.value }))}
              placeholder="Shown to the customer above the Flow button"
              rows={2}
              className={inputCls}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-neutral-500">
                Button label * <span className="text-neutral-400">({form.ctaLabel.length}/20)</span>
              </label>
              <input
                value={form.ctaLabel}
                onChange={(e) => setForm((p) => ({ ...p, ctaLabel: e.target.value.slice(0, 20) }))}
                placeholder="e.g. Start"
                className={inputCls}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-neutral-500">Starting screen ID (optional)</label>
              <input
                value={form.screenId}
                onChange={(e) => setForm((p) => ({ ...p, screenId: e.target.value }))}
                placeholder="Only if the Flow requires one"
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>
              Cancel
            </Button>
            <Button size="sm" loading={createMut.isPending} disabled={!canCreate} onClick={() => createMut.mutate()}>
              Save Flow
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : isError ? (
          <div className="py-4 text-center">
            <p className="text-xs text-error-600 dark:text-error-400">Failed to load Flows</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : flows.length === 0 ? (
          <p className="py-4 text-center text-xs text-neutral-400">No Flows registered yet</p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {flows.map((f) => (
              <li key={f.flowId} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{f.name}</p>
                  <p className="truncate font-mono text-[11px] text-neutral-400">{f.flowId}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { if (confirm(`Remove "${f.name}"?`)) deleteMut.mutate(f.flowId); }}
                  disabled={deleteMut.isPending}
                  title="Remove"
                  className="shrink-0 text-neutral-300 transition-colors hover:text-error-600 dark:hover:text-error-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
