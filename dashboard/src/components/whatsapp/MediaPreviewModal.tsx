'use client';

import { useState, useEffect } from 'react';

export interface MediaPreviewModalProps {
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
}

export function MediaPreviewModal({
  file, previewUrl, caption, onCaptionChange, onSend, onClose,
  uploadStage, uploadProgress, uploadError, recipientName,
}: MediaPreviewModalProps) {
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
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="text-base">👁</span> File Preview
          </p>
          <p className="mt-0.5 text-xs text-white/50">Sending to {recipientName}</p>
        </div>
        {!isBusy && (
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-lg leading-none text-white hover:bg-white/20"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden px-4">
        {isImage && previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={file.name}
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" />
        )}
        {isVideo && mediaPreviewUrl && (
          <video src={mediaPreviewUrl} controls preload="metadata"
            className="max-h-full max-w-full rounded-xl shadow-2xl" />
        )}
        {isAudio && mediaPreviewUrl && (
          <div className="flex flex-col items-center gap-4">
            <span className="text-7xl" aria-hidden="true">🎵</span>
            <p className="max-w-xs truncate text-center text-sm text-white/70">{file.name}</p>
            <audio src={mediaPreviewUrl} controls className="w-72" />
          </div>
        )}
        {!isImage && !isVideo && !isAudio && (
          <div className="flex flex-col items-center gap-4">
            <span className="text-7xl" aria-hidden="true">📄</span>
            <p className="max-w-xs text-center text-base font-medium text-white">{file.name}</p>
            <p className="text-sm text-white/50">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 space-y-3 bg-black/60 px-4 pb-6 pt-3 backdrop-blur-sm">
        {uploadError && (
          <p className="text-center text-xs text-red-400" role="alert">{uploadError}</p>
        )}
        {isBusy ? (
          <div className="space-y-2">
            <p className="text-center text-xs text-white/70" aria-live="polite">
              {uploadStage === 'uploading' ? `Uploading… ${uploadProgress}%` : 'Sending to WhatsApp…'}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20" role="progressbar"
              aria-valuenow={uploadStage === 'sending' ? 100 : uploadProgress} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="h-full rounded-full bg-indigo-400 transition-all duration-200"
                style={{ width: uploadStage === 'sending' ? '100%' : `${uploadProgress}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <input
              value={caption}
              onChange={(e) => onCaptionChange(e.target.value)}
              placeholder="Add a caption…"
              aria-label="Caption"
              onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
              className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/40 outline-none focus:bg-white/15 focus:ring-1 focus:ring-white/30"
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/10">
                  {isImage && previewUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                    : <span className="text-xl" aria-hidden="true">{isVideo ? '🎬' : isAudio ? '🎵' : '📄'}</span>}
                </div>
                <p className="truncate text-xs text-white/60">{file.name}</p>
              </div>
              <button
                onClick={onSend}
                className="flex flex-shrink-0 items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition-transform hover:bg-indigo-700 active:scale-95"
              >
                Send <span className="text-base" aria-hidden="true">➤</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
