'use client';

import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, getMemoryToken } from '@/lib/api';
import { useCustomer360 } from '@/contexts/Customer360Context';
import { useWsEvent } from '@/hooks/useWsEvent';
import { TemplatePicker } from '@/components/whatsapp/TemplatePicker';
import { toast } from 'sonner';
import type { WsMessage } from '@/lib/wsClient';
import type { ContactMessage } from '@/lib/contacts/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ── Local types ───────────────────────────────────────────────────────────────
interface CannedResponse { id: string; title: string; body: string; shortcut?: string; }

const CHAT_STATUS_CHIP: Record<string, string> = {
  open:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  unassigned: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  resolved:   'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

// ── useMediaSrc ───────────────────────────────────────────────────────────────
function useMediaSrc(mediaId: string | null, s3Key: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setSrc(null);
    setError(false);
    let objectUrl: string | null = null;
    let cancelled = false;
    const token = getMemoryToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    if (s3Key) {
      fetch(`${API_BASE}/api/whatsapp/s3-url?key=${encodeURIComponent(s3Key)}`, {
        credentials: 'include', headers,
      })
        .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
        .then((d) => { if (!cancelled) { setSrc(d.url ?? null); if (!d.url) setError(true); } })
        .catch(() => { if (!cancelled) setError(true); });
    } else if (mediaId) {
      fetch(`${API_BASE}/api/whatsapp/media/${mediaId}`, { credentials: 'include', headers })
        .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.blob(); })
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        })
        .catch(() => { if (!cancelled) setError(true); });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaId, s3Key]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { src, error };
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ src, filename, mediaType = 'image', onClose }: {
  src: string; filename?: string; mediaType?: 'image' | 'video'; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="absolute left-0 right-0 top-0 flex items-center justify-between px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="max-w-xs truncate text-sm text-white/70">{filename ?? (mediaType === 'video' ? 'Video' : 'Image')}</span>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-lg text-white hover:bg-white/20"
        >
          ✕
        </button>
      </div>
      {mediaType === 'video' ? (
        <video
          src={src} controls autoPlay
          className="max-h-[85vh] max-w-[90vw] rounded-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img
          src={src} alt={filename ?? 'media'}
          className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}

// ── MediaBubble ───────────────────────────────────────────────────────────────
function MediaBubble({ item, outbound }: { item: ContactMessage; outbound: boolean }) {
  const [lightbox, setLightbox] = useState(false);
  const [nativeError, setNativeError] = useState(false);

  const staticUrl = item.mediaUrl ?? null;
  const { src: resolvedSrc, error } = useMediaSrc(
    staticUrl ? null : (item.mediaId ?? null),
    staticUrl ? null : (item.s3Key ?? null),
  );
  const src = staticUrl ?? resolvedSrc;

  if (!src && !error) {
    return (
      <div className="mb-1.5 flex h-24 w-40 items-center justify-center rounded-xl bg-slate-200 dark:bg-slate-700">
        <svg className="h-5 w-5 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      </div>
    );
  }
  if (error || nativeError) {
    return (
      <div className="mb-1.5 flex h-12 items-center gap-1.5 rounded-xl bg-slate-100 px-3 dark:bg-slate-700">
        <span className="text-lg">🖼</span>
        <span className="text-xs text-slate-400">Media unavailable</span>
      </div>
    );
  }

  if (item.type === 'image' || item.type === 'sticker') {
    return (
      <>
        <img
          src={src!}
          alt={item.type === 'sticker' ? 'sticker' : 'photo'}
          onClick={() => setLightbox(true)}
          onError={() => setNativeError(true)}
          className={`mb-1.5 cursor-pointer rounded-xl object-cover ${item.type === 'sticker' ? 'h-20 w-20' : 'max-h-48 w-full'}`}
        />
        {lightbox && <Lightbox src={src!} onClose={() => setLightbox(false)} />}
      </>
    );
  }
  if (item.type === 'video') {
    return (
      <>
        <div
          className="relative mb-1.5 max-h-48 w-full cursor-pointer overflow-hidden rounded-xl"
          onClick={() => setLightbox(true)}
        >
          <video preload="metadata" src={src!} onError={() => setNativeError(true)} className="max-h-48 w-full rounded-xl object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/35">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/85 shadow-lg">
              <span className="ml-1 text-xl text-slate-800">▶</span>
            </div>
          </div>
        </div>
        {lightbox && <Lightbox src={src!} mediaType="video" filename={item.filename} onClose={() => setLightbox(false)} />}
      </>
    );
  }
  if (item.type === 'audio') {
    return <audio controls src={src!} className="mb-1.5 w-full max-w-[220px]" />;
  }
  if (item.type === 'document') {
    return (
      <a
        href={src!} download={item.filename ?? true}
        className={`mb-1.5 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
          outbound
            ? 'border-indigo-400/40 bg-indigo-500/30 text-indigo-100'
            : 'border-slate-200 bg-slate-50 text-indigo-600 dark:border-slate-700 dark:bg-slate-700 dark:text-indigo-400'
        }`}
      >
        📄 {item.filename ?? 'Document'}
      </a>
    );
  }
  return null;
}

// ── MsgTick ───────────────────────────────────────────────────────────────────
function MsgTick({ status }: { status?: ContactMessage['msgStatus'] }) {
  if (!status || status === 'sent')      return <span className="ml-0.5 text-[10px] text-indigo-300">✓</span>;
  if (status === 'delivered')            return <span className="ml-0.5 text-[10px] text-indigo-300">✓✓</span>;
  if (status === 'read')                 return <span className="ml-0.5 text-[10px] text-sky-300">✓✓</span>;
  if (status === 'failed')               return <span className="ml-0.5 text-[10px] text-red-400">✗</span>;
  return null;
}

// ── CannedPicker ──────────────────────────────────────────────────────────────
function CannedPicker({ responses, filter, onSelect, onClose }: {
  responses: CannedResponse[];
  filter: string;
  onSelect: (body: string) => void;
  onClose: () => void;
}) {
  const filtered = responses.filter(
    (r) => !filter || r.title.toLowerCase().includes(filter) || (r.shortcut ?? '').includes(filter)
  );
  if (filtered.length === 0) { onClose(); return null; }
  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {filtered.map((r) => (
        <button
          key={r.id}
          onClick={() => onSelect(r.body)}
          className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-900 dark:text-white">{r.title}</span>
            {r.shortcut && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-500 dark:bg-slate-800">
                /{r.shortcut}
              </span>
            )}
          </div>
          <span className="truncate text-xs text-slate-400">{r.body}</span>
        </button>
      ))}
    </div>
  );
}

