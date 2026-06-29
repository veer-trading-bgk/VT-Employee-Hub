'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { TemplatePicker } from '@/components/whatsapp/TemplatePicker';
import { apiFetch, getMemoryToken } from '@/lib/api';
import { useInbox, timeAgo, avatarLetters, CHAT_STATUS_CHIP } from '@/contexts/InboxContext';
import type { Message, CannedResponse, EmployeeRecord } from '@/contexts/InboxContext';
import { META_SIZE_LIMITS } from '@/lib/mediaConstants';
import { Paperclip } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ── CannedPicker ──────────────────────────────────────────────────────────────
function CannedPicker({
  responses, filter, onSelect, onClose,
}: {
  responses: CannedResponse[];
  filter: string;
  onSelect: (body: string) => void;
  onClose: () => void;
}) {
  const filtered = responses.filter(
    (r) => !filter || r.title.toLowerCase().includes(filter) || (r.shortcut ?? '').includes(filter)
  );
  if (filtered.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 w-full max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {filtered.map((r) => (
        <button key={r.id} onClick={() => onSelect(r.body)}
          className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-900 dark:text-white">{r.title}</span>
            {r.shortcut && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-mono text-slate-500 dark:bg-slate-800">/{r.shortcut}</span>}
          </div>
          <span className="truncate text-xs text-slate-400">{r.body}</span>
        </button>
      ))}
    </div>
  );
}

// ── MentionPicker ─────────────────────────────────────────────────────────────
function MentionPicker({
  employees, query, onSelect,
}: {
  employees: EmployeeRecord[];
  query: string;
  onSelect: (emp: EmployeeRecord) => void;
}) {
  const filtered = employees.filter((e) =>
    !query || e.name.toLowerCase().startsWith(query.toLowerCase())
  ).slice(0, 6);
  if (filtered.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 w-56 overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xl dark:border-amber-900/40 dark:bg-slate-900">
      {filtered.map((emp) => (
        <button key={emp.id} onMouseDown={(e) => { e.preventDefault(); onSelect(emp); }}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-amber-50 dark:hover:bg-amber-900/20">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
            {emp.name[0]}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-slate-800 dark:text-white">{emp.name}</p>
            <p className="text-[10px] text-slate-400 capitalize">{emp.role}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── CannedModal ───────────────────────────────────────────────────────────────
function CannedModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [loading, setLoading] = useState(false);

  async function save() {
    if (!title.trim() || !body.trim()) return;
    setLoading(true);
    try {
      await apiFetch('/api/whatsapp/inbox/canned', { method: 'POST', body: JSON.stringify({ title, body, shortcut }) });
      onSaved();
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-white">New Canned Response</h3>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Greeting)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="Shortcut (e.g. greet) — optional"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message body…" rows={4}
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          <p className="text-xs text-slate-400">Use <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{'{{name}}'}</code> for contact name</p>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-500 dark:border-slate-700">Cancel</button>
          <button onClick={save} disabled={loading || !title.trim() || !body.trim()}
            className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MsgTick ───────────────────────────────────────────────────────────────────
function MsgTick({ status }: { status?: Message['msgStatus'] }) {
  if (!status || status === 'sent') return <span className="ml-0.5 text-[10px] text-indigo-300">✓</span>;
  if (status === 'delivered') return <span className="ml-0.5 text-[10px] text-indigo-300">✓✓</span>;
  if (status === 'read') return <span className="ml-0.5 text-[10px] text-sky-300">✓✓</span>;
  if (status === 'failed') return <span className="ml-0.5 text-[10px] text-red-400">✗</span>;
  return null;
}

// ── useMediaSrc ───────────────────────────────────────────────────────────────
function useMediaSrc(mediaId: string | null, s3Key: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

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
        .then((data) => { if (!cancelled) setSrc(data.url ?? null); if (!data.url) setError(true); })
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

  return { src, error };
}

// ── MediaPreviewModal ─────────────────────────────────────────────────────────
function MediaPreviewModal({
  file, previewUrl, caption, onCaptionChange, onSend, onClose,
  uploadStage, uploadProgress, uploadError, recipientName,
}: {
  file: File;
  previewUrl: string | null;
  caption: string;
  onCaptionChange: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
  uploadStage: 'idle' | 'uploading' | 'sending';
  uploadProgress: number;
  uploadError: string;
  recipientName: string;
}) {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const isAudio = file.type.startsWith('audio/');
  const isBusy = uploadStage !== 'idle';

  const [mediaPreviewUrl] = useState(() =>
    (isVideo || isAudio) ? URL.createObjectURL(file) : null
  );
  useEffect(() => () => { if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl); }, [mediaPreviewUrl]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !isBusy) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, isBusy]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex flex-shrink-0 items-center justify-between px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="text-base">👁</span> File Preview
          </p>
          <p className="text-xs text-white/50 mt-0.5">Sending to {recipientName}</p>
        </div>
        {!isBusy && (
          <button onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 text-lg leading-none">
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden px-4">
        {isImage && previewUrl && (
          <img src={previewUrl} alt={file.name}
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" />
        )}
        {isVideo && mediaPreviewUrl && (
          <video src={mediaPreviewUrl} controls preload="metadata"
            className="max-h-full max-w-full rounded-xl shadow-2xl" />
        )}
        {isAudio && mediaPreviewUrl && (
          <div className="flex flex-col items-center gap-4">
            <span className="text-7xl">🎵</span>
            <p className="text-sm text-white/70 max-w-xs text-center truncate">{file.name}</p>
            <audio src={mediaPreviewUrl} controls className="w-72" />
          </div>
        )}
        {!isImage && !isVideo && !isAudio && (
          <div className="flex flex-col items-center gap-4">
            <span className="text-7xl">📄</span>
            <p className="text-base font-medium text-white max-w-xs text-center">{file.name}</p>
            <p className="text-sm text-white/50">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 bg-black/60 backdrop-blur-sm px-4 pb-6 pt-3 space-y-3">
        {uploadError && (
          <p className="text-xs text-red-400 text-center">{uploadError}</p>
        )}
        {isBusy ? (
          <div className="space-y-2">
            <p className="text-center text-xs text-white/70">
              {uploadStage === 'uploading' ? `Uploading… ${uploadProgress}%` : 'Sending to WhatsApp…'}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-indigo-400 transition-all duration-200"
                style={{ width: uploadStage === 'sending' ? '100%' : `${uploadProgress}%` }} />
            </div>
          </div>
        ) : (
          <>
            <input
              value={caption}
              onChange={(e) => onCaptionChange(e.target.value)}
              placeholder="Add a caption…"
              className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/40 outline-none focus:bg-white/15 focus:ring-1 focus:ring-white/30"
              onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-white/10 flex items-center justify-center overflow-hidden">
                  {isImage && previewUrl
                    ? <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                    : <span className="text-xl">{isVideo ? '🎬' : isAudio ? '🎵' : '📄'}</span>}
                </div>
                <p className="truncate text-xs text-white/60">{file.name}</p>
              </div>
              <button onClick={onSend}
                className="flex-shrink-0 flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 active:scale-95 transition-transform">
                Send <span className="text-base">➤</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ src, filename, mediaType = 'image', onClose }: {
  src: string; filename?: string; mediaType?: 'image' | 'video'; onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      onClick={onClose}>
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
        onClick={(e) => e.stopPropagation()}>
        <span className="text-sm text-white/70 truncate max-w-xs">{filename ?? (mediaType === 'video' ? 'Video' : 'Image')}</span>
        <div className="flex items-center gap-2">
          <button onClick={download}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
            ⬇ Download
          </button>
          <button onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-lg bg-white/10 text-white hover:bg-white/20 text-lg leading-none">
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
        <img src={src} alt={filename ?? 'media'}
          className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}

// ── MediaBubble ───────────────────────────────────────────────────────────────
function MediaBubble({ item, outbound }: { item: Message & { _kind: string }; outbound: boolean }) {
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
  if (error || nativeError || (!src && !item.mediaId)) {
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
          className="relative mb-1.5 w-full max-h-48 overflow-hidden rounded-xl cursor-pointer"
          onClick={() => setLightbox(true)}>
          <video preload="metadata" src={src!} onError={() => setNativeError(true)} className="w-full max-h-48 object-cover rounded-xl" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/35 transition-colors">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/85 shadow-lg">
              <span className="ml-1 text-xl text-slate-800">▶</span>
            </div>
          </div>
        </div>
        {lightbox && (
          <Lightbox src={src!} mediaType="video" filename={item.filename} onClose={() => setLightbox(false)} />
        )}
      </>
    );
  }
  if (item.type === 'audio') {
    return <audio controls src={src!} className="mb-1.5 w-full max-w-[220px]" />;
  }
  if (item.type === 'document') {
    return (
      <a href={src!} download={item.filename ?? true}
        className={`mb-1.5 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${outbound ? 'border-indigo-400/40 bg-indigo-500/30 text-indigo-100' : 'border-slate-200 bg-slate-50 text-indigo-600 dark:border-slate-700 dark:bg-slate-700 dark:text-indigo-400'}`}>
        📄 {item.filename ?? 'Document'}
      </a>
    );
  }
  return null;
}

// ── ChatPane ──────────────────────────────────────────────────────────────────
export function ChatPane() {
  const {
    selected, selectConv, timeline, currentLead, windowExpired, stageObj,
    employees, canned, stages, activeConvKey, editingName, nameInput, setEditingName,
    setNameInput, resolveMutation, reopenMutation, noteMutation, nameMutation,
    showSidebar, setShowSidebar, qc, invalidate, refetchCanned,
  } = useInbox();

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);
  const isNearBottomRef = useRef(true);

  const [msgText, setMsgText] = useState('');
  const [inputMode, setInputMode] = useState<'reply' | 'note'>('reply');
  const [showCanned, setShowCanned] = useState(false);
  const [cannedSearch, setCannedSearch] = useState('');
  const [showCannedModal, setShowCannedModal] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [addLeadForm, setAddLeadForm] = useState({ name: '', stage: '', assignedTo: '' });
  const [showMediaInput, setShowMediaInput] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadCaption, setUploadCaption] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<'idle' | 'uploading' | 'sending'>('idle');
  const [compressImage, setCompressImage] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [replyTo, setReplyTo] = useState<{
    waMessageId: string; content: string;
    direction: 'inbound' | 'outbound'; senderName?: string | null;
  } | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentionPicker, setShowMentionPicker] = useState(false);

  // Reset local state when conversation changes
  useEffect(() => {
    setMsgText('');
    setInputMode('reply');
    setReplyTo(null);
    setShowMentionPicker(false);
    setShowMediaInput(false);
    setUploadFile(null);
    setUploadPreview(null);
    setUploadStage('idle');
    setUploadProgress(0);
  }, [activeConvKey]);

  // Escape closes add-to-CRM modal
  useEffect(() => {
    if (!showAddLeadModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowAddLeadModal(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAddLeadModal]);

  // Track bottom-proximity on scroll (fires before any DOM change, so reading is accurate)
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Jump to bottom instantly when switching conversations
  useEffect(() => {
    isNearBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  }, [activeConvKey]);

  // Auto-scroll to bottom when new messages arrive, only if already near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [timeline.length]);

  function mediaKind(mimeType: string) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'document';
  }

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
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob || blob.size >= file.size) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
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

  function applyFile(file: File) {
    setUploadError('');
    const kind = mediaKind(file.type);
    const limit = META_SIZE_LIMITS[kind];
    if (file.size > limit) {
      setUploadError(`${kind} files must be under ${limit / 1024 / 1024} MB (Meta limit)`);
      return;
    }
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadFile(file);
    setUploadPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    setUploadStage('idle');
    setUploadProgress(0);
    setUploadCaption('');
    setShowMediaInput(true);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) applyFile(file);
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) throw new Error('No file selected');
      const hasLead = selected?.type === 'lead';
      const hasPhone = selected?.phone;
      if (!hasLead && !hasPhone) throw new Error('No conversation selected');

      setUploadStage('uploading');
      setUploadProgress(0);

      let file = uploadFile;
      if (compressImage && file.type.startsWith('image/') && file.size > 500 * 1024) {
        file = await compressImageFile(file);
      }

      const [hashHex, urlData] = await Promise.all([
        computeHash(file),
        apiFetch<{ uploadUrl: string; key: string }>(`/api/whatsapp/upload-url?mimeType=${encodeURIComponent(file.type)}&filename=${encodeURIComponent(file.name)}&fileSize=${file.size}`),
      ]);

      const { uploadUrl, key } = urlData;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadXhrRef.current = xhr;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status > 0 && xhr.status < 300) ? resolve() : reject(new Error(`S3 upload failed (${xhr.status}) — check CORS or file type`));
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
          ...(selected!.type === 'lead' ? { leadPK: selected!.PK } : { phone: selected!.phone }),
          s3Key: key,
          mimeType: file.type,
          filename: file.name,
          caption: uploadCaption || undefined,
          fileHash: hashHex,
        }),
      });
    },
    onSuccess: () => { setShowMediaInput(false); resetUpload(); invalidate(); },
    onError: (err: any) => {
      if (err?.message === 'Upload cancelled') return;
      setUploadError(err?.message ?? 'Upload failed');
      setUploadStage('idle');
      setUploadProgress(0);
    },
  });

  type SendVars = { text: string; reply: typeof replyTo };
  const sendMutation = useMutation<unknown, Error, SendVars, { snapshot: unknown }>({
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['wa-conv', activeConvKey] });
      const snapshot = qc.getQueryData(['wa-conv', activeConvKey]);
      const now = new Date().toISOString();
      qc.setQueryData(['wa-conv', activeConvKey], (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const data = old as Record<string, unknown>;
        const msgs = (data.messages ?? []) as Record<string, unknown>[];
        return {
          ...data,
          messages: [...msgs, {
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
          }],
        };
      });
      setMsgText('');
      setShowCanned(false);
      setReplyTo(null);
      return { snapshot };
    },
    mutationFn: ({ text, reply }) =>
      selected!.type === 'lead'
        ? apiFetch('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({
            leadPK: selected!.PK,
            message: text,
            ...(reply?.waMessageId && {
              replyToWaMessageId: reply.waMessageId,
              replyToContent: reply.content,
              replyToDirection: reply.direction,
              replyToSenderName: reply.senderName ?? null,
            }),
          }) })
        : apiFetch(`/api/whatsapp/inbox/unknown/${selected!.phone}/send`, { method: 'POST', body: JSON.stringify({ message: text }) }),
    onError: (_err, vars, ctx) => {
      if (ctx?.snapshot !== undefined) qc.setQueryData(['wa-conv', activeConvKey], ctx.snapshot);
      setMsgText(vars.text);
    },
    onSettled: () => { invalidate(); },
  });

  const addLeadMutation = useMutation({
    mutationFn: () => apiFetch('/api/crm/leads', {
      method: 'POST',
      body: JSON.stringify({
        name: addLeadForm.name.trim() || selected?.displayName || selected?.phone,
        phone: selected?.phone,
        stage: addLeadForm.stage || stages[0]?.key || 'new',
        assignedTo: addLeadForm.assignedTo || undefined,
        assignedToName: employees.find((e) => e.id === addLeadForm.assignedTo)?.name,
        source: 'whatsapp',
      }),
    }),
    onSuccess: () => {
      setShowAddLeadModal(false);
      setAddLeadForm({ name: '', stage: '', assignedTo: '' });
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
    },
  });

  // Clipboard paste effect
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!selected || inputMode !== 'reply') return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); applyFile(file); }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, inputMode]);

  function handleSend() {
    if (!msgText.trim()) return;
    if (inputMode === 'note') { noteMutation.mutate(msgText, { onSuccess: () => setMsgText('') }); }
    else { sendMutation.mutate({ text: msgText, reply: replyTo }); }
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
      const cursorPos = inputRef.current?.selectionStart ?? val.length;
      const match = val.slice(0, cursorPos).match(/@(\w*)$/);
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
    const cursorPos = inputRef.current?.selectionStart ?? msgText.length;
    const before = msgText.slice(0, cursorPos);
    const after = msgText.slice(cursorPos);
    const atIdx = before.lastIndexOf('@');
    const firstName = emp.name.split(' ')[0];
    const newText = before.slice(0, atIdx) + `@${firstName} ` + after;
    setMsgText(newText);
    setShowMentionPicker(false);
    setMentionQuery('');
    setTimeout(() => {
      const newPos = atIdx + firstName.length + 2;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newPos, newPos);
    }, 0);
  }

  const isProcessing = sendMutation.isPending || noteMutation.isPending;
  const canSend = msgText.trim().length > 0 && !isProcessing && (inputMode === 'note' || !windowExpired);

  return (
    <>
      {/* ══ MIDDLE PANEL — chat ═════════════════════════════════════════════ */}
      {selected ? (
        <div className="flex min-w-0 flex-1 flex-col">

          {/* Chat header */}
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <button onClick={() => selectConv(null)} className="mr-1 flex-shrink-0 text-slate-400 hover:text-slate-600 md:hidden">←</button>

            <div className="flex-shrink-0">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${selected.type === 'unknown' ? 'bg-slate-400' : 'bg-indigo-500'}`}>
                {avatarLetters(currentLead?.name ?? selected.displayName, selected.phone)}
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {editingName ? (
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && nameInput.trim()) {
                        nameMutation.mutate({ leadId: selected.leadId, phone: selected.type === 'unknown' ? selected.phone : undefined, name: nameInput.trim() });
                      } else if (e.key === 'Escape') {
                        setEditingName(false);
                      }
                    }}
                    onBlur={() => setEditingName(false)}
                    className="min-w-0 rounded border border-indigo-300 px-2 py-0.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 dark:border-indigo-700 dark:bg-slate-800 dark:text-white"
                  />
                ) : (
                  <button
                    className="group flex min-w-0 items-center gap-1.5 text-left"
                    onClick={() => { setNameInput(currentLead?.name ?? selected.displayName ?? selected.phone); setEditingName(true); }}
                    title="Click to edit name"
                  >
                    <span className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {currentLead?.name ?? selected.displayName ?? selected.phone}
                    </span>
                    <span className="flex-shrink-0 text-[10px] text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600">✏</span>
                  </button>
                )}
                {stageObj && !editingName && (
                  <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: stageObj.color }}>
                    {stageObj.label}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-400">{selected.phone}</p>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold capitalize ${CHAT_STATUS_CHIP[selected.chatStatus]}`}>
                  {selected.chatStatus}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-shrink-0 items-center gap-1.5">
              {selected.type === 'lead' && selected.chatStatus !== 'resolved' && (
                <button
                  onClick={() => resolveMutation.mutate(undefined, { onError: () => toast.error('Failed to resolve conversation') })}
                  disabled={resolveMutation.isPending}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-400">
                  ✓ Resolve
                </button>
              )}
              {selected.type === 'lead' && selected.chatStatus === 'resolved' && (
                <button
                  onClick={() => reopenMutation.mutate(undefined, { onError: () => toast.error('Failed to reopen conversation') })}
                  disabled={reopenMutation.isPending}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  ↺ Reopen
                </button>
              )}
              {selected.type === 'lead' && (
                <Link href={`/admin/contacts/${selected.leadId}?tab=crm&from=inbox`}
                  className="hidden rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 sm:block">
                  CRM ↗
                </Link>
              )}
              {selected.type === 'unknown' && (
                <button
                  onClick={() => { setShowAddLeadModal(true); setAddLeadForm({ name: '', stage: stages[0]?.key ?? '', assignedTo: '' }); }}
                  className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700">
                  + Add to CRM
                </button>
              )}
              <button onClick={() => setShowSidebar((v) => !v)}
                className={`hidden rounded-lg border px-2.5 py-1.5 text-xs lg:block ${showSidebar ? 'border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400' : 'border-slate-200 text-slate-400 hover:bg-slate-50 dark:border-slate-700'}`}>
                ☰ Info
              </button>
            </div>
          </div>

          {/* 24h window warning + template picker */}
          {windowExpired && inputMode === 'reply' && !showTemplatePicker && (
            <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-100 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/20">
              <span className="text-lg">⚠️</span>
              <p className="flex-1 text-xs text-amber-800 dark:text-amber-300">
                <strong>24-hour window expired.</strong> Customer last replied {timeAgo(selected.lastInboundAt ?? currentLead?.lastInboundAt ?? '')}.
              </p>
              <button onClick={() => setShowTemplatePicker(true)}
                className="flex-shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-700 active:bg-amber-800">
                Send Template →
              </button>
            </div>
          )}
          {windowExpired && inputMode === 'reply' && showTemplatePicker && selected.leadId && (
            <div className="border-b border-amber-100 p-3 dark:border-amber-900/30">
              <TemplatePicker
                leadId={selected.leadId}
                phone={selected.phone}
                onSent={() => { setShowTemplatePicker(false); qc.invalidateQueries({ queryKey: ['wa-conv', activeConvKey] }); }}
                onCancel={() => setShowTemplatePicker(false)}
              />
            </div>
          )}

          {/* Timeline */}
          <div ref={chatContainerRef} className="flex-1 space-y-2 overflow-y-auto p-4">
            {timeline.length === 0 && <p className="py-12 text-center text-sm text-slate-400">No messages yet.</p>}
            {timeline.map((item) => {
              if (item._kind === 'note') {
                const noteContent = item.content.split(/(@\w+)/g).map((part: string, i: number) =>
                  part.match(/^@\w+$/)
                    ? <span key={i} className="font-bold text-amber-600 dark:text-amber-300">{part}</span>
                    : part
                );
                return (
                  <div key={item.SK} className="flex justify-center">
                    <div className="max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900/30 dark:bg-amber-900/10">
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">🔒 Internal note · {item.authorName}</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-amber-700 dark:text-amber-300">{noteContent}</p>
                      <p className="mt-1 text-[10px] text-amber-500">{new Date(item.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</p>
                    </div>
                  </div>
                );
              }
              const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];
              const isMedia = MEDIA_TYPES.includes(item.type ?? '');
              const outbound = item.direction === 'outbound';
              return (
                <div key={item.SK} className={`group flex items-end gap-1 ${outbound ? 'flex-row-reverse' : ''}`}>
                  {item._kind === 'message' && item.waMessageId && !windowExpired && (
                    <button
                      onClick={() => {
                        setReplyTo({ waMessageId: item.waMessageId!, content: item.content, direction: item.direction, senderName: item.sentByName ?? null });
                        setInputMode('reply');
                        inputRef.current?.focus();
                      }}
                      className="mb-1 flex-shrink-0 rounded-full p-1 text-xs text-slate-300 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-700">
                      ↩
                    </button>
                  )}
                  <div className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    outbound
                      ? 'rounded-br-sm bg-indigo-600 text-white'
                      : 'rounded-bl-sm bg-white text-slate-900 shadow-none ring-1 ring-slate-100 dark:bg-slate-800 dark:text-white dark:ring-slate-700'
                  }`}>
                    {item.replyToContent && (
                      <div className={`mb-2 rounded-lg border-l-2 px-2.5 py-1.5 text-xs ${
                        outbound ? 'border-indigo-300 bg-indigo-500/30' : 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-700/60'
                      }`}>
                        <p className={`mb-0.5 font-semibold ${outbound ? 'text-indigo-200' : 'text-slate-500 dark:text-slate-400'}`}>
                          {item.replyToDirection === 'inbound' ? 'Customer' : (item.replyToSenderName ?? 'You')}
                        </p>
                        <p className={`truncate ${outbound ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-300'}`}>{item.replyToContent}</p>
                      </div>
                    )}
                    {isMedia && (item.mediaId || item.mediaUrl) && (
                      <MediaBubble item={item} outbound={outbound} />
                    )}
                    {(item.content && item.content !== `[${item.type}]`) && (
                      <p className="whitespace-pre-wrap break-words">{item.content}</p>
                    )}
                    {item.content === `[${item.type}]` && isMedia && !item.mediaId && !item.mediaUrl && (
                      <p className="italic text-xs opacity-60">{item.content}</p>
                    )}
                    <p className={`mt-1 flex items-center gap-0.5 text-[10px] ${outbound ? 'text-indigo-200' : 'text-slate-400'}`}>
                      {outbound && item.sentByName ? `${item.sentByName} · ` : ''}
                      {new Date(item.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                      {outbound && <MsgTick status={item.msgStatus} />}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {replyTo && (
              <div className="flex items-start gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="min-w-0 flex-1 border-l-2 border-indigo-400 pl-2">
                  <p className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                    Replying to {replyTo.direction === 'inbound' ? 'Customer' : (replyTo.senderName ?? 'You')}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{replyTo.content}</p>
                </div>
                <button onClick={() => setReplyTo(null)} className="mt-0.5 flex-shrink-0 text-slate-400 hover:text-red-500 text-sm leading-none">×</button>
              </div>
            )}
            <div className="flex border-b border-slate-100 dark:border-slate-800">
              {(['reply', 'note'] as const).map((m) => (
                <button key={m} onClick={() => { setInputMode(m); setMsgText(''); setShowCanned(false); }}
                  className={`px-4 py-2 text-xs font-semibold capitalize transition-colors ${
                    inputMode === m
                      ? m === 'note' ? 'border-b-2 border-amber-500 text-amber-600 dark:text-amber-400' : 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}>
                  {m === 'reply' ? '💬 Reply' : '🔒 Note'}
                </button>
              ))}
              {inputMode === 'reply' && canned.length > 0 && (
                <button onClick={() => setShowCannedModal(true)}
                  className="ml-auto px-4 py-2 text-xs text-slate-400 hover:text-indigo-600">
                  ⚡ Canned
                </button>
              )}
              {inputMode === 'reply' && canned.length === 0 && (
                <button onClick={() => setShowCannedModal(true)}
                  className="ml-auto px-4 py-2 text-xs text-slate-400 hover:text-indigo-600">
                  + Add Canned
                </button>
              )}
            </div>

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

              <input ref={fileRef} type="file"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xlsx,.xls,.csv,.txt"
                onChange={handleFileSelect} className="hidden" />

              <div
                className={`${isDragging ? 'mb-2 flex items-center justify-center rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50 py-4 text-sm text-indigo-500 dark:bg-indigo-900/20' : 'hidden'}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) applyFile(f); }}>
                Drop file here
              </div>

              <div className="flex gap-2"
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) applyFile(f); }}>
                {inputMode === 'reply' && !windowExpired && (
                  <button onClick={() => fileRef.current?.click()}
                    title="Send image, video or document"
                    className="flex-shrink-0 rounded-xl border border-slate-200 px-3 py-2.5 text-slate-400 hover:text-indigo-600 dark:border-slate-700 transition">
                    <Paperclip className="h-4 w-4" />
                  </button>
                )}
                <input
                  ref={inputRef}
                  value={msgText}
                  onChange={(e) => handleMsgChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && canSend) { e.preventDefault(); handleSend(); } if (e.key === 'Escape') { setShowCanned(false); setShowMentionPicker(false); } }}
                  disabled={windowExpired && inputMode === 'reply'}
                  placeholder={
                    windowExpired && inputMode === 'reply' ? '24h window expired — switch to Template or leave a Note'
                    : inputMode === 'note' ? '🔒 Internal note (not sent to customer)…'
                    : `Type / for canned responses, or write a message…`
                  }
                  className={`flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-1 dark:text-white ${
                    inputMode === 'note'
                      ? 'border-amber-200 bg-amber-50 focus:border-amber-400 focus:ring-amber-200 dark:border-amber-900/30 dark:bg-amber-900/10'
                      : windowExpired
                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800'
                        : 'border-slate-200 bg-slate-50 focus:border-indigo-400 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800'
                  }`}
                />
                <button onClick={handleSend} disabled={!canSend}
                  className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-40 ${
                    inputMode === 'note' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}>
                  {isProcessing ? '…' : inputMode === 'note' ? '🔒' : '➤'}
                </button>
              </div>
              {(sendMutation.isError || noteMutation.isError) && (
                <p className="mt-1 text-xs text-red-500">Failed — check WhatsApp connection in <a href="/admin/whatsapp/settings" className="underline">WhatsApp Settings</a>.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 md:flex">
          <span className="text-5xl">💬</span>
          <p className="text-slate-400">Select a conversation to start</p>
        </div>
      )}

      {/* Media preview modal */}
      {showMediaInput && uploadFile && (
        <MediaPreviewModal
          file={uploadFile}
          previewUrl={uploadPreview}
          caption={uploadCaption}
          onCaptionChange={setUploadCaption}
          onSend={() => uploadMutation.mutate()}
          onClose={() => { cancelUpload(); setShowMediaInput(false); }}
          uploadStage={uploadStage}
          uploadProgress={uploadProgress}
          uploadError={uploadError}
          recipientName={currentLead?.name ?? selected?.name ?? selected?.phone ?? 'contact'}
        />
      )}

      {showCannedModal && (
        <CannedModal
          onClose={() => setShowCannedModal(false)}
          onSaved={() => { refetchCanned(); setShowCannedModal(false); }}
        />
      )}

      {showAddLeadModal && selected?.type === 'unknown' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="mb-1 text-base font-bold text-slate-900 dark:text-white">Add to CRM</h3>
            <p className="mb-4 text-xs text-slate-400">Phone: {selected.phone}</p>
            <div className="space-y-3">
              <input
                value={addLeadForm.name}
                onChange={(e) => setAddLeadForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Full name (optional)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
              <select
                value={addLeadForm.stage}
                onChange={(e) => setAddLeadForm((f) => ({ ...f, stage: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <select
                value={addLeadForm.assignedTo}
                onChange={(e) => setAddLeadForm((f) => ({ ...f, assignedTo: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                <option value="">Unassigned</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            {addLeadMutation.isError && (
              <p className="mt-2 text-xs text-red-500">{(addLeadMutation.error as any)?.message ?? 'Failed to add lead'}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowAddLeadModal(false)}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-500 dark:border-slate-700">
                Cancel
              </button>
              <button onClick={() => addLeadMutation.mutate()} disabled={addLeadMutation.isPending}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                {addLeadMutation.isPending ? 'Adding…' : 'Add to CRM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
