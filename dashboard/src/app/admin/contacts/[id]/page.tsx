'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ContactHeader } from '@/components/contacts/ContactHeader';
import { ContactTabNav } from '@/components/contacts/ContactTabNav';
import { ContactTabPanel } from '@/components/contacts/ContactTabPanel';
import { SkeletonLine } from '@/components/common/Skeleton';
import { Customer360Provider, useCustomer360 } from '@/contexts/Customer360Context';
import { VALID_TAB_IDS } from '@/lib/contacts/types';
import type { TabId } from '@/lib/contacts/types';

// ── Skeleton shown while the inner component suspends ─────────────────────────
function PageSkeleton() {
  return (
    <>
      <div className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 md:px-6">
        <div className="flex items-start gap-3">
          <SkeletonLine className="h-12 w-12 flex-shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="h-5 w-44" />
            <SkeletonLine className="h-3.5 w-32" />
            <SkeletonLine className="h-3 w-56" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-shrink-0 items-center">
              <SkeletonLine className="h-5 w-5 rounded-full" />
              {i < 7 && <SkeletonLine className="h-0.5 w-3 sm:w-4" />}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-1 border-b border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonLine key={i} className="h-4 w-14 rounded-full" />
        ))}
      </div>
    </>
  );
}

// ── Error state ───────────────────────────────────────────────────────────────
function ContactNotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
      <p className="text-5xl" aria-hidden="true">😕</p>
      <div>
        <p className="text-base font-semibold text-slate-700 dark:text-slate-300">
          Contact not found
        </p>
        <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">
          This contact could not be loaded. It may have been deleted.
        </p>
      </div>
      <button
        onClick={onBack}
        className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Back to Contact Hub
      </button>
    </div>
  );
}

// ── Reads shared context; renders header + tabs ───────────────────────────────
function Customer360PageContent({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  const { leadId, contact, stages, isLoading, isError } = useCustomer360();
  const router = useRouter();

  if (isError) {
    return (
      <>
        <ContactHeader contact={null} isLoading={false} stages={[]} />
        <ContactNotFound onBack={() => router.push('/admin/contacts')} />
      </>
    );
  }

  return (
    <>
      <ContactHeader contact={contact} isLoading={isLoading} stages={stages} />
      <ContactTabNav activeTab={activeTab} onTabChange={onTabChange} />
      <div className="flex-1 overflow-auto">
        {contact && (
          <ContactTabPanel
            activeTab={activeTab}
            contactId={leadId}
            contact={contact}
          />
        )}
      </div>
    </>
  );
}

// ── Inner — inside Suspense boundary; resolves URL params + provides context ──
function ContactDetailPageInner() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawTab = searchParams.get('tab') ?? 'profile';
  const from   = searchParams.get('from') as 'hub' | 'inbox' | 'crm' | null;

  const activeTab: TabId = VALID_TAB_IDS.includes(rawTab as TabId)
    ? (rawTab as TabId)
    : 'profile';

  // Preserve all existing URL params (including `from`) when switching tabs
  function onTabChange(tab: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`/admin/contacts/${id}?${params.toString()}`);
  }

  const backLabel = from === 'inbox' ? 'Inbox' : from === 'crm' ? 'CRM' : 'Contact Hub';

  return (
    <>
      <Navbar showBack backLabel={backLabel} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Customer360Provider leadId={id}>
          <Customer360PageContent activeTab={activeTab} onTabChange={onTabChange} />
        </Customer360Provider>
      </div>
    </>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────
export default function ContactDetailPage() {
  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col bg-slate-50 dark:bg-slate-950">
        <Suspense fallback={
          <>
            <Navbar showBack />
            <div className="flex flex-1 flex-col overflow-hidden">
              <PageSkeleton />
            </div>
          </>
        }>
          <ContactDetailPageInner />
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}
