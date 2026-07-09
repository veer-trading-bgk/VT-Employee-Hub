'use client';

import { useState } from 'react';
import { Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch, ApiClientError } from '@/lib/api';
import { toast } from 'sonner';

type DelayUnit = 'minutes' | 'hours';

interface DelayedResponseConfig {
  enabled: boolean;
  delayAmount: number;
  delayUnit: DelayUnit;
  messageText: string;
}

const EMPTY_CONFIG: DelayedResponseConfig = {
  enabled: false, delayAmount: 5, delayUnit: 'minutes', messageText: '',
};

/**
 * "Delayed Response Message" (Item 3) — if a customer messages in and no
 * agent replies within the configured delay, sends this message
 * automatically. Reuses AutomationEngine's existing AUTO_WAIT# timer
 * infrastructure server-side (see DelayedResponseService.js) — this panel is
 * config-only, same shape as WelcomeMessagePanel.tsx.
 */
export function DelayedResponsePanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['delayed-response-config'],
    queryFn: () => apiFetch<{ config: DelayedResponseConfig }>('/api/whatsapp/delayed-response-config'),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Card className="mt-4">
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  return <DelayedResponseForm key={JSON.stringify(data?.config)} initialConfig={data?.config} />;
}

function DelayedResponseForm({ initialConfig }: { initialConfig: DelayedResponseConfig | undefined }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<DelayedResponseConfig>({ ...EMPTY_CONFIG, ...initialConfig });
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState(false);

  function update<K extends keyof DelayedResponseConfig>(key: K, value: DelayedResponseConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  // Takes the config to save explicitly, plus a flag marking whether this
  // call came from the toggle's auto-save path — needed so onError knows
  // whether to revert the toggle (auto-save) or leave the form alone so the
  // admin can retry (manual Save). The explicit config (rather than reading
  // `form` from this closure) also avoids racing React's state batching:
  // handleToggleChange calls setForm + mutate in the same handler, so the
  // closure's `form` could still be the pre-flip value at that point.
  const saveMut = useMutation({
    mutationFn: ({ config }: { config: DelayedResponseConfig; isToggleAutoSave?: boolean }) =>
      apiFetch('/api/whatsapp/delayed-response-config', { method: 'PUT', body: JSON.stringify(config) }),
    onSuccess: () => {
      toast.success('Delayed response saved');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['delayed-response-config'] });
    },
    onError: (e: unknown, variables) => {
      // Revert the toggle only for its own auto-save failing — never on a
      // manual-save failure, which should leave the form exactly as the
      // admin left it so they can just retry (see 2026-07-09 investigation).
      if (variables.isToggleAutoSave) setForm((prev) => ({ ...prev, enabled: !variables.config.enabled }));
      const msg = e instanceof ApiClientError ? (e.body?.error as string | undefined) ?? e.message : 'Failed to save delayed response';
      toast.error(msg);
    },
  });

  // Auto-saves ONLY the master toggle, immediately on flip. If other fields
  // are already mid-edit (dirty), don't silently commit them alongside the
  // toggle; fold the flip into that same pending change and let the
  // existing manual-Save flow cover everything together, unchanged.
  function handleToggleChange(checked: boolean) {
    if (dirty) {
      update('enabled', checked);
      return;
    }
    const next = { ...form, enabled: checked };
    setForm(next);
    saveMut.mutate({ config: next, isToggleAutoSave: true });
  }

  const saveButton = (
    <Button size="sm" loading={saveMut.isPending} disabled={!dirty} onClick={() => saveMut.mutate({ config: form })}>
      Save Delayed Response
    </Button>
  );

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-neutral-400" aria-hidden />
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Delayed Response Message</p>
              <Badge variant="primary">Built-in trigger</Badge>
            </div>
            <p className="text-xs text-neutral-500">
              Sent automatically if no agent replies within the delay below — cancelled if an agent replies first
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Toggle
            checked={form.enabled}
            disabled={saveMut.isPending}
            onChange={(e) => handleToggleChange(e.target.checked)}
            aria-label="Enable delayed response message"
          />
          {form.enabled && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Collapse delayed response settings' : 'Expand delayed response settings'}
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {form.enabled && expanded && (
        <div className="mt-4 space-y-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <div className="flex gap-3">
            <div className="w-28">
              <label className="mb-1 block text-xs font-medium text-neutral-500">Delay</label>
              <input
                type="number"
                min={1}
                max={1440}
                value={form.delayAmount}
                onChange={(e) => update('delayAmount', Math.max(1, Math.min(1440, Number(e.target.value) || 1)))}
                className={inputCls}
              />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-neutral-500">Unit</label>
              <select value={form.delayUnit} onChange={(e) => update('delayUnit', e.target.value as DelayUnit)} className={selectCls}>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Message text</label>
            <textarea
              value={form.messageText}
              onChange={(e) => update('messageText', e.target.value)}
              rows={3}
              placeholder="Thanks for reaching out — we'll get back to you shortly, {{name}}!"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-neutral-500">Supported variables: {'{{name}}'}, {'{{phone}}'}.</p>
          </div>

          <div className="flex justify-end">{saveButton}</div>
        </div>
      )}

      {/* Fallback for CONTENT edits only now — the toggle auto-saves itself
          on flip (see handleToggleChange above) and no longer needs a
          reachable Save button of its own. This still covers delay/
          message-text edits, and the rare case where the toggle got folded
          into an already-dirty pending change instead of auto-saving (see
          handleToggleChange's comment). */}
      {dirty && !(form.enabled && expanded) && (
        <div className="mt-4 flex justify-end border-t border-neutral-100 pt-4 dark:border-neutral-800">
          {saveButton}
        </div>
      )}
    </Card>
  );
}

const inputCls = 'w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
const selectCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
