'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Upload, FileText, Download, Archive, ArchiveRestore, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/v3/ui/Button';
import { Badge } from '@/components/v3/ui/Badge';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import {
  documentKeys, fetchDocuments, uploadDocument, publishDocument, archiveDocument, unarchiveDocument, getDownloadUrl,
  type KnowledgeDocument,
} from '@/lib/knowledge/documentsApi';

const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md';

function statusBadge(doc: KnowledgeDocument) {
  if (doc.status === 'archived') return <Badge variant="default">Archived</Badge>;
  if (doc.status === 'published') return <Badge variant="primary">Published</Badge>;
  return <Badge variant="warning">Draft</Badge>;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentList() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: documentKeys.list(), queryFn: fetchDocuments });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: uploadDocument,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.list() });
      toast.success('Uploaded — now a draft. Publish it to make it eligible for future AI use.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Upload failed';
      toast.error(message);
    },
    onSettled: () => setUploadingName(null),
  });

  const publishMutation = useMutation({
    mutationFn: publishDocument,
    onSuccess: () => { qc.invalidateQueries({ queryKey: documentKeys.list() }); toast.success('Published'); },
    onError: () => toast.error('Publish failed — try again.'),
  });

  const archiveMutation = useMutation({
    mutationFn: (doc: KnowledgeDocument) => (doc.status === 'archived' ? unarchiveDocument(doc.documentId) : archiveDocument(doc.documentId)),
    onSuccess: (_res, doc) => {
      qc.invalidateQueries({ queryKey: documentKeys.list() });
      toast.success(doc.status === 'archived' ? 'Unarchived' : 'Archived');
    },
    onError: () => toast.error('Action failed — try again.'),
  });

  const downloadMutation = useMutation({
    mutationFn: getDownloadUrl,
    onSuccess: (res) => { window.open(res.url, '_blank', 'noopener,noreferrer'); },
    onError: () => toast.error('Could not generate a download link — try again.'),
  });

  function handleFileChosen(file: File) {
    setUploadingName(file.name);
    uploadMutation.mutate({ file });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-900/40 dark:bg-warning-900/10">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-600 dark:text-warning-400" aria-hidden />
        <p className="text-sm font-medium text-warning-900 dark:text-warning-300">
          Upload only reference/product material — never customer data, leads, or personal information.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileChosen(file);
            e.target.value = '';
          }}
        />
        <Button
          iconLeft={<Upload className="h-4 w-4" />}
          disabled={uploadMutation.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadMutation.isPending ? `Uploading ${uploadingName}…` : 'Upload document'}
        </Button>
        <span className="text-xs text-neutral-500">PDF, Word, PowerPoint, Excel, CSV, TXT, Markdown — up to 20MB.</span>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : !data?.documents.length ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <FileText className="h-8 w-8 text-neutral-300" />
            <p className="text-sm text-neutral-500">No documents uploaded yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {data.documents.map((doc) => (
              <li key={doc.documentId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-neutral-400" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{doc.filename}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {formatSize(doc.fileSize)}
                      {doc.category && <span className="ml-2">· {doc.category}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {statusBadge(doc)}
                  <Button size="sm" variant="secondary" iconLeft={<Download className="h-3.5 w-3.5" />} onClick={() => downloadMutation.mutate(doc.documentId)}>
                    Download
                  </Button>
                  {doc.status !== 'published' && doc.status !== 'archived' && (
                    <Button size="sm" iconLeft={<CheckCircle2 className="h-3.5 w-3.5" />} disabled={publishMutation.isPending} onClick={() => publishMutation.mutate(doc.documentId)}>
                      Publish
                    </Button>
                  )}
                  <Button
                    size="sm" variant="secondary"
                    iconLeft={doc.status === 'archived' ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                    disabled={archiveMutation.isPending}
                    onClick={() => archiveMutation.mutate(doc)}
                  >
                    {doc.status === 'archived' ? 'Unarchive' : 'Archive'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
