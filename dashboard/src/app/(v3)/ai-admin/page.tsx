'use client';

import { useState } from 'react';
import { Bot, Settings2, ShieldCheck, FlaskConical, PenSquare } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { GeneralTab } from '@/components/v3/ai-admin/GeneralTab';
import { ConversationTab } from '@/components/v3/ai-admin/ConversationTab';
import { ComplianceTab } from '@/components/v3/ai-admin/ComplianceTab';
import { FutureAiSettingsTab } from '@/components/v3/ai-admin/FutureAiSettingsTab';
import { PromptManagementTab } from '@/components/v3/ai-admin/PromptManagementTab';

type AiAdminTab = 'general' | 'conversation' | 'compliance' | 'prompt' | 'future';

const TABS: { id: AiAdminTab; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings2 className="h-4 w-4" /> },
  { id: 'conversation', label: 'Conversation', icon: <Bot className="h-4 w-4" /> },
  { id: 'compliance', label: 'Compliance', icon: <ShieldCheck className="h-4 w-4" /> },
  { id: 'prompt', label: 'Prompt Management', icon: <PenSquare className="h-4 w-4" /> },
  { id: 'future', label: 'Future AI Settings', icon: <FlaskConical className="h-4 w-4" /> },
];

function AiAdminPageInner() {
  const [tab, setTab] = useState<AiAdminTab>('general');

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30">
            <Bot className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">AI Administration</h1>
            <p className="text-xs text-neutral-500">Single source of truth for every AI-powered capability — Admin only.</p>
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
          {tab === 'general' && <GeneralTab />}
          {tab === 'conversation' && <ConversationTab />}
          {tab === 'compliance' && <ComplianceTab />}
          {tab === 'prompt' && <PromptManagementTab />}
          {tab === 'future' && <FutureAiSettingsTab />}
        </div>
      </div>
    </div>
  );
}

// Admin-only, enforced at the route level, not just nav-hiding — the first
// page in this codebase to actually use ProtectedRoute's allowedRoles prop
// (built, never used elsewhere; superadmin auto-bypasses inside
// ProtectedRoute itself). See docs/bible/19_DECISION_LOG.md's Phase 2A entry.
export default function AiAdminPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <AiAdminPageInner />
    </ProtectedRoute>
  );
}
