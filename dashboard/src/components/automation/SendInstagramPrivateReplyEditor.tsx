'use client';

import { Plus, X } from 'lucide-react';
import type { SendInstagramPrivateReplyConfig } from '@/types/automations';
import { Field, inputCls } from './ActionEditor';

/**
 * Config editor for the canvas's 'send_instagram_private_reply' node — DM #1
 * of a comment_received Follow Gate flow (ADR-021 R1/R2/R6). One unified
 * message list rather than a separate "message" field plus a separate
 * "variants" toggle: AutomationEngine.js's _pickInstagramVariant() picks
 * randomly from replyVariants when 2+ are set (the anti-spam feature, R6)
 * and falls back to a single messageText otherwise — this editor mirrors
 * that exactly, storing 1 entry as messageText and 2+ as replyVariants.
 */
export function SendInstagramPrivateReplyEditor({ config, onChange }: {
  config:   SendInstagramPrivateReplyConfig;
  onChange: (c: SendInstagramPrivateReplyConfig) => void;
}) {
  const variants = (config.replyVariants ?? []).filter((v) => v.trim());
  const messages = variants.length > 0 ? config.replyVariants! : [config.messageText ?? ''];

  function setMessages(next: string[]) {
    if (next.length <= 1) {
      onChange({ messageText: next[0] ?? '', replyVariants: undefined });
    } else {
      onChange({ messageText: undefined, replyVariants: next });
    }
  }

  function updateMessage(i: number, value: string) {
    setMessages(messages.map((m, idx) => (idx === i ? value : m)));
  }

  function addMessage() {
    setMessages([...messages, '']);
  }

  function removeMessage(i: number) {
    const next = messages.filter((_, idx) => idx !== i);
    setMessages(next.length > 0 ? next : ['']);
  }

  return (
    <div className="space-y-3">
      <Field
        label={messages.length > 1 ? 'Reply variants' : 'Message'}
        hint="Only reachable from a Comment Received trigger — sends a private reply to the commenter. Add a second variant to have one picked at random per send (Instagram can flag identical repeated replies as spam)."
      >
        <div className="space-y-1.5">
          {messages.map((m, i) => (
            <div key={i} className="flex items-start gap-2">
              <textarea
                value={m}
                onChange={(e) => updateMessage(i, e.target.value)}
                rows={3}
                className={inputCls}
                placeholder="Thanks for commenting! …"
              />
              {messages.length > 1 && (
                <button
                  onClick={() => removeMessage(i)}
                  className="mt-1 shrink-0 rounded p-1 text-neutral-400 hover:text-error-500"
                  aria-label="Remove variant"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </Field>

      <button
        onClick={addMessage}
        className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
      >
        <Plus className="h-3.5 w-3.5" /> Add variant
      </button>
    </div>
  );
}