// ── ConversationPane (inner, not memoized at this level) ──────────────────────
function ConversationPane() {
  const {
    leadId, contact, timeline, windowExpired, refresh,
  } = useCustomer360();
  const qc = useQueryClient();

  // ── Lazy queries (load only when this tab is mounted) ──────────────────────
  // employees query reserved for @mentions (Commit 3 — MentionPicker)
  const { data: cannedData } = useQuery({
    queryKey: ['wa-canned'],
    queryFn: () => apiFetch<{ responses: CannedResponse[] }>('/api/whatsapp/inbox/canned'),
    staleTime: 60_000,
  });
  const canned: CannedResponse[] = cannedData?.responses ?? [];

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [msgText, setMsgText] = useState('');
  const [inputMode, setInputMode] = useState<'reply' | 'note'>('reply');
  const [showCanned, setShowCanned] = useState(false);
  const [cannedSearch, setCannedSearch] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [replyTo, setReplyTo] = useState<{
    waMessageId: string;
    content: string;
    direction: 'inbound' | 'outbound';
    senderName?: string | null;
  } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // ── Real-time: WS event → refresh contact query ───────────────────────────
  const handleWsMessage = useCallback(
    (wsMsg: WsMessage) => {
      const p = wsMsg as WsMessage & {
        conversationId?: string;
        isUnknown?: boolean;
      };
      if (!p.isUnknown && p.conversationId === leadId) {
        refresh();
      }
    },
    [leadId, refresh],
  );
  useWsEvent('whatsapp_message', handleWsMessage);

  // ── Scroll behaviour ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    isNearBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  }, [leadId]);

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [timeline.length]);

  // ── Mark-read ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!leadId) return;
    const lastInbound = timeline
      .filter((t) => t._kind === 'message' && t.direction === 'inbound' && t.waMessageId)
      .at(-1);
    if (!lastInbound?.waMessageId) return;
    apiFetch(`/api/whatsapp/inbox/${leadId}/mark-read`, {
      method: 'POST',
      body: JSON.stringify({ lastWaMessageId: lastInbound.waMessageId }),
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, timeline.length]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  type SendVars = { text: string; reply: typeof replyTo };

  const sendMutation = useMutation<unknown, Error, SendVars, { snapshot: unknown }>({
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['contact', leadId] });
      const snapshot = qc.getQueryData(['contact', leadId]);
      const now = new Date().toISOString();
      qc.setQueryData(['contact', leadId], (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const data = old as Record<string, unknown>;
        const msgs = (data.messages ?? []) as ContactMessage[];
        return {
          ...data,
          messages: [
            ...msgs,
            {
              SK: `MSG#${now}#opt`,
              direction: 'outbound',
              content: vars.text,
              timestamp: now,
              type: 'text',
              msgStatus: 'sending',
              ...(vars.reply && {
                replyToContent: vars.reply.content,
                replyToDirection: vars.reply.direction,
                replyToSenderName: vars.reply.senderName ?? null,
              }),
            } satisfies ContactMessage,
          ],
        };
      });
      setMsgText('');
      setShowCanned(false);
      setReplyTo(null);
      return { snapshot };
    },
    mutationFn: ({ text, reply }) =>
      apiFetch('/api/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({
          leadPK: contact?.PK,
          message: text,
          ...(reply?.waMessageId && {
            replyToWaMessageId: reply.waMessageId,
            replyToContent: reply.content,
            replyToDirection: reply.direction,
            replyToSenderName: reply.senderName ?? null,
          }),
        }),
      }),
    onError: (_err, vars, ctx) => {
      if (ctx?.snapshot !== undefined) qc.setQueryData(['contact', leadId], ctx.snapshot);
      setMsgText(vars.text);
    },
    onSettled: () => { refresh(); },
  });

  const noteMutation = useMutation({
    mutationFn: (content: string) =>
      apiFetch(`/api/whatsapp/inbox/${leadId}/note`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => { setMsgText(''); refresh(); },
  });

  const resolveMutation = useMutation({
    mutationFn: () => apiFetch(`/api/whatsapp/inbox/${leadId}/resolve`, { method: 'PUT' }),
    onSuccess: () => { refresh(); toast.success('Conversation resolved'); },
    onError: () => toast.error('Failed to resolve conversation'),
  });

  const reopenMutation = useMutation({
    mutationFn: () => apiFetch(`/api/whatsapp/inbox/${leadId}/reopen`, { method: 'PUT' }),
    onSuccess: () => { refresh(); toast.success('Conversation reopened'); },
    onError: () => toast.error('Failed to reopen conversation'),
  });

  // ── Derived state ──────────────────────────────────────────────────────────
  const chatStatus = contact?.chatStatus ?? 'open';
  const isProcessing = sendMutation.isPending || noteMutation.isPending;
  const canSend = msgText.trim().length > 0 && !isProcessing && (inputMode === 'note' || !windowExpired);

  function handleSend() {
    if (!msgText.trim()) return;
    if (inputMode === 'note') {
      noteMutation.mutate(msgText);
    } else {
      sendMutation.mutate({ text: msgText, reply: replyTo });
    }
  }

  function handleMsgChange(val: string) {
    setMsgText(val);
    if (val.startsWith('/') && inputMode === 'reply') {
      setShowCanned(true);
      setCannedSearch(val.slice(1).toLowerCase());
    } else {
      setShowCanned(false);
      setCannedSearch('');
    }
  }

  // ── Clipboard paste (images) ───────────────────────────────────────────────
  // Placeholder: paste is acknowledged but upload is deferred to Commit 3.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (inputMode !== 'reply') return;
      const hasImage = Array.from(e.clipboardData?.files ?? []).some((f) => f.type.startsWith('image/'));
      if (hasImage) {
        e.preventDefault();
        toast.info('Attachment upload is coming in the next update.');
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [inputMode]);

  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

  return (
    <div className="flex h-full">

      {/* ── Main chat column ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Status bar + actions */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-100 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${CHAT_STATUS_CHIP[chatStatus] ?? ''}`}
          >
            {chatStatus}
          </span>
          <span className="flex-1" />
          {chatStatus !== 'resolved' && (
            <button
              onClick={() => resolveMutation.mutate()}
              disabled={resolveMutation.isPending}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-400"
            >
              ✓ Resolve
            </button>
          )}
          {chatStatus === 'resolved' && (
            <button
              onClick={() => reopenMutation.mutate()}
              disabled={reopenMutation.isPending}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              ↺ Reopen
            </button>
          )}
        </div>

        {/* 24h window warning */}
        {windowExpired && inputMode === 'reply' && !showTemplatePicker && (
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-100 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/20">
            <span className="text-lg" aria-hidden="true">⚠️</span>
            <p className="flex-1 text-xs text-amber-800 dark:text-amber-300">
              <strong>24-hour window expired.</strong> The customer must message first, or use a template.
            </p>
            <button
              onClick={() => setShowTemplatePicker(true)}
              className="flex-shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-700 active:bg-amber-800"
            >
              Send Template →
            </button>
          </div>
        )}
        {windowExpired && inputMode === 'reply' && showTemplatePicker && contact && (
          <div className="flex-shrink-0 border-b border-amber-100 p-3 dark:border-amber-900/30">
            <TemplatePicker
              leadId={leadId}
              phone={contact.phone}
              onSent={() => { setShowTemplatePicker(false); refresh(); }}
              onCancel={() => setShowTemplatePicker(false)}
            />
          </div>
        )}

        {/* Message list */}
        <div
          ref={chatContainerRef}
          className="flex-1 space-y-2 overflow-y-auto p-4"
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
        >
          {timeline.length === 0 && (
            <p className="py-12 text-center text-sm text-slate-400">No messages yet.</p>
          )}

          {timeline.map((item) => {
            // ── Internal note ─────────────────────────────────────────────
            if (item._kind === 'note') {
              return (
                <div key={item.SK} className="flex justify-center">
                  <div className="max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900/30 dark:bg-amber-900/10">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      🔒 Internal note · {item.authorName ?? 'Agent'}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-amber-700 dark:text-amber-300">
                      {item.content}
                    </p>
                    <p className="mt-1 text-[10px] text-amber-500">{fmtTime(item.timestamp)}</p>
                  </div>
                </div>
              );
            }

            // ── Chat message ──────────────────────────────────────────────
            const isMedia = MEDIA_TYPES.has(item.type ?? '');
            const outbound = item.direction === 'outbound';

            return (
              <div
                key={item.SK}
                className={`group flex items-end gap-1 ${outbound ? 'flex-row-reverse' : ''}`}
              >
                {/* Reply button */}
                {item.waMessageId && !windowExpired && (
                  <button
                    onClick={() => {
                      setReplyTo({
                        waMessageId: item.waMessageId!,
                        content: item.content,
                        direction: item.direction,
                        senderName: item.sentByName ?? null,
                      });
                      setInputMode('reply');
                      inputRef.current?.focus();
                    }}
                    className="mb-1 flex-shrink-0 rounded-full p-1 text-xs text-slate-300 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-700 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
                    aria-label="Reply to this message"
                  >
                    ↩
                  </button>
                )}

                {/* Bubble */}
                <div
                  className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    outbound
                      ? 'rounded-br-sm bg-indigo-600 text-white'
                      : 'rounded-bl-sm bg-white text-slate-900 shadow-none ring-1 ring-slate-100 dark:bg-slate-800 dark:text-white dark:ring-slate-700'
                  }`}
                >
                  {/* Reply context */}
                  {item.replyToContent && (
                    <div
                      className={`mb-2 rounded-lg border-l-2 px-2.5 py-1.5 text-xs ${
                        outbound
                          ? 'border-indigo-300 bg-indigo-500/30'
                          : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-700/60'
                      }`}
                    >
                      <p className={`mb-0.5 font-semibold ${outbound ? 'text-indigo-200' : 'text-slate-500 dark:text-slate-400'}`}>
                        {item.replyToDirection === 'inbound' ? 'Customer' : (item.replyToSenderName ?? 'You')}
                      </p>
                      <p className={`truncate ${outbound ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-300'}`}>
                        {item.replyToContent}
                      </p>
                    </div>
                  )}

                  {/* Media */}
                  {isMedia && (item.mediaId || item.mediaUrl) && (
                    <MediaBubble item={item} outbound={outbound} />
                  )}

                  {/* Text */}
                  {item.content && item.content !== `[${item.type}]` && (
                    <p className="whitespace-pre-wrap break-words">{item.content}</p>
                  )}
                  {item.content === `[${item.type}]` && isMedia && !item.mediaId && !item.mediaUrl && (
                    <p className="text-xs italic opacity-60">{item.content}</p>
                  )}

                  {/* Timestamp + tick */}
                  <p className={`mt-1 flex items-center gap-0.5 text-[10px] ${outbound ? 'text-indigo-200' : 'text-slate-400'}`}>
                    {outbound && item.sentByName ? `${item.sentByName} · ` : ''}
                    {fmtTime(item.timestamp)}
                    {outbound && <MsgTick status={item.msgStatus} />}
                  </p>
                </div>
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>

        {/* ── Input area ─────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">

          {/* Reply preview */}
          {replyTo && (
            <div className="flex items-start gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/50">
              <div className="min-w-0 flex-1 border-l-2 border-indigo-400 pl-2">
                <p className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                  Replying to {replyTo.direction === 'inbound' ? 'Customer' : (replyTo.senderName ?? 'You')}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{replyTo.content}</p>
              </div>
              <button
                onClick={() => setReplyTo(null)}
                className="mt-0.5 flex-shrink-0 text-sm leading-none text-slate-400 hover:text-red-500"
                aria-label="Cancel reply"
              >
                ×
              </button>
            </div>
          )}

          {/* Mode tabs */}
          <div className="flex border-b border-slate-100 dark:border-slate-800">
            {(['reply', 'note'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setInputMode(m); setMsgText(''); setShowCanned(false); }}
                className={`px-4 py-2 text-xs font-semibold capitalize transition-colors ${
                  inputMode === m
                    ? m === 'note'
                      ? 'border-b-2 border-amber-500 text-amber-600 dark:text-amber-400'
                      : 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {m === 'reply' ? '💬 Reply' : '🔒 Note'}
              </button>
            ))}
            {inputMode === 'reply' && canned.length > 0 && (
              <button
                onClick={() => { setShowCanned((v) => !v); setCannedSearch(''); }}
                className="ml-auto px-4 py-2 text-xs text-slate-400 hover:text-indigo-600"
              >
                ⚡ Canned
              </button>
            )}
          </div>

          {/* Input row */}
          <div className="relative p-3">
            {showCanned && inputMode === 'reply' && (
              <CannedPicker
                responses={canned}
                filter={cannedSearch}
                onSelect={(body) => { setMsgText(body); setShowCanned(false); inputRef.current?.focus(); }}
                onClose={() => setShowCanned(false)}
              />
            )}

            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={msgText}
                onChange={(e) => handleMsgChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && canSend) { e.preventDefault(); handleSend(); }
                  if (e.key === 'Escape') { setShowCanned(false); setReplyTo(null); }
                }}
                disabled={windowExpired && inputMode === 'reply'}
                placeholder={
                  windowExpired && inputMode === 'reply'
                    ? '24h window expired — use Template or leave a Note'
                    : inputMode === 'note'
                      ? '🔒 Internal note (not sent to customer)…'
                      : 'Type / for canned responses, or write a message…'
                }
                aria-label={inputMode === 'note' ? 'Internal note' : 'Message'}
                className={`flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-1 dark:text-white ${
                  inputMode === 'note'
                    ? 'border-amber-200 bg-amber-50 focus:border-amber-400 focus:ring-amber-200 dark:border-amber-900/30 dark:bg-amber-900/10'
                    : windowExpired
                      ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800'
                      : 'border-slate-200 bg-slate-50 focus:border-indigo-400 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800'
                }`}
              />
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-40 ${
                  inputMode === 'note' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
                aria-label={inputMode === 'note' ? 'Post note' : 'Send message'}
              >
                {isProcessing ? '…' : inputMode === 'note' ? '🔒' : '➤'}
              </button>
            </div>

            {(sendMutation.isError || noteMutation.isError) && (
              <p className="mt-1 text-xs text-red-500">
                Failed to send — check WhatsApp connection in{' '}
                <a href="/admin/whatsapp/settings" className="underline">WhatsApp Settings</a>.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Right activity panel — reserved for future widgets ────────────── */}
      {/* Upcoming Tasks, Next Follow-up, SLA, AI Suggestions, Automation Status */}
      <div
        data-slot="activity-panel"
        className="hidden w-0 overflow-hidden"
        aria-hidden="true"
      />
    </div>
  );
}

// Memoized export — isolates conversation rerenders from unrelated header updates
export const ConversationTab = memo(ConversationPane);
