'use client';

import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { apiFetch, getMemoryToken } from '@/lib/api';
import { useCustomer360 } from '@/contexts/Customer360Context';
import { useWsEvent } from '@/hooks/useWsEvent';
import { useAddNote } from '@/hooks/useNoteMutations';
import { TemplatePicker } from '@/components/whatsapp/TemplatePicker';
import { MediaPreviewModal } from '@/components/whatsapp/MediaPreviewModal';
import { ActivityPanel } from '@/components/contacts/ActivityPanel';
import { META_SIZE_LIMITS } from '@/lib/mediaConstants';
import { toast } from 'sonner';
import type { WsMessage } from '@/lib/wsClient';
import type { ContactMessage, TimelineItem } from '@/lib/contacts/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ── Local types ───────────────────────────────────────────────────────────────
interface CannedResponse { id: string; title: string; body: string; shortcut?: string; }
interface EmployeeRecord { id: string; name: string; role: string; }
type UploadStage = 'idle' | 'uploading' | 'sending';

type DisplayItem =
  | { type: 'separator'; label: string; key: string }
  | { type: 'item'; item: TimelineItem; isGrouped: boolean };

// ── Constants ─────────────────────────────────────────────────────────────────
const CHAT_STATUS_CHIP: Record<string, string> = {
  open:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  unassigned: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  resolved:   'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

function dateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function fmtDateLabel(iso: string): string {
  const d = dateKey(iso);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (d === today) return 'Today';
  if (d === yesterday) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

function isSameGroup(curr: TimelineItem, prev: TimelineItem | undefined): boolean {
  if (!prev || curr._kind !== 'message' || prev._kind !== 'message') return false;
  if (curr.direction !== prev.direction) return false;
  return new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime() < 3 * 60_000;
}

function mediaKind(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

// ── Pure helpers (no React deps — safe outside component) ─────────────────────
async function computeHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function compressImageFile(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1920 / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob || blob.size >= file.size) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg', 0.82,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
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
      fetch(`${API_BASE}/api/whatsapp/s3-url?key=${encodeURIComponent(s3Key)}`, { credentials: 'include', headers })
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

  function download() {
    const a = document.createElement('a');
    a.href = src;
    a.download = filename ?? (mediaType === 'video' ? 'video' : 'media');
    a.click();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="absolute left-0 right-0 top-0 flex items-center justify-between px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="max-w-xs truncate text-sm text-white/70">
          {filename ?? (mediaType === 'video' ? 'Video' : 'Image')}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={download}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
          >
            ⬇ Download
          </button>
          <button
            onClick={onClose}
            aria-label="Close lightbox"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-lg text-white hover:bg-white/20"
          >
            ✕
          </button>
        </div>
      </div>
      {mediaType === 'video' ? (
        <video
          src={src} controls autoPlay
          className="max-h-[85vh] max-w-[90vw] rounded-xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
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
        <svg className="h-5 w-5 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      </div>
    );
  }
  if (error || nativeError) {
    return (
      <div className="mb-1.5 flex h-12 items-center gap-1.5 rounded-xl bg-slate-100 px-3 dark:bg-slate-700">
        <span className="text-lg" aria-hidden="true">🖼</span>
        <span className="text-xs text-slate-400">Media unavailable</span>
      </div>
    );
  }

  if (item.type === 'image' || item.type === 'sticker') {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
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
              <span className="ml-1 text-xl text-slate-800" aria-hidden="true">▶</span>
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
        <span aria-hidden="true">📄</span> {item.filename ?? 'Document'}
      </a>
    );
  }
  return null;
}

// ── MsgTick ───────────────────────────────────────────────────────────────────
function MsgTick({ status }: { status?: ContactMessage['msgStatus'] }) {
  if (!status || status === 'sent')  return <span className="ml-0.5 text-[10px] text-indigo-300" aria-label="Sent">✓</span>;
  if (status === 'delivered')        return <span className="ml-0.5 text-[10px] text-indigo-300" aria-label="Delivered">✓✓</span>;
  if (status === 'read')             return <span className="ml-0.5 text-[10px] text-sky-300"    aria-label="Read">✓✓</span>;
  if (status === 'failed')           return <span className="ml-0.5 text-[10px] text-red-400"    aria-label="Failed">✗</span>;
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
    <div
      role="listbox"
      aria-label="Canned responses"
      className="absolute bottom-full left-0 z-20 mb-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      {filtered.map((r) => (
        <button
          key={r.id}
          role="option"
          aria-selected={false}
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

// ── MentionPicker ─────────────────────────────────────────────────────────────
function MentionPicker({ employees, query, onSelect }: {
  employees: EmployeeRecord[];
  query: string;
  onSelect: (emp: EmployeeRecord) => void;
}) {
  const filtered = employees
    .filter((e) => !query || e.name.toLowerCase().startsWith(query.toLowerCase()))
    .slice(0, 6);
  if (filtered.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="Mention a team member"
      className="absolute bottom-full left-0 z-20 mb-1 w-56 overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xl dark:border-amber-900/40 dark:bg-slate-900"
    >
      {filtered.map((emp) => (
        <button
          key={emp.id}
          role="option"
          aria-selected={false}
          onMouseDown={(e) => { e.preventDefault(); onSelect(emp); }}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-amber-50 dark:hover:bg-amber-900/20"
        >
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white" aria-hidden="true">
            {emp.name[0]}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-slate-800 dark:text-white">{emp.name}</p>
            <p className="text-[10px] capitalize text-slate-400">{emp.role}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── ConversationPane (inner) ──────────────────────────────────────────────────
function ConversationPane() {
  const { leadId, contact, timeline, windowExpired, refresh } = useCustomer360();
  const qc = useQueryClient();

  // ── Lazy queries ───────────────────────────────────────────────────────────
  const { data: cannedData } = useQuery({
    queryKey: ['wa-canned'],
    queryFn: () => apiFetch<{ responses: CannedResponse[] }>('/api/whatsapp/inbox/canned'),
    staleTime: 60_000,
  });
  const canned: CannedResponse[] = cannedData?.responses ?? [];

  const { data: employeesData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () =>
      apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/admin/employees').catch(
        () => ({ success: true, data: [] }),
      ),
    staleTime: 10 * 60_000,
  });
  const employees: EmployeeRecord[] = employeesData?.data ?? [];

  // ── Panel toggle (persisted) ───────────────────────────────────────────────
  const [showPanel, setShowPanel] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('c360-panel') !== 'false';
  });

  function togglePanel() {
    setShowPanel((v) => {
      const next = !v;
      localStorage.setItem('c360-panel', String(next));
      return next;
    });
  }

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

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadCaption, setUploadCaption] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [isDragging, setIsDragging] = useState(false);

  // Mention state
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentionPicker, setShowMentionPicker] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);

  // ── Date-separated, grouped display items ─────────────────────────────────
  const displayItems = useMemo<DisplayItem[]>(() => {
    const result: DisplayItem[] = [];
    let lastDay = '';
    for (let i = 0; i < timeline.length; i++) {
      const item = timeline[i];
      const day = dateKey(item.timestamp);
      if (day !== lastDay) {
        result.push({ type: 'separator', label: fmtDateLabel(item.timestamp), key: `sep-${day}` });
        lastDay = day;
      }
      const prev = i > 0 ? timeline[i - 1] : undefined;
      result.push({ type: 'item', item, isGrouped: isSameGroup(item, prev) });
    }
    return result;
  }, [timeline]);

  // ── Real-time: WS event → refresh contact query ───────────────────────────
  const handleWsMessage = useCallback(
    (wsMsg: WsMessage) => {
      const p = wsMsg as WsMessage & { conversationId?: string; isUnknown?: boolean };
      if (!p.isUnknown && p.conversationId === leadId) refresh();
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

  // ── Mark-read ──────────────────────────────────────────────────────────────
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

  // ── Upload helpers ─────────────────────────────────────────────────────────
  function applyFile(file: File) {
    setUploadError('');
    const kind = mediaKind(file.type);
    const limit = META_SIZE_LIMITS[kind];
    if (file.size > limit) {
      toast.error(`${kind} files must be under ${limit / 1024 / 1024} MB (Meta limit)`);
      return;
    }
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadFile(file);
    setUploadPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    setUploadStage('idle');
    setUploadProgress(0);
    setUploadCaption('');
  }

  function resetUpload() {
    setUploadFile(null);
    setUploadPreview(null);
    setUploadCaption('');
    setUploadError('');
    setUploadProgress(0);
    setUploadStage('idle');
    if (fileRef.current) fileRef.current.value = '';
  }

  function cancelUpload() {
    uploadXhrRef.current?.abort();
    resetUpload();
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const uploadMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      if (!uploadFile || !contact?.PK) throw new Error('Missing file or contact');
      setUploadStage('uploading');
      setUploadProgress(0);

      let file = uploadFile;
      if (file.type.startsWith('image/') && file.size > 500 * 1024) {
        file = await compressImageFile(file);
      }

      const [hashHex, urlData] = await Promise.all([
        computeHash(file),
        apiFetch<{ uploadUrl: string; key: string }>(
          `/api/whatsapp/upload-url?mimeType=${encodeURIComponent(file.type)}&filename=${encodeURIComponent(file.name)}&fileSize=${file.size}`,
        ),
      ]);

      const { uploadUrl, key } = urlData;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadXhrRef.current = xhr;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status > 0 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.onabort = () => reject(new Error('Upload cancelled'));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });
      uploadXhrRef.current = null;

      setUploadStage('sending');

      return apiFetch('/api/whatsapp/upload-send', {
        method: 'POST',
        body: JSON.stringify({
          leadPK: contact.PK,
          s3Key: key,
          mimeType: file.type,
          filename: file.name,
          caption: uploadCaption || undefined,
          fileHash: hashHex,
        }),
      });
    },
    onSuccess: () => { resetUpload(); refresh(); },
    onError: (err: Error) => {
      if (err.message === 'Upload cancelled') return;
      setUploadError(err.message ?? 'Upload failed');
      setUploadStage('idle');
      setUploadProgress(0);
    },
  });

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

  const noteMutation = useAddNote(leadId, () => { setMsgText(''); refresh(); });

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

  // ── Handlers ──────────────────────────────────────────────────────────────
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
    if (inputMode === 'note') {
      const cursor = inputRef.current?.selectionStart ?? val.length;
      const match = val.slice(0, cursor).match(/@(\w*)$/);
      if (match) {
        setMentionQuery(match[1]);
        setShowMentionPicker(true);
      } else {
        setShowMentionPicker(false);
        setMentionQuery('');
      }
    }
  }

  function insertMention(emp: EmployeeRecord) {
    const cursor = inputRef.current?.selectionStart ?? msgText.length;
    const before = msgText.slice(0, cursor);
    const after = msgText.slice(cursor);
    const atIdx = before.lastIndexOf('@');
    const firstName = emp.name.split(' ')[0];
    const newText = `${before.slice(0, atIdx)}@${firstName} ${after}`;
    setMsgText(newText);
    setShowMentionPicker(false);
    setMentionQuery('');
    setTimeout(() => {
      const newPos = atIdx + firstName.length + 2;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newPos, newPos);
    }, 0);
  }

  // ── Clipboard paste — activate upload for images ───────────────────────────
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (inputMode !== 'reply' || windowExpired) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); applyFile(file); }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode, windowExpired]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full">

      {/* ── Main chat column ──────────────────────────────────────────────── */}
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
          <button
            onClick={togglePanel}
            aria-label={showPanel ? 'Hide info panel' : 'Show info panel'}
            aria-pressed={showPanel}
            className={`hidden rounded-lg border px-2.5 py-1.5 text-xs lg:block ${
              showPanel
                ? 'border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400'
                : 'border-slate-200 text-slate-400 hover:bg-slate-50 dark:border-slate-700'
            }`}
          >
            ☰ Info
          </button>
        </div>

        {/* 24h window warning */}
        {windowExpired && inputMode === 'reply' && !showTemplatePicker && (
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-100 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/20" role="alert">
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
          className="flex-1 overflow-y-auto p-4"
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
        >
          {timeline.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <span className="text-4xl" aria-hidden="true">💬</span>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No messages yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Start the conversation by sending a message below.
              </p>
            </div>
          )}

          {displayItems.map((di) => {
            // ── Date separator ────────────────────────────────────────────
            if (di.type === 'separator') {
              return (
                <div key={di.key} className="flex items-center gap-3 py-3 first:pt-0">
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                  <span className="flex-shrink-0 rounded-full bg-slate-100 px-3 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {di.label}
                  </span>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                </div>
              );
            }

            const { item, isGrouped } = di;
            const topMargin = isGrouped ? 'mt-0.5' : 'mt-2';

            // ── Internal note ─────────────────────────────────────────────
            if (item._kind === 'note') {
              const parts = item.content.split(/(@\w+)/g);
              return (
                <div key={item.SK} className={`flex justify-center ${topMargin}`}>
                  <div className="max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900/30 dark:bg-amber-900/10">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <span aria-hidden="true">🔒</span> Internal note · {item.authorName ?? 'Agent'}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-amber-700 dark:text-amber-300">
                      {parts.map((part, i) =>
                        part.match(/^@\w+$/)
                          ? <span key={i} className="font-bold text-amber-600 dark:text-amber-300">{part}</span>
                          : part
                      )}
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
                className={`group flex items-end gap-1 ${outbound ? 'flex-row-reverse' : ''} ${topMargin}`}
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

        {/* ── Input area ──────────────────────────────────────────────────── */}
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
                onClick={() => {
                  setInputMode(m);
                  setMsgText('');
                  setShowCanned(false);
                  setShowMentionPicker(false);
                }}
                className={`px-4 py-2 text-xs font-semibold capitalize transition-colors ${
                  inputMode === m
                    ? m === 'note'
                      ? 'border-b-2 border-amber-500 text-amber-600 dark:text-amber-400'
                      : 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
                aria-pressed={inputMode === m}
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
            {inputMode === 'note' && employees.length > 0 && (
              <span className="ml-auto px-4 py-2 text-xs text-slate-400">
                @ to mention
              </span>
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
            {showMentionPicker && inputMode === 'note' && (
              <MentionPicker
                employees={employees}
                query={mentionQuery}
                onSelect={insertMention}
              />
            )}

            {/* Hidden file input */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xlsx,.xls,.csv,.txt"
              aria-hidden="true"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) applyFile(file); }}
              className="hidden"
            />

            {/* Drag-drop zone */}
            {isDragging && (
              <div
                className="mb-2 flex items-center justify-center rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50 py-4 text-sm text-indigo-500 dark:bg-indigo-900/20"
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) applyFile(file);
                }}
              >
                Drop file here to send
              </div>
            )}

            <div
              className="flex gap-2"
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) applyFile(file);
              }}
            >
              {inputMode === 'reply' && !windowExpired && (
                <button
                  onClick={() => fileRef.current?.click()}
                  title="Attach image, video or document"
                  aria-label="Attach file"
                  className="flex-shrink-0 rounded-xl border border-slate-200 px-3 py-2.5 text-slate-400 transition hover:text-indigo-600 dark:border-slate-700"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              )}
              <input
                ref={inputRef}
                value={msgText}
                onChange={(e) => handleMsgChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && canSend) { e.preventDefault(); handleSend(); }
                  if (e.key === 'Escape') {
                    setShowCanned(false);
                    setShowMentionPicker(false);
                    setReplyTo(null);
                  }
                }}
                disabled={windowExpired && inputMode === 'reply'}
                placeholder={
                  windowExpired && inputMode === 'reply'
                    ? '24h window expired — use Template or leave a Note'
                    : inputMode === 'note'
                      ? '🔒 Internal note… type @ to mention someone'
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
              <p className="mt-1 text-xs text-red-500" role="alert">
                Failed to send — check WhatsApp connection in{' '}
                <a href="/admin/whatsapp/settings" className="underline">WhatsApp Settings</a>.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Right activity panel ───────────────────────────────────────────── */}
      {showPanel && (
        <ActivityPanel className="hidden lg:flex w-56 flex-shrink-0" />
      )}

      {/* ── Media preview modal ────────────────────────────────────────────── */}
      {uploadFile && (
        <MediaPreviewModal
          file={uploadFile}
          previewUrl={uploadPreview}
          caption={uploadCaption}
          onCaptionChange={setUploadCaption}
          onSend={() => uploadMutation.mutate()}
          onClose={() => { cancelUpload(); }}
          uploadStage={uploadStage}
          uploadProgress={uploadProgress}
          uploadError={uploadError}
          recipientName={contact?.name ?? contact?.phone ?? 'contact'}
        />
      )}
    </div>
  );
}

// Memoized export — isolates conversation rerenders from unrelated header updates
export const ConversationTab = memo(ConversationPane);
