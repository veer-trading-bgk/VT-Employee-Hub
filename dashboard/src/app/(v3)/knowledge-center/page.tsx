'use client';

import { useState } from 'react';
import { BookOpen, MessagesSquare, FileText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { KnowledgeList } from '@/components/knowledge/KnowledgeList';
import { DocumentList } from '@/components/knowledge/DocumentList';

type KnowledgeCenterTab = 'structured' | 'documents';

const TABS: { id: KnowledgeCenterTab; label: string; icon: React.ReactNode }[] = [
  { id: 'structured', label: 'Structured', icon: <MessagesSquare className="h-4 w-4" /> },
  { id: 'documents', label: 'Documents', icon: <FileText className="h-4 w-4" /> },
];

function KnowledgeCenterPageInner() {
  const [tab, setTab] = useState<KnowledgeCenterTab>('structured');

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30">
            <BookOpen className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Knowledge Center</h1>
            <p className="text-xs text-neutral-500">FAQ entries and reference documents backing the AI — Admin only.</p>
          </div>
        </div>
        <div className="flex gap-1 px-6 pb-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
                tab === t.id
                  ? 'border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          {tab === 'structured' && <KnowledgeList />}
          {tab === 'documents' && <DocumentList />}
        </div>
      </div>
    </div>
  );
}

// Admin-only, enforced at the route level, same pattern as /ai-admin.
export default function KnowledgeCenterPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <KnowledgeCenterPageInner />
    </ProtectedRoute>
  );
}
