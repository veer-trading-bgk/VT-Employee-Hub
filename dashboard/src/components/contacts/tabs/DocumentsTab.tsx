'use client';

import { memo, useMemo, useState } from 'react';
import { useCustomer360 } from '@/contexts/Customer360Context';
import { apiFetch, getMemoryToken } from '@/lib/api';
import type { ContactMessage } from '@/lib/contacts/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

const TYPE_ICON: Record<string, string> = {
  image: '🖼', video: '🎬', audio: '🎧', document: '📄', sticker: '🖼',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

// Same fallback chain ConversationTab's useMediaSrc uses, resolved lazily
// on click rather than eagerly per row — this tab can list far more items
// at once than a single chat pane ever renders inline.
async function resolveDownloadUrl(item: ContactMessage): Promise<string | null> {
  if (item.mediaUrl) return item.mediaUrl;
  if (item.s3Key) {
    const res = await apiFetch<{ url?: string }>(`/api/whatsapp/s3-url?key=${encodeURIComponent(item.s3Key)}`);
    return res.url ?? null;
  }
  if (item.mediaId) {
    const token = getMemoryToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/api/whatsapp/media/${item.mediaId}`, { credentials: 'include', headers });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }
  return null;
}

function DocumentRow({ item }: { item: ContactMessage }) {
  const [downloading, setDownloading] = useState(false);
  const type = item.type && MEDIA_TYPES.has(item.type) ? item.type : 'document';
  const label = item.filename ?? (item.type === 'sticker' ? 'Sticker' : `${type[0].toUpperCase()}${type.slice(1)}`);
  const from = item.direction === 'inbound' ? 'Customer' : (item.sentByName ?? item.authorName ?? 'Agent');

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const url = await resolveDownloadUrl(item);
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = item.filename ?? '';
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.click();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg dark:bg-slate-800"
        aria-hidden="true"
      >
        {TYPE_ICON[type] ?? '📄'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{label}</p>
        <p className="text-[11px] text-slate-400">
          {from} · {fmtDate(item.timestamp)}
        </p>
      </div>
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="flex-shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label={`Download ${label}`}
      >
        {downloading ? '…' : '⬇ Download'}
      </button>
    </li>
  );
}

function DocumentsPanel() {
  const { contact, messages } = useCustomer360();

  const documents = useMemo(
    () =>
      messages
        .filter((m) => MEDIA_TYPES.has(m.type ?? '') && (m.mediaId || m.mediaUrl || m.s3Key))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [messages],
  );

  if (!contact) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-10">
      <section aria-labelledby="documents-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="documents-heading" className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            WhatsApp Media
          </h2>
          {documents.length > 0 && (
            <span className="text-[11px] text-slate-400">{documents.length} file{documents.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-700">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No documents yet</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Images, videos, audio, and files shared over WhatsApp will appear here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2" role="list" aria-label="Shared WhatsApp media">
            {documents.map((item) => (
              <DocumentRow key={item.SK} item={item} />
            ))}
          </ul>
        )}
      </section>

      {/* Reserved — categories that need dedicated backend document storage,
          not just WhatsApp message media (docs/v3/08_CUSTOMER360_VISION.md's
          Documents tab spec: KYC Documents, Agent Uploads, System Documents).
          Not implemented here; no such endpoints exist yet. */}
      <div data-slot="documents-kyc"           className="hidden" aria-hidden="true" />
      <div data-slot="documents-agent-uploads" className="hidden" aria-hidden="true" />
      <div data-slot="documents-system"        className="hidden" aria-hidden="true" />
    </div>
  );
}

export const DocumentsTab = memo(DocumentsPanel);
