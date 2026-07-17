'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ExternalLink, Loader2, OctagonAlert, Rocket, Save, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/v3/ui/Button';
import { useMinViewportWidth } from '@/hooks/useMinViewportWidth';
import {
  createScreen,
  fromFlowJson,
  toFlowJson,
  validateFlow,
  type FlowScreen,
  type RegisteredFlowRecord,
} from '@/types/flowBuilder';
import { FlowScreensEditor } from './FlowScreensEditor';

// Meta's assets-upload validation errors arrive as loosely-shaped objects —
// message/error fields are the only ones we rely on, everything else is
// displayed defensively.
interface MetaValidationError {
  error?: string;
  error_type?: string;
  message?: string;
  [key: string]: unknown;
}

interface SaveResponse {
  success: boolean;
  validationErrors: MetaValidationError[];
}

const inputCls =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';

// ── Create form (route: /settings/flows/builder/new) ──────────────────────────

/**
 * Create-then-redirect, same shape as automation canvas/new — except Meta's
 * create call needs real user input (name + the send copy every registered
 * flow row carries), so this renders a form instead of firing a POST on mount.
 * The Meta-first sequencing lives server-side (POST /flows/builder).
 */
export function FlowBuilderCreateForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', bodyText: '', ctaLabel: '' });

  const createMut = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean; flow: RegisteredFlowRecord }>('/api/whatsapp/flows/builder', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          bodyText: form.bodyText.trim(),
          ctaLabel: form.ctaLabel.trim(),
        }),
        retries: 0,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['whatsapp-flows'] });
      toast.success('Draft Flow created on Meta');
      router.replace(`/settings/flows/builder/${res.flow.flowId}`);
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to create Flow'),
  });

  const canCreate =
    form.name.trim().length > 0 &&
    form.bodyText.trim().length > 0 &&
    form.ctaLabel.trim().length > 0 &&
    form.ctaLabel.trim().length <= 20;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <WorkspaceHeader title="New Flow" subtitle="Creates a draft on Meta, then opens the screen editor" onBack={() => router.push('/settings')} />
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-6">
        <div className="w-full max-w-md space-y-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Flow name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Account opening"
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
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Button label * <span className="text-neutral-400">({form.ctaLabel.length}/20)</span>
            </label>
            <input
              value={form.ctaLabel}
              onChange={(e) => setForm((p) => ({ ...p, ctaLabel: e.target.value.slice(0, 20) }))}
              placeholder="e.g. Start"
              maxLength={20}
              className={inputCls}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => router.push('/settings')}>Cancel</Button>
            <Button size="sm" loading={createMut.isPending} disabled={!canCreate} onClick={() => createMut.mutate()}>
              Create draft
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edit workspace (route: /settings/flows/builder/[flowId]) ──────────────────

export function FlowBuilderWorkspace({ flowId }: { flowId: string }) {
  const router = useRouter();
  const isDesktop = useMinViewportWidth(768);

  // Same query the Settings panel and the send pickers own — the stored row
  // carries flowJson/status/source, so no separate per-flow GET is needed.
  const { data, isLoading, error } = useQuery({
    queryKey: ['whatsapp-flows'],
    queryFn: () => apiFetch<{ success: boolean; flows: RegisteredFlowRecord[] }>('/api/whatsapp/flows'),
    staleTime: 60_000,
    enabled: isDesktop,
  });
  const flow = data?.flows.find((f) => f.flowId === flowId);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <WorkspaceHeader
        title={flow?.name ?? 'Flow builder'}
        subtitle="WhatsApp Flow screen editor"
        status={flow?.status}
        onBack={() => router.push('/settings')}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!isDesktop ? (
          <MobileGate />
        ) : isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin text-primary-500" aria-hidden />
            <p>Loading Flow…</p>
          </div>
        ) : error || !flow ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-error-500">
            {error ? (
              <>
                <p>Couldn&apos;t load this Flow.</p>
                <p className="text-xs text-neutral-400">
                  {error instanceof ApiClientError ? `${error.status}: ${error.message}` : (error as Error).message}
                </p>
              </>
            ) : (
              <p>Flow not found — it may have been removed.</p>
            )}
          </div>
        ) : (flow.source ?? 'manual') !== 'builder' ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-neutral-500">
            <p>This Flow was registered by ID, not built in APForce.</p>
            <p className="text-xs text-neutral-400">Edit its screens in Meta&apos;s Flow Builder (WhatsApp Manager) instead.</p>
          </div>
        ) : (
          // Keyed by flowId: local screen state seeds once per flow and is NOT
          // clobbered by background refetches of the same row (rename-field
          // precedent, automation canvas/[id]).
          <WorkspaceEditor key={flow.flowId} flow={flow} />
        )}
      </div>
    </div>
  );
}

