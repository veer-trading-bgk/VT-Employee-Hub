'use client';

import { useState, use, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  MessageSquare,
  Activity,
  Briefcase,
  CheckSquare,
  FileText,
  FolderOpen,
  MoreHorizontal,
  User,
} from 'lucide-react';
import { Customer360Provider, useCustomer360 } from '@/contexts/Customer360Context';
import { ContactTabPanel } from '@/components/contacts/ContactTabPanel';
import { ContactTags } from '@/components/tags/ContactTags';
import { CustomerJourneyBar } from '@/components/contacts/CustomerJourneyBar';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { cn } from '@/lib/cn';
import type { TabId } from '@/lib/contacts/types';
import { CONTACT_TABS, VALID_TAB_IDS } from '@/lib/contacts/types';

// ── Tab icons (frozen 7-tab list lives in lib/contacts/types.ts) ───────────────
const TAB_ICONS: Record<TabId, React.ReactNode> = {
  profile:      <User className="h-4 w-4" />,
  conversation: <MessageSquare className="h-4 w-4" />,
  timeline:     <Activity className="h-4 w-4" />,
  crm:          <Briefcase className="h-4 w-4" />,
  tasks:        <CheckSquare className="h-4 w-4" />,
  notes:        <FileText className="h-4 w-4" />,
  documents:    <FolderOpen className="h-4 w-4" />,
};

// Pre-rebuild tab param values, mapped onto their closest frozen-list home so
// an old bookmarked/shared ?tab= link doesn't land on an invalid tab. 'kyc'
// (the old page's own non-frozen addition) has no dedicated home yet — Profile
// is the closest "identity" fit until a KYC section is designed.
const LEGACY_TAB_MAP: Record<string, TabId> = {
  overview: 'profile', conversations: 'conversation', followups: 'tasks', kyc: 'profile',
};

function resolveTab(param: string | null): TabId {
  if (!param) return 'profile';
  if ((VALID_TAB_IDS as string[]).includes(param)) return param as TabId;
  return LEGACY_TAB_MAP[param] ?? 'profile';
}

// ── Unknown contact fallback ──────────────────────────────────────────────────
// Unknown/INBOX# contacts have no CRM lead record — no stage, no owner, no
// tasks, no notes, nothing Customer360Provider's leadId-keyed queries could
// ever resolve. Rather than mount the provider with a fake/missing leadId
// and let 5 of 7 tabs render blank, this stays a dedicated reduced view.
function UnknownContactView({ contactId }: { contactId: string }) {
  const router = useRouter();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <Link
          href="/contacts"
          className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Contacts
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-sm text-neutral-500">{contactId}</span>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={User}
          title="Unknown contact"
          description="This contact has sent messages but hasn't been added to the CRM yet. No profile data is available."
          action={{ label: 'Go to Contacts', onClick: () => router.push('/contacts') }}
        />
      </div>
    </div>
  );
}

// ── Shell — everything that needs useCustomer360() ─────────────────────────────

function Contact360Shell({ contactId }: { contactId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { contact, stages, stageObj, isLoading, refresh } = useCustomer360();

  const [activeTab, setActiveTab] = useState<TabId>(resolveTab(searchParams.get('tab')));

  function changeTab(tab: TabId) {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`/contacts/${contactId}?${params.toString()}`, { scroll: false });
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-neutral-200 px-6 py-4">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex flex-1 gap-6 p-6">
          <div className="w-72 space-y-4">
            <Skeleton className="h-16 w-16 rounded-full mx-auto" />
            <Skeleton className="h-4 w-32 mx-auto" />
          </div>
          <div className="flex-1 space-y-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={User}
          title="Contact not found"
          description="This contact may have been deleted or you may not have access"
          action={{ label: 'Go to Contacts', onClick: () => router.push('/contacts') }}
        />
      </div>
    );
  }

  const stageLabel = stageObj?.label ?? contact.stage;
  const stageColor = stageObj?.color ?? '#64748b';

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb + back */}
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <Link
          href="/contacts"
          className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Contacts
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {contact.name}
        </span>
      </div>

      {/* Contact header */}
      <div className="border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-4">
          <Avatar name={contact.name} size={48} />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {contact.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-0.5">
              <span className="text-sm text-neutral-500">{contact.phone}</span>
              <Badge style={{ backgroundColor: stageColor + '20', color: stageColor }}>
                {stageLabel}
              </Badge>
              {contact.assignedToName && (
                <span className="text-xs text-neutral-400">
                  Owner: {contact.assignedToName}
                </span>
              )}
            </div>
            {/* Always visible regardless of active tab — CrmTab also has its own
                tag editor for the deal-context view, this is the quick-access one. */}
            <div className="mt-1.5">
              <ContactTags
                tagIds={contact.tags ?? []}
                leadId={contact.leadId}
                phone={contact.phone}
                onMutated={refresh}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href={`/communications?contactId=${contactId}`}>
              <Button variant="secondary" size="sm" iconLeft={<MessageSquare className="h-4 w-4" />}>
                Message
              </Button>
            </Link>
            <Button variant="ghost" size="sm" iconLeft={<MoreHorizontal className="h-4 w-4" />} aria-label="More actions" />
          </div>
        </div>

        {/* Customer Journey Bar — ported 2026-07-09 from the orphaned
            ContactHeader.tsx (docs/phase3/TECHNICAL_DEBT.md); real,
            documented functionality (docs/v3/08_CUSTOMER360_VISION.md's
            header mockup) that had no live home until now. */}
        <div className="mt-3">
          <CustomerJourneyBar contact={contact} stages={stages} />
        </div>
      </div>

      {/* Tab bar — frozen 7-tab list (lib/contacts/types.ts CONTACT_TABS) */}
      <div className="scrollbar-thin flex overflow-x-auto border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-950">
        {CONTACT_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => changeTab(tab.id)}
            aria-selected={activeTab === tab.id}
            role="tab"
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300',
            )}
          >
            <span aria-hidden>{TAB_ICONS[tab.id]}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — ConversationTab renders its own ActivityPanel internally */}
      <div className="scrollbar-thin flex-1 overflow-y-auto min-h-0" role="tabpanel">
        <ContactTabPanel activeTab={activeTab} contactId={contactId} contact={contact} />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function Contact360Content({ contactId }: { contactId: string }) {
  // Unknown contacts are 10-digit phone numbers — they have no CRM lead record
  const isUnknown = /^\d{10}$/.test(contactId);

  if (isUnknown) return <UnknownContactView contactId={contactId} />;

  return (
    <Customer360Provider leadId={contactId}>
      <Contact360Shell contactId={contactId} />
    </Customer360Provider>
  );
}

export default function Contact360Page({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = use(params);
  return (
    <Suspense>
      <Contact360Content contactId={contactId} />
    </Suspense>
  );
}
