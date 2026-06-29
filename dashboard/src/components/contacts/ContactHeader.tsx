'use client';

import { SkeletonLine } from '@/components/common/Skeleton';
import { ContactAvatar } from './ContactAvatar';
import { HealthScoreBadge } from './HealthScoreBadge';
import { CustomerJourneyBar } from './CustomerJourneyBar';
import { ContactIdentityBlock } from './ContactIdentityBlock';
import { ContactMetaRow } from './ContactMetaRow';
import type { ContactDetail } from '@/lib/contacts/types';

interface PipelineStage {
  key: string;
  label: string;
  color: string;
}

interface ContactHeaderProps {
  contact: ContactDetail | null;
  isLoading: boolean;
  stages: PipelineStage[];
}

function HeaderSkeleton() {
  return (
    <div
      aria-label="Loading contact"
      aria-busy="true"
      className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 md:px-6"
    >
      <div className="flex items-start gap-3 md:gap-4">
        <SkeletonLine className="h-12 w-12 flex-shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
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
  );
}

export function ContactHeader({ contact, isLoading, stages }: ContactHeaderProps) {
  if (isLoading || !contact) return <HeaderSkeleton />;

  return (
    <div className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 md:px-6">
      <div className="flex items-start gap-3 md:gap-4">
        <ContactAvatar
          name={contact.name}
          contactId={contact.leadId}
          size="md"
        />

        <div className="min-w-0 flex-1">
          <ContactIdentityBlock
            name={contact.name}
            phone={contact.phone}
            email={contact.email}
          />
          <div className="mt-2">
            <ContactMetaRow contact={contact} stages={stages} />
          </div>
        </div>

        {/* Health score — desktop, right-aligned */}
        <div
          className="hidden flex-shrink-0 flex-col items-end gap-1 md:flex"
          aria-label="Contact health score"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Health
          </span>
          <HealthScoreBadge score={contact.healthScore ?? null} aiEnabled={false} />
        </div>
      </div>

      {/* Health score — mobile, below identity */}
      <div className="mt-2 flex items-center gap-2 md:hidden">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Health
        </span>
        <HealthScoreBadge score={contact.healthScore ?? null} aiEnabled={false} />
      </div>

      {/* Customer Journey Bar */}
      <div className="mt-3 md:mt-4">
        <CustomerJourneyBar contact={contact} />
      </div>
    </div>
  );
}