function WorkspaceEditor({ flow }: { flow: RegisteredFlowRecord }) {
  const qc = useQueryClient();
  const published = flow.status === 'PUBLISHED';

  // Seed once from the stored document; canonicalize through our own
  // serializer for dirty-tracking — DynamoDB does not guarantee JSON key
  // order, so comparing against the raw stored text would false-positive.
  const [seed] = useState(() => {
    try {
      if (flow.flowJson) {
        const screens = fromFlowJson(flow.flowJson);
        return { screens, savedText: JSON.stringify(toFlowJson(screens)), parseError: null as string | null };
      }
    } catch (e) {
      return {
        screens: [{ ...createScreen([]), terminal: true }],
        savedText: null as string | null,
        parseError: e instanceof Error ? e.message : String(e),
      };
    }
    // Fresh draft: a single terminal screen is the smallest valid Flow.
    return { screens: [{ ...createScreen([]), terminal: true }], savedText: null as string | null, parseError: null as string | null };
  });

  const [screens, setScreens] = useState<FlowScreen[]>(seed.screens);
  const [activeId, setActiveId] = useState(seed.screens[0]?.id ?? '');
  const [savedText, setSavedText] = useState<string | null>(seed.savedText);
  const [metaErrors, setMetaErrors] = useState<MetaValidationError[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);

  const currentJson = useMemo(() => toFlowJson(screens), [screens]);
  const currentText = useMemo(() => JSON.stringify(currentJson), [currentJson]);
  const dirty = currentText !== savedText;
  const hasValidationErrors = validateFlow(screens).some((i) => i.level === 'error');

  const saveMut = useMutation({
    // retries: 0 — apiFetch's default 5xx retry must never replay an upload
    // that already reached Meta.
    mutationFn: () =>
      apiFetch<SaveResponse>(`/api/whatsapp/flows/builder/${flow.flowId}`, {
        method: 'PUT',
        body: JSON.stringify({ flowJson: currentJson }),
        retries: 0,
      }).then((res) => ({ res, uploadedText: currentText })),
    onSuccess: ({ res, uploadedText }) => {
      setSavedText(uploadedText);
      setMetaErrors(res.validationErrors ?? []);
      setPublishError(null);
      qc.invalidateQueries({ queryKey: ['whatsapp-flows'] });
      if (res.success) toast.success('Flow saved to Meta');
      else toast.warning(`Saved, but Meta reported ${res.validationErrors.length} validation error(s)`);
    },
    onError: (e: Error) => toast.error(e.message || 'Save failed'),
  });

  const publishMut = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean; status: string }>(`/api/whatsapp/flows/builder/${flow.flowId}/publish`, {
        method: 'POST',
        retries: 0,
      }),
    onSuccess: () => {
      setPublishError(null);
      qc.invalidateQueries({ queryKey: ['whatsapp-flows'] });
      toast.success('Flow published — it can now be sent to customers');
    },
    onError: (e: Error) => {
      // 502 = Meta didn't confirm (still a draft — retryable); 400 covers
      // "already published" (refresh shows the real status). Both messages
      // come from the backend and are kept inline: a toast alone vanishes.
      setPublishError(e.message || 'Publish failed');
      if (e instanceof ApiClientError && e.status === 400) {
        qc.invalidateQueries({ queryKey: ['whatsapp-flows'] });
      }
      toast.error(e.message || 'Publish failed');
    },
  });

  const previewMut = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean; previewUrl: string }>(`/api/whatsapp/flows/builder/${flow.flowId}/preview`),
    onSuccess: ({ previewUrl }) => {
      // Meta-hosted URL with its own embedded token — open, don't proxy/embed.
      // Opened after the fetch resolves, so sever the opener handle explicitly.
      const win = window.open('about:blank', '_blank');
      if (win) {
        win.opener = null;
        win.location.href = previewUrl;
      } else {
        toast.error('Popup blocked — allow popups to open the preview');
      }
    },
    onError: (e: Error) => toast.error(e.message || 'Preview failed'),
  });

  function handlePublish() {
    if (!confirm('Publishing makes this Flow permanently immutable on Meta — further edits need a new Flow. Continue?')) return;
    publishMut.mutate();
  }

  const saveBlockedReason = published
    ? 'Published Flows are immutable'
    : hasValidationErrors
      ? 'Fix the validation errors above first'
      : !dirty
        ? 'No unsaved changes'
        : undefined;
  const publishBlockedReason = published
    ? 'Already published'
    : savedText === null
      ? 'Save the Flow to Meta first'
      : dirty
        ? 'Save your changes first — publishing uses the last saved version'
        : hasValidationErrors
          ? 'Fix the validation errors above first'
          : metaErrors.length > 0
            ? 'Resolve Meta’s validation errors first'
            : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4">
      {seed.parseError && (
        <Banner tone="error">
          The stored Flow JSON could not be loaded by this editor ({seed.parseError}) — you are editing a fresh
          document, and saving will overwrite what is stored.
        </Banner>
      )}
      {published && (
        <Banner tone="neutral">
          This Flow is published and immutable on Meta — create a new Flow to make changes. You can still open the
          preview.
        </Banner>
      )}
      {publishError && <Banner tone="error">{publishError}</Banner>}
      {metaErrors.length > 0 && (
        <MetaErrorsPanel errors={metaErrors} screens={screens} onJump={setActiveId} />
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-400">
          {published ? 'Read-only' : dirty ? 'Unsaved changes' : savedText !== null ? 'All changes saved to Meta' : 'Not saved to Meta yet'}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={previewMut.isPending}
            disabled={savedText === null && !published}
            title={savedText === null && !published ? 'Save the Flow to Meta first' : dirty ? 'Preview shows the last saved version' : undefined}
            iconLeft={<ExternalLink className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => previewMut.mutate()}
          >
            Preview
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={saveMut.isPending}
            disabled={!!saveBlockedReason}
            title={saveBlockedReason}
            iconLeft={<Save className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => saveMut.mutate()}
          >
            Save to Meta
          </Button>
          <Button
            size="sm"
            loading={publishMut.isPending}
            disabled={!!publishBlockedReason}
            title={publishBlockedReason}
            iconLeft={<Rocket className="h-3.5 w-3.5" aria-hidden />}
            onClick={handlePublish}
          >
            Publish
          </Button>
        </div>
      </div>

      <FlowScreensEditor screens={screens} onChange={setScreens} activeId={activeId} onActiveChange={setActiveId} />
    </div>
  );
}

