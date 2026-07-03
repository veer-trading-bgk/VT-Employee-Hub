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

const DocumentsTab = dynamic(
  () => import('./tabs/DocumentsTab').then((m) => ({ default: m.DocumentsTab })),
  { ssr: false, loading: () => <TabLoader label="documents" /> }
);

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
      {activeTab === 'documents'    && <DocumentsTab key={contactId} />}
    </div>
  );
}
