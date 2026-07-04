import { apiFetch } from '@/lib/api';

export interface UploadedFileRef {
  s3Key:    string;
  mimeType: string;
  filename: string;
  fileHash: string;
}

/**
 * Uploads a file to S3 via the existing presigned-URL flow (GET /api/whatsapp/
 * upload-url) and returns a reference to it — it deliberately stops there, one
 * step short of the Inbox's POST /api/whatsapp/upload-send (which sends
 * immediately). A canvas node config has no lead/target yet at config time, only
 * at real execution time, so sending now would be wrong; the reference gets
 * resolved to a Meta media_id later, by AutomationEngine's send_document/
 * send_buttons actions via WhatsAppSendService.resolveMediaId().
 *
 * This is the same request sequence ChatPane.tsx/ConversationTab.tsx already use
 * (hash + presign in parallel, then a plain XHR PUT for upload-progress access) —
 * that logic is inlined in both of those, not exported, so this is a fresh
 * implementation of the same pattern rather than an import.
 */
export async function uploadFileToS3(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadedFileRef> {
  const [fileHash, urlData] = await Promise.all([
    computeHash(file),
    apiFetch<{ uploadUrl: string; key: string }>(
      `/api/whatsapp/upload-url?mimeType=${encodeURIComponent(file.type)}&filename=${encodeURIComponent(file.name)}&fileSize=${file.size}`,
    ),
  ]);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => ((xhr.status > 0 && xhr.status < 300) ? resolve() : reject(new Error(`S3 upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.open('PUT', urlData.uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });

  return { s3Key: urlData.key, mimeType: file.type, filename: file.name, fileHash };
}

async function computeHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
