'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Navbar } from '@/components/layout/Navbar';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ContactHeader } from '@/components/contacts/ContactHeader';
import { ContactTabNav } from '@/components/contacts/ContactTabNav';
import { ContactTabPanel } from '@/components/contacts/ContactTabPanel';
import { SkeletonLine } from '@/components/common/Skeleton';
import { VALID_TAB_IDS } from '@/lib/contacts/types';
import type { ContactDetailResponse, TabId } from '@/lib/contacts/types';

interface PipelineStage {
  key: string;
  label: string;
  color: string;
}

// ── Skeleton shown while the page inner component suspends ────────────────────
function PageSkeleton() {
  return (
    <>
      {/* Header skeleton */}
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
      {/* Tab nav skeleton */}
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

// ── Inner page — uses hooks that require Suspense boundary ────────────────────
function ContactDetailPageInner() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Resolve and validate the active tab from the URL
  const rawTab = searchParams.get('tab') ?? 'profile';
  const activeTab: TabId = VALID_TAB_IDS.includes(rawTab as TabId)
    ? (rawTab as TabId)
    : 'profile';

  // Primary fetch — hydrates header, Profile, CRM, Tasks, Notes tabs
  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => apiFetch<ContactDetailResponse>(`/api/crm/leads/${id}`),
    staleTime: 60_000,
    enabled: !!id,
  });

  // Pipeline stage config — for stage badge colours in the header
  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () =>
      apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 10 * 60_000,
  });

  const contact = data?.lead ?? null;
  const stages = pipelineData?.stages ?? [];

  function onTabChange(tab: TabId) {
    router.replace(`/admin/contacts/${id}?tab=${tab}`);
  }

  // Error state — rendered inside the flex column so it fills available height
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
        {contact ? (
          <ContactTabPanel
            activeTab={activeTab}
            contactId={id}
            contact={contact}
          />
        ) : isLoading ? null : null}
      </div>
    </>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────
export default function ContactDetailPage() {
  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col bg-slate-50 dark:bg-slate-950">
        <Navbar showBack />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Suspense fallback={<PageSkeleton />}>
            <ContactDetailPageInner />
          </Suspense>
        </div>
      </div>
    </ErrorBoundary>
  );
}