// ── Meta validation errors, mapped back to screens where possible ─────────────

function MetaErrorsPanel({ errors, screens, onJump }: {
  errors: MetaValidationError[];
  screens: FlowScreen[];
  onJump: (screenId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-error-500/40 bg-error-50 p-3 dark:bg-error-900/10" data-testid="meta-validation-errors">
      <p className="text-xs font-semibold text-error-700 dark:text-error-400">
        Meta reported {errors.length} validation error(s) on the last save — the Flow cannot be published until they
        are fixed:
      </p>
      <ul className="mt-1.5 space-y-1">
        {errors.map((err, i) => {
          const text = err.message || err.error || JSON.stringify(err);
          // Screen attribution: Meta's messages reference screens by id.
          // Substring match against the whole error object is deliberately
          // loose — wrong attribution is worse than none, so only exact id
          // hits are linked and everything else stays "General".
          const blob = JSON.stringify(err);
          const hit = screens.find((s) => blob.includes(s.id));
          return (
            <li key={i} className="flex items-start gap-2 text-xs text-error-600 dark:text-error-400">
              <OctagonAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {hit && <span className="mr-1 rounded bg-error-100 px-1 font-mono text-[10px] dark:bg-error-900/30">{hit.id}</span>}
                {text}
                {err.error_type && <span className="ml-1 text-error-400">({err.error_type})</span>}
                {hit && (
                  <button
                    type="button"
                    onClick={() => onJump(hit.id)}
                    className="ml-1.5 font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
                  >
                    Go to screen
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Shared chrome ─────────────────────────────────────────────────────────────

function WorkspaceHeader({ title, subtitle, status, onBack }: {
  title: string;
  subtitle: string;
  status?: string;
  onBack: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
      <button
        onClick={onBack}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 sm:h-8 sm:w-8 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        aria-label="Back to Settings"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20">
        <Workflow className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{title}</p>
          {status && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                status === 'PUBLISHED'
                  ? 'bg-success-50 text-success-600 dark:bg-success-900/20 dark:text-success-400'
                  : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
              )}
            >
              {status}
            </span>
          )}
        </div>
        <p className="text-[11px] text-neutral-400">{subtitle}</p>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'error' | 'neutral'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3 text-xs',
        tone === 'error'
          ? 'border-error-500/40 bg-error-50 text-error-700 dark:bg-error-900/10 dark:text-error-400'
          : 'border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
      )}
    >
      {children}
    </div>
  );
}

function MobileGate() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Building Flows is better on desktop.</p>
      <p className="max-w-xs text-xs text-neutral-400">
        The screen editor needs a larger screen. Open this page on a desktop or tablet to build or edit a Flow.
      </p>
    </div>
  );
}
