'use client';

import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';

// ── Shared types — mirror src/utils/validation.js's welcomeConfigSchema ────────
// Also the shape any future button-configuring feature (automation-step
// buttons, Inbox manual-send buttons) should reuse rather than redefine.

export type FollowUpType = 'none' | 'text' | 'image' | 'url_button' | 'flow';

export interface FollowUpContent {
  message?: string;
  mediaId?: string;
  url?: string;
  caption?: string;
  buttonText?: string;
  flowId?: string;
}

export interface ButtonFollowUp {
  type: FollowUpType;
  content?: FollowUpContent;
}

export interface ReplyButtonValue {
  id: string;
  title: string;
  followUp?: ButtonFollowUp;
}

export interface CtaButtonValue {
  type: 'url';
  text: string;
  value: string;
}

// Meta platform limits — not app config, do not make these props.
const MAX_REPLY_BUTTONS = 3;
const MAX_CTA_BUTTONS = 1; // Meta's freeform interactive API supports one CTA (URL) button only

const newButtonId = () => `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type ButtonListEditorProps =
  | { mode: 'reply'; value: ReplyButtonValue[]; onChange: (v: ReplyButtonValue[]) => void }
  | { mode: 'cta'; value: CtaButtonValue[]; onChange: (v: CtaButtonValue[]) => void };

/**
 * Shared editor for both WhatsApp button kinds — Meta does not allow combining
 * them in one message, so a caller renders this in exactly one mode at a time
 * (see the welcome-message messageType selector for the canonical example).
 * One component, not two, so future callers (automation-step buttons, Inbox
 * manual-send buttons) reuse this instead of building their own.
 */
export function ButtonListEditor(props: ButtonListEditorProps) {
  if (props.mode === 'reply') return <ReplyButtonList value={props.value} onChange={props.onChange} />;
  return <CtaButtonList value={props.value} onChange={props.onChange} />;
}

// ── Reply-button mode ────────────────────────────────────────────────────────

function ReplyButtonList({ value, onChange }: { value: ReplyButtonValue[]; onChange: (v: ReplyButtonValue[]) => void }) {
  function addButton() {
    if (value.length >= MAX_REPLY_BUTTONS) return;
    onChange([...value, { id: newButtonId(), title: '', followUp: { type: 'none' } }]);
  }
  function updateButton(idx: number, patch: Partial<ReplyButtonValue>) {
    onChange(value.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }
  function removeButton(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {value.map((btn, idx) => (
        <ReplyButtonRow
          key={btn.id}
          button={btn}
          onChange={(patch) => updateButton(idx, patch)}
          onRemove={() => removeButton(idx)}
        />
      ))}
      {value.length < MAX_REPLY_BUTTONS ? (
        <button
          type="button"
          onClick={addButton}
          className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          <Plus className="h-3.5 w-3.5" /> Add button ({value.length}/{MAX_REPLY_BUTTONS})
        </button>
      ) : (
        <p className="text-[11px] text-neutral-400">Maximum {MAX_REPLY_BUTTONS} reply buttons (Meta limit)</p>
      )}
    </div>
  );
}

function ReplyButtonRow({ button, onChange, onRemove }: {
  button: ReplyButtonValue;
  onChange: (patch: Partial<ReplyButtonValue>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const followUp = button.followUp ?? { type: 'none' as const };

  function setFollowUp(patch: Partial<ButtonFollowUp>) {
    onChange({ followUp: { ...followUp, ...patch } });
  }
  function setFollowUpContent(content: FollowUpContent) {
    onChange({ followUp: { ...followUp, content } });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center gap-2 p-2">
        <input
          value={button.title}
          onChange={(e) => onChange({ title: e.target.value.slice(0, 20) })}
          placeholder="Button title"
          maxLength={20}
          className={cn(inputCls, 'flex-1')}
        />
        <span className="shrink-0 text-[10px] text-neutral-400">{button.title.length}/20</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          aria-label={expanded ? 'Collapse follow-up' : 'Configure follow-up'}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-neutral-300 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-900/20"
          aria-label="Remove button"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-neutral-100 p-2 dark:border-neutral-800">
          <label className="block text-[11px] font-medium text-neutral-500">
            After this button is tapped…
          </label>
          <select
            value={followUp.type}
            onChange={(e) => setFollowUp({ type: e.target.value as FollowUpType, content: undefined })}
            className={selectCls}
          >
            <option value="none">Do nothing</option>
            <option value="text">Send a text message</option>
            <option value="image">Send an image</option>
            <option value="url_button">Send a URL button message</option>
            <option value="flow">Send a WhatsApp Flow</option>
          </select>

          {followUp.type === 'text' && (
            <textarea
              value={followUp.content?.message ?? ''}
              onChange={(e) => setFollowUpContent({ message: e.target.value })}
              placeholder="Message to send"
              rows={2}
              className={cn(inputCls, 'resize-none')}
            />
          )}

          {followUp.type === 'image' && (
            <div className="space-y-1.5">
              <input
                value={followUp.content?.url ?? ''}
                onChange={(e) => setFollowUpContent({ ...followUp.content, url: e.target.value })}
                placeholder="Image URL"
                className={inputCls}
              />
              <input
                value={followUp.content?.caption ?? ''}
                onChange={(e) => setFollowUpContent({ ...followUp.content, caption: e.target.value })}
                placeholder="Caption (optional)"
                className={inputCls}
              />
            </div>
          )}

          {followUp.type === 'url_button' && (
            <div className="space-y-1.5">
              <textarea
                value={followUp.content?.message ?? ''}
                onChange={(e) => setFollowUpContent({ ...followUp.content, message: e.target.value })}
                placeholder="Message text"
                rows={2}
                className={cn(inputCls, 'resize-none')}
              />
              <input
                value={followUp.content?.buttonText ?? ''}
                onChange={(e) => setFollowUpContent({ ...followUp.content, buttonText: e.target.value.slice(0, 20) })}
                placeholder="Button label (max 20 chars)"
                maxLength={20}
                className={inputCls}
              />
              <input
                value={followUp.content?.url ?? ''}
                onChange={(e) => setFollowUpContent({ ...followUp.content, url: e.target.value })}
                placeholder="https://…"
                className={inputCls}
              />
            </div>
          )}

          {followUp.type === 'flow' && (
            <FlowPicker
              value={followUp.content?.flowId ?? ''}
              onChange={(flowId) => setFollowUpContent({ flowId })}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Reuses the same ['whatsapp-flows'] query WhatsAppFlowsPanel.tsx and
// ComposerToolbar.tsx's Send-Flow picker already own — no separate fetch.
// Exported for the automation canvas's SendFlowEditor.tsx (send_flow node) —
// second caller, same reuse-before-duplicate reasoning as this file's own
// header comment.
export function FlowPicker({ value, onChange }: { value: string; onChange: (flowId: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-flows'],
    queryFn: () => apiFetch<{ flows: { flowId: string; name: string }[] }>('/api/whatsapp/flows'),
    staleTime: 60_000,
  });
  const flows = data?.flows ?? [];

  if (isLoading) return <p className="text-[11px] text-neutral-400">Loading Flows…</p>;
  if (flows.length === 0) {
    return <p className="text-[11px] text-neutral-400">No Flows registered yet — add one in Settings → WhatsApp.</p>;
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      <option value="">Select a Flow…</option>
      {flows.map((f) => <option key={f.flowId} value={f.flowId}>{f.name}</option>)}
    </select>
  );
}

// ── CTA-button mode ──────────────────────────────────────────────────────────

function CtaButtonList({ value, onChange }: { value: CtaButtonValue[]; onChange: (v: CtaButtonValue[]) => void }) {
  function addButton() {
    if (value.length >= MAX_CTA_BUTTONS) return;
    onChange([...value, { type: 'url', text: '', value: '' }]);
  }
  function updateButton(idx: number, patch: Partial<CtaButtonValue>) {
    onChange(value.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }
  function removeButton(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {value.map((btn, idx) => (
        <div key={idx} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
          <input
            value={btn.text}
            onChange={(e) => updateButton(idx, { text: e.target.value.slice(0, 20) })}
            placeholder="Button label"
            maxLength={20}
            className={cn(inputCls, 'w-40 shrink-0')}
          />
          <input
            value={btn.value}
            onChange={(e) => updateButton(idx, { value: e.target.value })}
            placeholder="https://…"
            className={cn(inputCls, 'flex-1')}
          />
          <button
            type="button"
            onClick={() => removeButton(idx)}
            className="shrink-0 rounded p-1 text-neutral-300 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-900/20"
            aria-label="Remove button"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {value.length < MAX_CTA_BUTTONS ? (
        <button
          type="button"
          onClick={addButton}
          className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          <Plus className="h-3.5 w-3.5" /> Add CTA button ({value.length}/{MAX_CTA_BUTTONS})
        </button>
      ) : (
        <p className="text-[11px] text-neutral-400">
          Meta&apos;s WhatsApp API supports one CTA button per message outside a pre-approved template (URL only — phone-call buttons require a template).
        </p>
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
const selectCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
