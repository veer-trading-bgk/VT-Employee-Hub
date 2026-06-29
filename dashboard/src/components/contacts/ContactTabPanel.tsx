'use client';

import dynamic from 'next/dynamic';
import { ProfileTab } from './tabs/ProfileTab';
import { ConversationTab } from './tabs/ConversationTab';
import { CrmTab } from './tabs/CrmTab';
import type { TabId, ContactDetail } from '@/lib/contacts/types';

function TabLoader({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-400 dark:text-slate-500">Loading {label}…</p>
    </div>
  );
}

// Lazy-loaded: defers parsing until the tab is first opened
const TimelineTab = dynamic(
  () => import('./tabs/TimelineTab').then((m) => ({ default: m.TimelineTab })),
  { ssr: false, loading: () => <TabLoader label="timeline" /> }
);

const TasksTab = dynamic(
  () => import('./tabs/TasksTab').then((m) => ({ default: m.TasksTab })),
  { ssr: false, loading: () => <TabLoader label="tasks" /> }
);

const NotesTab = dynamic(
  () => import('./tabs/NotesTab').then((m) => ({ default: m.NotesTab })),
  { ssr: false, loading: () => <TabLoader label="notes" /> }
);

function ComingSoonPanel({ tab }: { tab: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-3xl dark:bg-slate-800">
        🚧
      </div>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
        {tab} tab
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Implemented in an upcoming commit
      </p>
    </div>
  );
}

interface ContactTabPanelProps {
  activeTab: TabId;
  contactId: string;
  contact: ContactDetail;
}

export function ContactTabPanel({ activeTab, contactId, contact }: ContactTabPanelProps) {
  return (
    <div
      id={`tabpanel-${activeTab}`}
      role="tabpanel"
      aria-labelledby={`tab-${activeTab}`}
      className="h-full"
    >
      {activeTab === 'profile'      && <ProfileTab contact={contact} leadId={contactId} />}
      {activeTab === 'conversation' && <ConversationTab key={contactId} />}
      {activeTab === 'timeline'     && <TimelineTab key={contactId} />}
      {activeTab === 'crm'          && <CrmTab key={contactId} />}
      {activeTab === 'tasks'        && <TasksTab key={contactId} />}
      {activeTab === 'notes'        && <NotesTab key={contactId} />}
      {activeTab === 'documents'    && <ComingSoonPanel tab="Documents" />}
    </div>
  );
}
