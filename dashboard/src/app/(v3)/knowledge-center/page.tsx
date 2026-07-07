'use client';

import { BookOpen } from 'lucide-react';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { KnowledgeList } from '@/components/knowledge/KnowledgeList';

function KnowledgeCenterPageInner() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30">
            <BookOpen className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Knowledge Center</h1>
            <p className="text-xs text-neutral-500">Company-specific FAQ entries, keyword-matched into the AI&apos;s replies — Admin only.</p>
          </div>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <KnowledgeList />
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
