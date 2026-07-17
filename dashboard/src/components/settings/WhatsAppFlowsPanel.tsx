'use client';

import { useState } from 'react';
import { Workflow, Trash2, Pencil, Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { fromFlowJson, regenerateOptionIds, toFlowJson, type RegisteredFlowRecord } from '@/types/flowBuilder';

const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';

const EMPTY_FORM = { flowId: '', name: '', bodyText: '', ctaLabel: '', screenId: '' };
const EMPTY_DUP_FORM = { name: '', bodyText: '', ctaLabel: '' };

/**
 * Two ways into the same CONFIG#FLOW# registry: register a Flow already built
 * in Meta's WhatsApp Manager by its Flow ID (this panel's inline form), or
 * build one inside APForce with the Flow builder (/settings/flows/builder —
 * FlowManagementService/Phase 2b superseded the old "Meta's builder owns
 * screens" scope note that used to live here). Builder-created rows carry
 * source:'builder' and get Edit/Duplicate affordances; register-by-ID rows
 * stay editable only in Meta's builder (no local flowJson to copy from
 * either, so no Duplicate).
 */
export function WhatsAppFlowsPanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [duplicatingFlow, setDuplicatingFlow] = useState<RegisteredFlowRecord | null>(null);
  const [dupForm, setDupForm] = useState(EMPTY_DUP_FORM);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['whatsapp-flows'],
    queryFn: () => apiFetch<{ success: boolean; flows: RegisteredFlowRecord[] }>('/api/whatsapp/flows'),
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

  // Works whether the source Flow is DRAFT or PUBLISHED — duplicating a
  // published (locked) Flow to get an editable copy is the primary use case.
  // Create + save are two separate calls (same ones the "New Flow" form and
  // the editor's own Save button already make) rather than new backend
  // logic; the only real work here is regenerateOptionIds() below, so a
  // duplicate of a Flow built before that fix comes out clean instead of
  // copying its opaque option ids verbatim.
  const duplicateMut = useMutation({
    mutationFn: async () => {
      if (!duplicatingFlow) throw new Error('No Flow selected to duplicate');
      const createRes = await apiFetch<{ success: boolean; flow: RegisteredFlowRecord }>('/api/whatsapp/flows/builder', {
        method: 'POST',
        body: JSON.stringify({
          name: dupForm.name.trim(),
          bodyText: dupForm.bodyText.trim(),
          ctaLabel: dupForm.ctaLabel.trim(),
        }),
        retries: 0,
      });
      const newFlowId = createRes.flow.flowId;

      // A builder draft that was created but never saved has no screens to
      // copy — the fresh empty draft alone is already the correct outcome.
      if (!duplicatingFlow.flowJson) return { newFlowId, saved: true as const };

      try {
        const regenerated = regenerateOptionIds(fromFlowJson(duplicatingFlow.flowJson));
        await apiFetch(`/api/whatsapp/flows/builder/${newFlowId}`, {
          method: 'PUT',
          body: JSON.stringify({ flowJson: toFlowJson(regenerated) }),
          retries: 0,
        });
        return { newFlowId, saved: true as const };
      } catch (e) {
        // The new Flow genuinely exists on Meta by this point (create
        // already succeeded) — hand off to its editor instead of stranding
        // the admin on a page that looks like nothing happened. The
        // editor's own Save button can retry.
        return { newFlowId, saved: false as const, saveError: e instanceof Error ? e.message : String(e) };
      }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['whatsapp-flows'] });
      setDuplicatingFlow(null);
      setDupForm(EMPTY_DUP_FORM);
      if (result.saved) toast.success('Flow duplicated');
      else toast.warning(`Flow duplicated, but copying its screens failed (${result.saveError}) — you can retry Save from the editor.`);
      router.push(`/settings/flows/builder/${result.newFlowId}`);
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to duplicate Flow'),
  });

  function openDuplicateForm(flow: RegisteredFlowRecord) {
    setShowForm(false);
    setDuplicatingFlow(flow);
    setDupForm({ name: `${flow.name} (copy)`, bodyText: flow.bodyText, ctaLabel: flow.ctaLabel });
  }

  const canDuplicate =
    dupForm.name.trim().length > 0 &&
    dupForm.bodyText.trim().length > 0 &&
    dupForm.ctaLabel.trim().length > 0 &&
    dupForm.ctaLabel.trim().length <= 20;

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
              Build a Flow in APForce, or register one built in Meta&apos;s WhatsApp Manager by its ID
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => router.push('/settings/flows/builder/new')}>
            Build a Flow
          </Button>
          {!showForm && (
            <Button size="sm" variant="secondary" onClick={() => { setDuplicatingFlow(null); setShowForm(true); }}>
              Register Flow
            </Button>
          )}
        </div>
      </div>

      {duplicatingFlow && (
        <div className="mt-4 space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
          <p className="text-xs font-medium text-neutral-500">
            Duplicate &ldquo;{duplicatingFlow.name}&rdquo; — creates a new draft Flow pre-populated with its screens.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Display name *</label>
            <input
              value={dupForm.name}
              onChange={(e) => setDupForm((p) => ({ ...p, name: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Message text *</label>
            <textarea
              value={dupForm.bodyText}
              onChange={(e) => setDupForm((p) => ({ ...p, bodyText: e.target.value }))}
              placeholder="Shown to the customer above the Flow button"
              rows={2}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Button label * <span className="text-neutral-400">({dupForm.ctaLabel.length}/20)</span>
            </label>
            <input
              value={dupForm.ctaLabel}
              onChange={(e) => setDupForm((p) => ({ ...p, ctaLabel: e.target.value.slice(0, 20) }))}
              className={inputCls}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setDuplicatingFlow(null); setDupForm(EMPTY_DUP_FORM); }}>
              Cancel
            </Button>
            <Button size="sm" loading={duplicateMut.isPending} disabled={!canDuplicate} onClick={() => duplicateMut.mutate()}>
              Duplicate
            </Button>
          </div>
        </div>
      )}

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
              <li key={f.flowId} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{f.name}</p>
                    {f.source === 'builder' && (
                      <span
                        className={
                          f.status === 'PUBLISHED'
                            ? 'rounded bg-success-50 px-1 py-0.5 text-[10px] font-semibold uppercase text-success-600 dark:bg-success-900/20 dark:text-success-400'
                            : 'rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                        }
                      >
                        {f.status ?? 'DRAFT'}
                      </span>
                    )}
                  </div>
                  <p className="truncate font-mono text-[11px] text-neutral-400">{f.flowId}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Edit/Duplicate open the in-app builder — only for rows it
                      created; register-by-ID rows have no local flowJson to
                      copy from, and are edited in Meta's builder, as before. */}
                  {f.source === 'builder' && (
                    <>
                      <button
                        type="button"
                        onClick={() => router.push(`/settings/flows/builder/${f.flowId}`)}
                        title="Edit in Flow builder"
                        className="text-neutral-300 transition-colors hover:text-primary-600 dark:hover:text-primary-400"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openDuplicateForm(f)}
                        title="Duplicate"
                        className="text-neutral-300 transition-colors hover:text-primary-600 dark:hover:text-primary-400"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => { if (confirm(`Remove "${f.name}"?`)) deleteMut.mutate(f.flowId); }}
                    disabled={deleteMut.isPending}
                    title="Remove"
                    className="text-neutral-300 transition-colors hover:text-error-600 dark:hover:text-error-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
