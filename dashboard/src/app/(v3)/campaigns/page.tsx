'use client';

import { useState } from 'react';
import { Send, LayoutDashboard, List, Users, BarChart3, History, FileText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CampaignsDashboard } from '@/components/campaigns/CampaignsDashboard';
import { CampaignList } from '@/components/campaigns/CampaignList';
import { CampaignCreateDrawer } from '@/components/campaigns/CampaignCreateDrawer';
import { TemplateDashboard } from '@/components/templates/TemplateDashboard';
import { TemplateList } from '@/components/templates/TemplateList';

type Tab = 'dashboard' | 'campaigns' | 'audience' | 'analytics' | 'history' | 'templates';
type TemplateView = 'overview' | 'list';

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaigns', icon: List           },
  { id: 'audience',  label: 'Audience',  icon: Users          },
  { id: 'analytics', label: 'Analytics', icon: BarChart3      },
  { id: 'history',   label: 'History',   icon: History        },
  { id: 'templates', label: 'Templates', icon: FileText       },
];

export default function CampaignsPage() {
  const [activeTab,     setActiveTab]     = useState<Tab>('dashboard');
  const [createOpen,    setCreateOpen]    = useState(false);
  const [templateView,  setTemplateView]  = useState<TemplateView>('overview');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20">
            <Send className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-bold text-neutral-900 dark:text-white">Campaigns</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              WhatsApp Broadcasts and Click-to-WhatsApp campaigns at scale
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

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-5">
          {activeTab === 'dashboard' && (
            <CampaignsDashboard
              onViewAll={() => setActiveTab('campaigns')}
              onCreateCampaign={() => setCreateOpen(true)}
            />
          )}
          {activeTab === 'campaigns' && <CampaignList />}
          {activeTab === 'audience'  && <AudiencePlaceholder />}
          {activeTab === 'analytics' && <AnalyticsPlaceholder />}
          {activeTab === 'history'   && (
            <CampaignList statusFilter="completed" />
          )}
          {activeTab === 'templates' && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setTemplateView('overview')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    templateView === 'overview'
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                      : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
                  )}
                >
                  <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
                  Overview
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateView('list')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    templateView === 'list'
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                      : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
                  )}
                >
                  <List className="h-4 w-4 shrink-0" aria-hidden />
                  All Templates
                </button>
              </div>
              {templateView === 'overview' && (
                <TemplateDashboard onViewAll={() => setTemplateView('list')} />
              )}
              {templateView === 'list' && <TemplateList />}
            </div>
          )}
        </div>
      </div>

      {/* Global create drawer — triggered from dashboard empty state */}
      <CampaignCreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

// ── Placeholder tabs ─────────────────────────────────────────────────────────

function AudiencePlaceholder() {
  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/20">
        <Users className="h-8 w-8 text-primary-600 dark:text-primary-400" aria-hidden />
      </div>
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">Saved Segments — Coming Soon</h2>
        <p className="mt-1.5 max-w-sm text-sm text-neutral-500">
          Save reusable audience segments based on pipeline stage, tags, source, and custom properties.
          Reuse them across campaigns without rebuilding filters each time.
        </p>
      </div>
    </div>
  );
}

function AnalyticsPlaceholder() {
  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 dark:bg-primary-900/20">
        <BarChart3 className="h-8 w-8 text-primary-600 dark:text-primary-400" aria-hidden />
      </div>
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">Campaign Analytics — Coming Soon</h2>
        <p className="mt-1.5 max-w-sm text-sm text-neutral-500">
          Delivery trends, read rates, reply rates, and conversion funnels across all campaigns.
          Powered by WhatsApp Cloud API delivery receipts.
        </p>
      </div>
    </div>
  );
}
