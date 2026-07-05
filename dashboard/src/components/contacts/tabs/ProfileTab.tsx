'use client';

import { useState, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { TagBadge } from '@/components/tags/TagBadge';
import type { Tag } from '@/components/tags/TagBadge';
import type { ContactDetail } from '@/lib/contacts/types';
import { useContactMutations } from '@/hooks/useContactMutations';
import { useTagCatalog } from '@/hooks/useTagCatalog';
import { EditableName } from '@/components/shared/EditableName';

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

function MiniCard({
  label,
  value,
  sub,
  slot,
}: {
  label: string;
  value: string;
  sub: string;
  slot?: string;
}) {
  return (
    <div
      className="flex flex-col items-center rounded-xl border border-slate-100 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900"
      data-slot={slot}
    >
      <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</span>
      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">{sub}</span>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-indigo-300 bg-white px-2 py-1 text-sm font-medium ' +
  'text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 ' +
  'dark:border-indigo-600 dark:bg-slate-800 dark:text-slate-100';

const rowCls =
  'flex items-center justify-between gap-4 border-b border-slate-50 py-2 ' +
  'last:border-0 dark:border-slate-800/60';

interface ProfileTabProps {
  contact: ContactDetail;
  leadId: string;
}

export function ProfileTab({ contact, leadId }: ProfileTabProps) {
  const router   = useRouter();
  const pathname = usePathname();
  const { updateField } = useContactMutations(leadId);

  const [editingField, setEditingField] = useState<'email' | null>(null);
  const [editValue, setEditValue]       = useState('');

  const { tags: tagCatalog } = useTagCatalog();

  const resolvedTags = useMemo(
    () => (contact.tags ?? [])
      .map((id) => tagCatalog.find((t) => t.id === id))
      .filter((t): t is Tag => t !== undefined),
    [contact.tags, tagCatalog]
  );

  function startEdit(field: 'email') {
    setEditingField(field);
    setEditValue(contact.email ?? '');
  }

  function commitEdit() {
    if (!editingField) return;
    const trimmed = editValue.trim();
    const current = contact.email ?? '';
    if (trimmed !== current) {
      updateField.mutate({ [editingField]: trimmed });
    }
    setEditingField(null);
  }

  function cancelEdit() {
    setEditingField(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter')  { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') cancelEdit();
  }

  function copyPhone() {
    navigator.clipboard.writeText(contact.phone).catch(() => {});
  }

  function goToCrm() {
    router.push(`${pathname}?tab=crm`);
  }

  const lastActivity = useMemo(
    () => contact.lastInboundAt
      ? new Date(contact.lastInboundAt).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
        })
      : '—',
    [contact.lastInboundAt]
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-10">

      {/* ── Contact Analytics mini-cards ─────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <MiniCard
          label="Total Messages"
          value={contact.messageCount != null ? String(contact.messageCount) : '—'}
          sub="all time"
        />
        <MiniCard
          label="Last Activity"
          value={lastActivity}
          sub="last inbound"
        />
        <MiniCard
          label="Response Rate"
          value="—"
          sub="AI not enabled"
          slot="profile-response-rate"
        />
      </div>

      {/* ── Personal Information ─────────────────────────────────── */}
      <Section title="Personal Information">

        {/* Name — inline edit (shared EditableName, same component used in
            Contact 360's header, the Inbox conversation header, and the
            Contacts list) */}
        <div className={rowCls}>
          <span className="flex-shrink-0 text-sm text-slate-500 dark:text-slate-400">Full Name</span>
          <EditableName
            value={contact.name}
            onSave={(name) => updateField.mutate({ name })}
            className="text-right text-sm font-medium text-slate-800 hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400"
            inputClassName={inputCls}
            ariaLabel="Edit full name"
          />
        </div>

        {/* Phone — copy only */}
        <div className={rowCls}>
          <span className="flex-shrink-0 text-sm text-slate-500 dark:text-slate-400">Phone</span>
          <button
            onClick={copyPhone}
            className="text-right text-sm font-medium text-slate-800 hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400"
            title="Click to copy"
          >
            +91 {contact.phone}
          </button>
        </div>

        {/* Email — inline edit */}
        <div className={rowCls}>
          <span className="flex-shrink-0 text-sm text-slate-500 dark:text-slate-400">Email</span>
          {editingField === 'email' ? (
            <input
              autoFocus
              type="email"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              className={inputCls}
              aria-label="Edit email address"
            />
          ) : (
            <button
              onClick={() => startEdit('email')}
              className="text-right text-sm font-medium text-slate-800 hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400"
              title="Click to edit"
            >
              {contact.email ?? (
                <span className="font-normal text-slate-400">Add email</span>
              )}
            </button>
          )}
        </div>

        {/* Assigned To — read-only */}
        <div className={rowCls}>
          <span className="flex-shrink-0 text-sm text-slate-500 dark:text-slate-400">Assigned To</span>
          <span className="text-right text-sm font-medium text-slate-800 dark:text-slate-200">
            {contact.assignedToName ?? <span className="text-slate-400">—</span>}
          </span>
        </div>

      </Section>

      {/* ── Source Tracking ──────────────────────────────────────── */}
      <Section title="Source Tracking">
        <div className={rowCls}>
          <span className="flex-shrink-0 text-sm text-slate-500 dark:text-slate-400">Source</span>
          <span className="text-right text-sm font-medium text-slate-800 dark:text-slate-200">
            {SOURCE_LABELS[contact.source ?? ''] ?? contact.source ?? (
              <span className="text-slate-400">—</span>
            )}
          </span>
        </div>
        <div className={rowCls}>
          <span className="flex-shrink-0 text-sm text-slate-500 dark:text-slate-400">Created</span>
          <span className="text-right text-sm font-medium text-slate-800 dark:text-slate-200">
            {fmtDate(contact.createdAt)}
          </span>
        </div>
        <div className={rowCls}>
          <span className="flex-shrink-0 text-sm text-slate-500 dark:text-slate-400">Last Updated</span>
          <span className="text-right text-sm font-medium text-slate-800 dark:text-slate-200">
            {fmtDate(contact.updatedAt)}
          </span>
        </div>
      </Section>

      {/* ── Product Interest ─────────────────────────────────────── */}
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

      {/* ── Tags ─────────────────────────────────────────────────── */}
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

      {/* ── CRM Notes — read-only preview ───────────────────────── */}
      <Section title="CRM Notes">
        {contact.notes ? (
          <div>
            <p className="line-clamp-4 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
              {contact.notes}
            </p>
            <button
              onClick={goToCrm}
              className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              Edit in CRM →
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400 dark:text-slate-500">No notes yet</p>
            <button
              onClick={goToCrm}
              className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              Add in CRM →
            </button>
          </div>
        )}
      </Section>

      {/* ── Relationship Graph — reserved Phase 3 ───────────────── */}
      <Section title="Relationship Graph">
        <div
          className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center dark:border-slate-700 dark:bg-slate-800/50"
          data-slot="profile-relationship-graph"
        >
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
