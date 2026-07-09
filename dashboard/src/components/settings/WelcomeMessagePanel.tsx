'use client';

import { useState } from 'react';
import { MessageSquareText, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch, ApiClientError } from '@/lib/api';
import { toast } from 'sonner';
import { ButtonListEditor, type ReplyButtonValue, type CtaButtonValue } from '@/components/shared/ButtonListEditor';

type MessageType = 'template' | 'reply_buttons' | 'cta_buttons';

interface WelcomeConfig {
  enabled: boolean;
  messageType: MessageType;
  templateName: string;
  language: string;
  bodyText: string;
  buttons: ReplyButtonValue[];
  ctaButtons: CtaButtonValue[];
}

const EMPTY_CONFIG: WelcomeConfig = {
  enabled: false, messageType: 'template', templateName: '', language: 'en',
  bodyText: '', buttons: [], ctaButtons: [],
};

interface WaTemplateOption { id: string; templateName: string; status: string; }

/**
 * Sent automatically on first contact — see whatsapp.js's `isNewMsg &&
 * isFirstContact` webhook branch. Exactly one of three shapes at a time
 * (Meta rule, enforced server-side by welcomeConfigSchema): a template, up to
 * 3 reply buttons (trackable, each with an optional follow-up), or a single
 * URL CTA button (untrackable — Meta sends no webhook event for a CTA tap).
 */
export function WelcomeMessagePanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['welcome-config'],
    queryFn: () => apiFetch<{ config: WelcomeConfig }>('/api/whatsapp/welcome-config'),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Card className="mt-4">
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  // Remounts (fresh local form state) whenever the server record changes —
  // e.g. right after a successful save refetches — instead of syncing via a
  // useEffect + setState, which the React compiler flags as a render-loop risk.
  return <WelcomeMessageForm key={JSON.stringify(data?.config)} initialConfig={data?.config} />;
}

function WelcomeMessageForm({ initialConfig }: { initialConfig: WelcomeConfig | undefined }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<WelcomeConfig>({ ...EMPTY_CONFIG, ...initialConfig });
  const [dirty, setDirty] = useState(false);
  // Collapsed by default — this sits above the Workflows list now, so it
  // shouldn't dominate the page on every visit. Independent of `enabled`:
  // even when the welcome message is on, the config form stays tucked away
  // until the admin explicitly wants to look at or edit it.
  const [expanded, setExpanded] = useState(false);

  // Same ['wa-templates'] key ComposerToolbar.tsx's template picker already owns.
  const { data: tplData } = useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => apiFetch<{ templates: WaTemplateOption[] }>('/api/whatsapp/templates'),
    staleTime: 60_000,
    enabled: form.messageType === 'template',
  });
  const approvedTemplates = (tplData?.templates ?? []).filter((t) => t.status === 'APPROVED');

  function update<K extends keyof WelcomeConfig>(key: K, value: WelcomeConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  // Mutually exclusive in the UI too, matching the backend rule — switching
  // type clears whichever button list doesn't belong to the new type.
  function setMessageType(mt: MessageType) {
    setForm((prev) => ({
      ...prev,
      messageType: mt,
      buttons: mt === 'reply_buttons' ? prev.buttons : [],
      ctaButtons: mt === 'cta_buttons' ? prev.ctaButtons : [],
    }));
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
    mutationFn: ({ config }: { config: WelcomeConfig; isToggleAutoSave?: boolean }) =>
      apiFetch('/api/whatsapp/welcome-config', { method: 'PUT', body: JSON.stringify(config) }),
    onSuccess: () => {
      toast.success('Welcome message saved');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['welcome-config'] });
    },
    onError: (e: unknown, variables) => {
      // Revert the toggle only for its own auto-save failing — never on a
      // manual-save failure, which should leave the form exactly as the
      // admin left it so they can just retry (see 2026-07-09 investigation).
      if (variables.isToggleAutoSave) setForm((prev) => ({ ...prev, enabled: !variables.config.enabled }));
      const msg = e instanceof ApiClientError ? (e.body?.error as string | undefined) ?? e.message : 'Failed to save welcome message';
      toast.error(msg);
    },
  });

  // Auto-saves ONLY the master toggle, immediately on flip — no separate
  // Save click for turning Welcome Message on/off. If other fields are
  // already mid-edit (dirty), don't silently commit them alongside the
  // toggle; fold the flip into that same pending change instead and let the
  // existing manual-Save flow cover both together, unchanged from before.
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
      Save Welcome Message
    </Button>
  );

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-neutral-400" aria-hidden />
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Welcome Message</p>
              <Badge variant="primary">Built-in trigger</Badge>
            </div>
            <p className="text-xs text-neutral-500">
              Sent automatically the first time a new contact messages you — not a workflow you create below
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Toggle
            checked={form.enabled}
            disabled={saveMut.isPending}
            onChange={(e) => handleToggleChange(e.target.checked)}
            aria-label="Enable welcome message"
          />
          {form.enabled && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Collapse welcome message settings' : 'Expand welcome message settings'}
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {form.enabled && expanded && (
        <div className="mt-4 space-y-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Message type</label>
            <select value={form.messageType} onChange={(e) => setMessageType(e.target.value as MessageType)} className={selectCls}>
              <option value="template">Template</option>
              <option value="reply_buttons">Reply buttons</option>
              <option value="cta_buttons">CTA button</option>
            </select>
          </div>

          {form.messageType === 'template' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-neutral-500">Template</label>
                <select value={form.templateName} onChange={(e) => update('templateName', e.target.value)} className={selectCls}>
                  <option value="">Select approved template…</option>
                  {approvedTemplates.map((t) => <option key={t.id} value={t.templateName}>{t.templateName}</option>)}
                </select>
              </div>
              <div className="w-32">
                <label className="mb-1 block text-xs font-medium text-neutral-500">Language</label>
                <select value={form.language} onChange={(e) => update('language', e.target.value)} className={selectCls}>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="kn">Kannada</option>
                  <option value="te">Telugu</option>
                  <option value="ta">Tamil</option>
                </select>
              </div>
            </div>
          )}

          {(form.messageType === 'reply_buttons' || form.messageType === 'cta_buttons') && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-500">Message text</label>
                <textarea
                  value={form.bodyText}
                  onChange={(e) => update('bodyText', e.target.value)}
                  rows={3}
                  placeholder="Shown to the customer above the button(s)"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Supported variables: {'{{name}}'}, {'{{phone}}'}. Other {'{{...}}'} patterns (e.g. from a Meta template) are sent as literal text — they are not substituted here.
                </p>
              </div>
              {form.messageType === 'reply_buttons' ? (
                <ButtonListEditor mode="reply" value={form.buttons} onChange={(v) => update('buttons', v)} />
              ) : (
                <ButtonListEditor mode="cta" value={form.ctaButtons} onChange={(v) => update('ctaButtons', v)} />
              )}
            </>
          )}

          <div className="flex justify-end">{saveButton}</div>
        </div>
      )}

      {/* Fallback for CONTENT edits only now — the toggle auto-saves itself
          on flip (see handleToggleChange above) and no longer needs a
          reachable Save button of its own. This still covers message-type/
          template/button edits, and the rare case where the toggle got
          folded into an already-dirty pending change instead of
          auto-saving (see handleToggleChange's comment). */}
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
