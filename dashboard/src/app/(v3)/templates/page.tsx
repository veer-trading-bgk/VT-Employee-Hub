'use client';

import { useState } from 'react';
import { FileText, LayoutDashboard, List } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TemplateDashboard } from '@/components/templates/TemplateDashboard';
import { TemplateList } from '@/components/templates/TemplateList';

type Tab = 'overview' | 'templates';

export default function TemplatesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20">
            <FileText className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-bold text-neutral-900 dark:text-white">Templates</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Manage WhatsApp message templates · Submit to Meta · Track quality
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1">
          <TabButton
            icon={LayoutDashboard}
            label="Overview"
            active={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
          />
          <TabButton
            icon={List}
            label="All Templates"
            active={activeTab === 'templates'}
            onClick={() => setActiveTab('templates')}
          />
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-5">
          {activeTab === 'overview' && (
            <TemplateDashboard onViewAll={() => setActiveTab('templates')} />
          )}
          {activeTab === 'templates' && (
            <div className="flex flex-col gap-4">
              <TemplateList />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
          : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}
