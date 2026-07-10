'use client';

import { useRef, useState } from 'react';
import { Upload, Link as LinkIcon, X, Loader2, FileIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { uploadFileToS3 } from '@/lib/mediaUpload';
import { inputCls } from './ActionEditor';

export interface MediaSourceValue {
  url?:      string;
  s3Key?:    string;
  mimeType?: string;
  filename?: string;
}

interface MediaSourceFieldProps {
  value:    MediaSourceValue;
  onChange: (v: MediaSourceValue) => void;
  accept?:  string; // file input accept attribute
  // Default true — the two existing callers (Send Buttons/Send Document node
  // configs) keep their "paste a URL" tab unchanged. Set false for
  // TemplateCreateDrawer's header media field: a template header's example
  // must go through Meta's Resumable Upload API to get a real handle (see
  // docs/phase3/TECHNICAL_DEBT.md's location-message investigation session)
  // — a pasted URL can never produce one, and letting the backend fetch an
  // arbitrary user-supplied URL to feed into that flow is also an avoidable
  // SSRF surface, so the mode is removed there rather than left reachable
  // and broken.
  allowUrlMode?: boolean;
}

/**
 * Shared "upload a file, or paste a URL" picker — used by both the Send Buttons
 * node's optional header and the Send Document node's file field. An uploaded
 * file only reaches S3 here (via mediaUpload.ts's uploadFileToS3, the same
 * presign-and-PUT flow ChatPane.tsx/ConversationTab.tsx already use for the
 * Inbox) — it's resolved to a real Meta media_id later, at workflow execution
 * time, by AutomationEngine (WhatsAppSendService.resolveMediaId()), since there's
 * no lead/target to send to yet at config time.
 */
export function MediaSourceField({ value, onChange, accept, allowUrlMode = true }: MediaSourceFieldProps) {
  const [mode, setMode] = useState<'upload' | 'url'>(value.url && allowUrlMode ? 'url' : 'upload');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const ref = await uploadFileToS3(file, setProgress);
      onChange({ s3Key: ref.s3Key, mimeType: ref.mimeType, filename: ref.filename, url: undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function clear() {
    onChange({});
    setError(null);
  }

  const hasValue = !!(value.s3Key || value.url);

  return (
    <div className="space-y-2">
      {allowUrlMode && (
        <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={cn(
              'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
              mode === 'upload' ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white' : 'text-neutral-500',
            )}
          >
            <Upload className="mr-1 inline h-3 w-3" aria-hidden />Upload
          </button>
          <button
            type="button"
            onClick={() => setMode('url')}
            className={cn(
              'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
              mode === 'url' ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white' : 'text-neutral-500',
            )}
          >
            <LinkIcon className="mr-1 inline h-3 w-3" aria-hidden />URL
          </button>
        </div>
      )}

      {mode === 'upload' || !allowUrlMode ? (
        <div>
          {value.s3Key ? (
            <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
              <FileIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-700 dark:text-neutral-300">{value.filename}</span>
              <button type="button" onClick={clear} className="shrink-0 rounded p-0.5 text-neutral-400 hover:text-error-500" aria-label="Remove file">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : uploading ? (
            <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary-500" aria-hidden />
              Uploading… {progress}%
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-3 text-xs font-medium text-neutral-500 hover:border-primary-400 hover:text-primary-600 dark:border-neutral-700 dark:hover:border-primary-600"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden /> Choose a file…
            </button>
          )}
          <input ref={fileInputRef} type="file" accept={accept} onChange={handleFileSelect} className="hidden" />
          {error && <p className="mt-1 text-[11px] text-error-500">{error}</p>}
        </div>
      ) : (
        <input
          value={value.url ?? ''}
          onChange={(e) => onChange({ url: e.target.value, s3Key: undefined, mimeType: undefined, filename: undefined })}
          placeholder="https://…"
          className={inputCls}
        />
      )}

      {hasValue && mode === 'url' && value.url && (
        <button type="button" onClick={clear} className="text-[11px] text-neutral-400 hover:text-error-500">Remove</button>
      )}
    </div>
  );
}
