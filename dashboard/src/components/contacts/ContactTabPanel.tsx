'use client';

import { ProfileTab } from './tabs/ProfileTab';
import { ConversationTab } from './tabs/ConversationTab';
import type { TabId, ContactDetail } from '@/lib/contacts/types';

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
      {activeTab === 'timeline'     && <ComingSoonPanel tab="Timeline" />}
      {activeTab === 'crm'          && <ComingSoonPanel tab="CRM" />}
      {activeTab === 'tasks'        && <ComingSoonPanel tab="Tasks" />}
      {activeTab === 'notes'        && <ComingSoonPanel tab="Notes" />}
      {activeTab === 'documents'    && <ComingSoonPanel tab="Documents" />}
      {activeTab === 'campaigns'    && <ComingSoonPanel tab="Campaigns" />}
      {activeTab === 'automation'   && <ComingSoonPanel tab="Automation" />}
      {activeTab === 'ai'           && <ComingSoonPanel tab="AI" />}
    </div>
  );
}
