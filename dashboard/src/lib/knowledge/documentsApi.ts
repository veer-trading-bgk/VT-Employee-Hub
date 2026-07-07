import { apiFetch } from '@/lib/api';

const BASE = '/api/knowledge-documents';

export const documentKeys = {
  all: ['knowledge-documents'] as const,
  list: () => [...documentKeys.all, 'list'] as const,
};

// Document Knowledge (Phase 2A, PR 4) — file upload for a future RAG
// pipeline. status is a schema-only forward-compat field in this PR; no
// ingestion job reads it yet. Documents are immutable blobs — no version
// history, changing content means uploading a new document.

export interface KnowledgeDocument {
  documentId: string;
  filename: string;
  category: string | null;
  s3Key: string;
  mimeType: string;
  detectedType: string;
  fileSize: number;
  status: 'draft' | 'published' | 'archived';
  uploadedAt: string;
  publishedAt: string | null;
}

export async function fetchDocuments(): Promise<{ documents: KnowledgeDocument[] }> {
  return apiFetch(`${BASE}/`);
}

async function getUploadUrl(file: File): Promise<{ uploadUrl: string; s3Key: string; documentId: string }> {
  const params = new URLSearchParams({ mimeType: file.type, filename: file.name, fileSize: String(file.size) });
  return apiFetch(`${BASE}/upload-url?${params.toString()}`);
}

async function putToS3(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!res.ok) throw new Error(`Upload to storage failed (${res.status})`);
}

// Full upload flow: presigned URL -> direct browser PUT to S3 -> finalize
// (server re-validates the ACTUAL uploaded bytes' size/signature before a
// draft record exists at all). Exposed as one function since the 3 steps
// are never useful individually from the UI's point of view.
export async function uploadDocument({ file, category }: { file: File; category?: string }): Promise<KnowledgeDocument> {
  const { uploadUrl, s3Key, documentId } = await getUploadUrl(file);
  await putToS3(uploadUrl, file);
  return apiFetch(`${BASE}/`, {
    method: 'POST',
    body: JSON.stringify({ documentId, s3Key, filename: file.name, mimeType: file.type, category }),
  });
}

export async function updateDocumentMeta({ documentId, filename, category }: { documentId: string; filename?: string; category?: string }): Promise<{ success: boolean }> {
  return apiFetch(`${BASE}/${documentId}`, { method: 'PUT', body: JSON.stringify({ filename, category }) });
}

export async function publishDocument(documentId: string): Promise<{ success: boolean }> {
  return apiFetch(`${BASE}/${documentId}/publish`, { method: 'PUT', body: JSON.stringify({}) });
}

export async function archiveDocument(documentId: string): Promise<{ success: boolean }> {
  return apiFetch(`${BASE}/${documentId}/archive`, { method: 'PUT', body: JSON.stringify({}) });
}

export async function unarchiveDocument(documentId: string): Promise<{ success: boolean; status: string }> {
  return apiFetch(`${BASE}/${documentId}/unarchive`, { method: 'PUT', body: JSON.stringify({}) });
}

export async function getDownloadUrl(documentId: string): Promise<{ success: boolean; url: string; filename: string }> {
  return apiFetch(`${BASE}/${documentId}/download-url`);
}
