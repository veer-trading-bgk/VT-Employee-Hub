'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { TagBadge } from '@/components/tags/TagBadge';
import type { Tag } from '@/components/tags/TagBadge';
import type { ContactDetail } from '@/lib/contacts/types';

const SOURCE_LABELS: Record<string, string> = {
  whatsapp:    'WhatsApp Inbound',
  instagram:   'Instagram',
  form:        'Form Submission',
  api:         'API',
  import:      'Import',
  manual:      'Manual Entry',
  referral:    'Referral',
  webinar:     'Webinar',
  social:      'Social Media',
  walk_in:     'Walk-in',
  whatsapp_ai: 'WhatsApp AI',
};

const PRODUCT_LABELS: Record<string, string> = {
  kyc:       'KYC',
  demat:     'Demat',
  mf:        'Mutual Funds',
  insurance: 'Insurance',
  pms:       'PMS',
  algo:      'Algo Trading',
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-50 py-2 last:border-0 dark:border-slate-800/60">
      <span className="flex-shrink-0 text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right text-sm font-medium text-slate-800 dark:text-slate-200">
        {value ?? <span className="text-slate-400">—</span>}
      </span>
    </div>
  );
}

interface ProfileTabProps {
  contact: ContactDetail;
  leadId: string;
}

export function ProfileTab({ contact }: ProfileTabProps) {
  const { data: tagCatalogData } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () => apiFetch<{ success: boolean; tags: Tag[] }>('/api/tags'),
    staleTime: 2 * 60_000,
  });
  const tagCatalog = tagCatalogData?.tags ?? [];

  const resolvedTags = (contact.tags ?? [])
    .map((id) => tagCatalog.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-10">

      {/* Personal Information */}
      <Section title="Personal Information">
        <Field label="Full Name"   value={contact.name} />
        <Field label="Phone"       value={contact.phone ? `+91 ${contact.phone}` : null} />
        <Field label="Email"       value={contact.email} />
        <Field label="Assigned To" value={contact.assignedToName} />
      </Section>

      {/* Source Tracking */}
      <Section title="Source Tracking">
        <Field label="Contact Created" value={fmtDate(contact.createdAt)} />
        <Field
          label="Source"
          value={SOURCE_LABELS[contact.source ?? ''] ?? contact.source}
        />
        <Field label="Last Updated" value={fmtDate(contact.updatedAt)} />
        {contact.closureDeadline && (
          <Field label="Close Deadline" value={fmtDate(contact.closureDeadline)} />
        )}
      </Section>

      {/* Product Interest */}
      {contact.productInterest && contact.productInterest.length > 0 && (
        <Section title="Product Interest">
          <div className="flex flex-wrap gap-2">
            {contact.productInterest.map((p) => (
              <span
                key={p}
                className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
              >
                {PRODUCT_LABELS[p] ?? p}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Tags */}
      <Section title="Tags">
        {resolvedTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {resolvedTags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 dark:text-slate-500">No tags applied</p>
        )}
      </Section>

      {/* CRM Notes */}
      {contact.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
            {contact.notes}
          </p>
        </Section>
      )}

      {/* Relationship Graph — reserved */}
      <Section title="Relationship Graph">
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center dark:border-slate-700 dark:bg-slate-800/50">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Relationship Graph — Architecture reserved for Phase 3
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-left opacity-50">
            {['Company', 'Decision Maker', 'Influencer', 'Referral From', 'Family', 'Accountant'].map((t) => (
              <div key={t} className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden="true" />
                {t}: —
              </div>
            ))}
          </div>
        </div>
      </Section>

    </div>
  );
}
