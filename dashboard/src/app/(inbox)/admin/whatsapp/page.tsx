'use client';

import { InboxProvider } from '@/contexts/InboxContext';
import { Navbar } from '@/components/layout/Navbar';
import { WhatsAppSubNav } from '@/components/layout/WhatsAppSubNav';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ConversationList } from '@/components/whatsapp/ConversationList';
import { ChatPane } from '@/components/whatsapp/ChatPane';
import { LeadSidebar } from '@/components/whatsapp/LeadSidebar';

export default function WhatsAppInboxPage() {
  return (
    <ErrorBoundary>
      <InboxProvider>
        <Navbar title="WhatsApp Inbox" />
        <WhatsAppSubNav />
        <div className="flex h-[calc(100vh-97px)] overflow-hidden bg-slate-50 dark:bg-slate-950">
          <ConversationList />
          <ChatPane />
          <LeadSidebar />
        </div>
      </InboxProvider>
    </ErrorBoundary>
  );
}
