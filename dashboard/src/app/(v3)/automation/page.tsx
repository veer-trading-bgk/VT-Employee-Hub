'use client';

import { useState } from 'react';
import { Zap, LayoutDashboard, List, Activity } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AutomationDashboard } from '@/components/automation/AutomationDashboard';
import { WorkflowList } from '@/components/automation/WorkflowList';
import { ExecutionList } from '@/components/automation/ExecutionList';
import { WorkflowCreateDrawer } from '@/components/automation/WorkflowCreateDrawer';

type Tab = 'dashboard' | 'workflows' | 'executions';

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { id: 'workflows',  label: 'Workflows',  icon: List            },
  { id: 'executions', label: 'Executions', icon: Activity        },
];

export default function AutomationPage() {
  const [activeTab,    setActiveTab]    = useState<Tab>('dashboard');
  const [createOpen,   setCreateOpen]   = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20">
            <Zap className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-bold text-neutral-900 dark:text-white">Automation</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Trigger-based workflows that run automatically on lead events
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeTab === id
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                  : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-5">
          {activeTab === 'dashboard' && (
            <AutomationDashboard
              onViewWorkflows={() => setActiveTab('workflows')}
              onViewExecutions={() => setActiveTab('executions')}
              onCreateWorkflow={() => setCreateOpen(true)}
            />
          )}
          {activeTab === 'workflows'  && <WorkflowList />}
          {activeTab === 'executions' && <ExecutionList />}
        </div>
      </div>

      {/* Global create drawer — triggered from dashboard empty state */}
      <WorkflowCreateDrawer key={createOpen ? 'open' : 'closed'} open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
