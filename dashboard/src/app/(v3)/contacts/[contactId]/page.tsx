'use client';

import { useState, use, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  MessageSquare,
  Clock,
  FileText,
  Activity,
  Shield,
  FolderOpen,
  MoreHorizontal,
  Edit2,
  Check,
  X,
  Plus,
  User,
} from 'lucide-react';
import { OwnerSelect } from '@/components/v3/ui/OwnerSelect';
import { ContactTags } from '@/components/tags/ContactTags';
import { useAuth } from '@/context/AuthContext';
import { toV3Role } from '@/types/v3';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Select } from '@/components/v3/ui/Select';
import { Skeleton, SkeletonText } from '@/components/v3/ui/Skeleton';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { Card } from '@/components/v3/ui/Card';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import type { Contact, Stage } from '@/types/v3';
import { usePipelineStages, type PipelineStage } from '@/hooks/usePipelineStages';
import { toast } from 'sonner';
import { format } from 'date-fns';

// ── Tab definitions (FROZEN — do not add tabs without architecture review) ────

type C360Tab = 'overview' | 'conversations' | 'notes' | 'followups' | 'timeline' | 'kyc' | 'documents';

const TABS: { id: C360Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',       label: 'Overview',       icon: <User className="h-4 w-4" /> },
  { id: 'conversations',  label: 'Conversations',  icon: <MessageSquare className="h-4 w-4" /> },
  { id: 'notes',          label: 'Notes',          icon: <FileText className="h-4 w-4" /> },
  { id: 'followups',      label: 'Follow-ups',     icon: <Clock className="h-4 w-4" /> },
  { id: 'timeline',       label: 'Timeline',       icon: <Activity className="h-4 w-4" /> },
  { id: 'kyc',            label: 'KYC',            icon: <Shield className="h-4 w-4" /> },
  { id: 'documents',      label: 'Documents',      icon: <FolderOpen className="h-4 w-4" /> },
];

// Resolve a stage key against the company's real pipeline (GET /api/crm/pipeline),
// falling back to a neutral badge for a key the current pipeline no longer has —
// same defensive shape as the tag catalog's "unresolved id" fallback.
function resolveStage(stages: PipelineStage[], key: string): PipelineStage {
  return stages.find((s) => s.key === key) ?? { key, label: key, color: '#64748b', order: 999 };
}

// ── Backend data shapes ───────────────────────────────────────────────────────

interface CrmLead {
  leadId: string;
  name: string;
  phone: string;
  email?: string | null;
  stage: Stage;
  assignedTo?: string | null;
  assignedToName?: string | null;
  notes?: string;
  productInterest?: string;
  source?: string;
  tags?: string[];
  closureDeadline?: string;
  createdAt?: string;
  chatStatus?: string;
}

interface CrmNote {
  SK: string;
  body?: string;
  authorName?: string;
  createdAt?: string;
}

interface CrmFollowup {
  PK?: string;
  date: string;
  note?: string;
  leadId: string;
  assignedTo?: string;
  done?: boolean;
}

function normalizeLead(lead: CrmLead): Contact {
  return {
    id: lead.leadId,
    leadId: lead.leadId,
    type: 'lead',
    name: lead.name ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? null,
    stage: lead.stage,
    assignedTo: lead.assignedTo ?? null,
    assignedToName: lead.assignedToName ?? null,
    ownerName: lead.assignedToName ?? undefined,
    ownerId: lead.assignedTo ?? undefined,
    tags: lead.tags ?? [],
    createdAt: lead.createdAt,
  };
}

// ── Inline editable field ─────────────────────────────────────────────────────

function InlineField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          }}
          className="h-7 w-full rounded border border-primary-500 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-600 dark:bg-neutral-900 dark:text-neutral-100"
        />
        <button
          onClick={save}
          disabled={saving}
          className="flex h-7 w-7 items-center justify-center rounded bg-primary-600 text-white hover:bg-primary-700"
          aria-label="Save"
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          onClick={() => { setDraft(value); setEditing(false); }}
          className="flex h-7 w-7 items-center justify-center rounded border border-neutral-200 text-neutral-500 hover:bg-neutral-100"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className="group flex items-center gap-1 rounded px-1 py-0.5 text-sm text-neutral-900 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800 w-full text-left"
      aria-label={`Edit ${label}`}
    >
      <span className="flex-1">{value || '—'}</span>
      <Edit2 className="h-3 w-3 text-neutral-400 opacity-0 group-hover:opacity-100 shrink-0" aria-hidden />
    </button>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  contact,
  onUpdate,
  onStageChange,
  canEditOwner,
  stages,
  stagePending,
}: {
  contact: Contact;
  onUpdate: (patch: Partial<Contact>) => Promise<void>;
  onStageChange: (stage: Stage) => Promise<void>;
  canEditOwner: boolean;
  stages: PipelineStage[];
  stagePending: boolean;
}) {
  const qc = useQueryClient();
  const stageOptions = stages.map((s) => ({ value: s.key, label: s.label }));
  return (
    <div className="space-y-4 p-4">
      <Card>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Contact Details
        </h3>
        <div className="space-y-3">
          <div>
            <p className="mb-0.5 text-xs text-neutral-500">Full name</p>
            <InlineField
              label="name"
              value={contact.name}
              onSave={(v) => onUpdate({ name: v })}
            />
          </div>
          <div>
            <p className="mb-0.5 text-xs text-neutral-500">Phone</p>
            <InlineField
              label="phone"
              value={contact.phone}
              onSave={(v) => onUpdate({ phone: v })}
            />
          </div>
          {contact.email !== undefined && (
            <div>
              <p className="mb-0.5 text-xs text-neutral-500">Email</p>
              <InlineField
                label="email"
                value={contact.email ?? ''}
                onSave={(v) => onUpdate({ email: v })}
              />
            </div>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Pipeline
        </h3>
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <p className="text-xs text-neutral-500">Stage</p>
              {stagePending && <span className="text-[10px] text-neutral-400">Saving…</span>}
            </div>
            <Select
              options={stageOptions}
              value={contact.stage}
              onChange={(e) => onStageChange(e.target.value as Stage)}
              disabled={stagePending}
              aria-label="Contact stage"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-neutral-500">Assigned to</p>
            <OwnerSelect
              contactId={contact.id}
              isLead={contact.type === 'lead' || !!contact.leadId}
              currentOwnerName={contact.assignedToName ?? contact.ownerName}
              currentOwnerId={contact.assignedTo ?? contact.ownerId}
              canEdit={canEditOwner}
            />
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Tags
        </h3>
        <ContactTags
          tagIds={contact.tags ?? []}
          leadId={contact.leadId ?? contact.id}
          phone={contact.phone}
          onMutated={() => {
            qc.invalidateQueries({ queryKey: ['contact', contact.id] });
            qc.invalidateQueries({ queryKey: ['contacts'] });
          }}
        />
      </Card>
    </div>
  );
}

// ── Follow-ups Tab ────────────────────────────────────────────────────────────

function FollowupsTab({ contactId }: { contactId: string }) {
  const qc = useQueryClient();

  const { data: followups = [], isLoading } = useQuery<CrmFollowup[]>({
    queryKey: ['contact-followups', contactId],
    queryFn: async () => {
      const data = await apiFetch<{ followups: CrmFollowup[] }>(
        `/api/crm/followups?leadId=${contactId}&overdue=true&days=90`,
      );
      return data.followups ?? [];
    },
    staleTime: 30_000,
  });

  const completeMutation = useMutation({
    mutationFn: async (followup: CrmFollowup) => {
      return apiFetch(`/api/crm/followups/${followup.date}/${contactId}/done`, { method: 'PUT' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-followups', contactId] });
      toast.success('Follow-up marked complete');
    },
    onError: () => toast.error('Failed to complete follow-up'),
  });

  const addMutation = useMutation({
    mutationFn: async ({ date, note }: { date: string; note: string }) => {
      return apiFetch(`/api/crm/leads/${contactId}/followup`, {
        method: 'POST',
        body: JSON.stringify({ date, note }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-followups', contactId] });
      toast.success('Follow-up added');
    },
    onError: () => toast.error('Failed to add follow-up'),
  });

  const upcoming = followups.filter((f) => !f.done);
  const completed = followups.filter((f) => f.done);

  if (isLoading) return <div className="space-y-2 p-4"><SkeletonText lines={4} /></div>;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Upcoming follow-ups
        </h3>
        <Button
          size="sm"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => {
            const date = new Date();
            date.setDate(date.getDate() + 1);
            const dateStr = date.toISOString().slice(0, 10);
            addMutation.mutate({ date: dateStr, note: 'Follow-up scheduled' });
          }}
          loading={addMutation.isPending}
        >
          Add follow-up
        </Button>
      </div>

      {upcoming.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No upcoming follow-ups"
          description="Schedule a call, meeting, or callback"
          action={{
            label: 'Add follow-up',
            onClick: () => {
              const date = new Date();
              date.setDate(date.getDate() + 1);
              addMutation.mutate({ date: date.toISOString().slice(0, 10), note: 'Follow-up' });
            },
          }}
        />
      ) : (
        <ul className="space-y-2" role="list">
          {upcoming.map((f) => (
            <li
              key={`${f.date}-${f.leadId}`}
              className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning-50 dark:bg-warning-900/20">
                <Clock className="h-4 w-4 text-warning-600" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    Follow-up
                  </p>
                  <p className="text-xs text-neutral-500">
                    {format(new Date(f.date), 'EEE, d MMM yyyy')}
                  </p>
                </div>
                {f.note && <p className="mt-0.5 text-xs text-neutral-500">{f.note}</p>}
              </div>
              <button
                onClick={() => completeMutation.mutate(f)}
                disabled={completeMutation.isPending}
                className="shrink-0 rounded p-1 text-neutral-400 hover:bg-success-50 hover:text-success-600"
                aria-label="Mark complete"
              >
                <Check className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {completed.length > 0 && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Completed ({completed.length})
          </h3>
          <ul className="space-y-1" role="list">
            {completed.map((f) => (
              <li
                key={`${f.date}-done`}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-400"
              >
                <Check className="h-4 w-4 text-success-500 shrink-0" aria-hidden />
                <span className="line-through">Follow-up</span>
                <span className="ml-auto text-xs">
                  {format(new Date(f.date), 'd MMM')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Notes Tab ─────────────────────────────────────────────────────────────────

function NotesTab({ notes }: { notes: CrmNote[] }) {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <textarea
          placeholder="Note creation coming soon…"
          rows={3}
          disabled
          className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-50"
        />
        <Button
          size="sm"
          disabled
          className="self-end"
          onClick={() => toast.info('Note creation coming soon')}
        >
          Save note
        </Button>
      </div>

      <ul className="space-y-3" role="list">
        {notes.map((note) => (
          <li
            key={note.SK}
            className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <p className="text-sm text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap">
              {note.body ?? '—'}
            </p>
            <p className="mt-1.5 text-[10px] text-neutral-400">
              {note.authorName ?? 'Unknown'} · {note.createdAt ? format(new Date(note.createdAt), 'd MMM yyyy, h:mm a') : '—'}
            </p>
          </li>
        ))}
        {notes.length === 0 && (
          <EmptyState
            icon={FileText}
            title="No notes yet"
            description="Internal notes will appear here"
            className="py-8"
          />
        )}
      </ul>
    </div>
  );
}

// ── Conversations Tab ─────────────────────────────────────────────────────────

function ConversationsTab({ contactId, messageCount }: { contactId: string; messageCount: number }) {
  return (
    <div className="p-4 space-y-4">
      {messageCount === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No conversations"
          description="Start a WhatsApp conversation from the Inbox"
          action={{
            label: 'Open Inbox',
            onClick: () => window.location.href = `/communications?contactId=${contactId}`,
          }}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {messageCount} message{messageCount !== 1 ? 's' : ''} in conversation
          </p>
          <Link
            href={`/communications?contactId=${contactId}`}
            className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 hover:border-primary-300 hover:shadow-sm transition-all dark:border-neutral-800 dark:bg-neutral-900"
          >
            <MessageSquare className="h-5 w-5 text-primary-600 shrink-0" aria-hidden />
            <div className="flex-1">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                WhatsApp conversation
              </p>
              <p className="text-xs text-neutral-500">{messageCount} messages — click to open in Inbox</p>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Timeline Tab ──────────────────────────────────────────────────────────────

function TimelineTab() {
  return (
    <EmptyState
      icon={Activity}
      title="No activity yet"
      description="Activity will appear here as you interact with this contact"
      className="py-12"
    />
  );
}

// ── Stub tabs ─────────────────────────────────────────────────────────────────

function KYCTab() {
  return (
    <EmptyState
      icon={Shield}
      title="KYC details"
      description="PAN, Aadhaar, bank account, and verification status will appear here"
      className="py-12"
    />
  );
}

function DocumentsTab() {
  return (
    <EmptyState
      icon={FolderOpen}
      title="No documents"
      description="Shared WhatsApp media and uploaded files will appear here"
      className="py-12"
    />
  );
}

// ── Unknown contact fallback ──────────────────────────────────────────────────

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

// ── Main page ─────────────────────────────────────────────────────────────────

function Contact360Content({ contactId }: { contactId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();

  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  const canEditOwner = ['owner', 'admin'].includes(v3Role);

  const { stages: pipelineStages } = usePipelineStages();

  const tabParam = searchParams.get('tab') as C360Tab | null;
  const [activeTab, setActiveTab] = useState<C360Tab>(tabParam ?? 'overview');

  // Unknown contacts are 10-digit phone numbers — they have no CRM lead record
  const isUnknown = /^\d{10}$/.test(contactId);

  // Fetch the full CRM lead response — store Contact in the canonical ['contact', contactId]
  // cache (used by useOwnerAssign) and keep extra data in a separate key.
  const { data: contact, isLoading } = useQuery<Contact>({
    queryKey: ['contact', contactId],
    queryFn: async () => {
      const res = await apiFetch<{
        success: boolean;
        lead: CrmLead;
        messages: unknown[];
        internalNotes: CrmNote[];
      }>(`/api/crm/leads/${contactId}`);
      // Store side-band data under a separate key so it doesn't conflict with the
      // Contact shape that useOwnerAssign expects in ['contact', contactId].
      qc.setQueryData(['contact-meta', contactId], {
        internalNotes: res.internalNotes ?? [],
        messageCount: (res.messages ?? []).length,
      });
      return normalizeLead(res.lead);
    },
    staleTime: 60_000,
    enabled: !isUnknown,
  });

  const { data: contactMeta } = useQuery<{ internalNotes: CrmNote[]; messageCount: number }>({
    queryKey: ['contact-meta', contactId],
    queryFn: () => ({ internalNotes: [], messageCount: 0 }),
    enabled: false,  // populated as a side effect of the contact query above
    staleTime: Infinity,
  });

  const internalNotes = contactMeta?.internalNotes ?? [];
  const messageCount = contactMeta?.messageCount ?? 0;

  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<Contact>) => {
      const { name, phone, email, tags } = patch;
      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (phone !== undefined) body.phone = phone;
      if (email !== undefined) body.email = email;
      if (tags !== undefined) body.tags = tags;
      return apiFetch(`/api/crm/leads/${contactId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['contact', contactId] });
      const prev = qc.getQueryData<Contact>(['contact', contactId]);
      qc.setQueryData<Contact>(['contact', contactId], (old) =>
        old ? { ...old, ...patch } : old,
      );
      return { prev };
    },
    onSuccess: () => {
      toast.success('Contact updated');
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['contact', contactId], ctx.prev);
      toast.error('Update failed');
    },
  });

  const stageMutation = useMutation({
    mutationFn: async (stage: Stage) => {
      return apiFetch(`/api/crm/leads/${contactId}/stage`, {
        method: 'PUT',
        body: JSON.stringify({ stage }),
      });
    },
    onMutate: async (stage) => {
      await qc.cancelQueries({ queryKey: ['contact', contactId] });
      qc.setQueryData<Contact>(['contact', contactId], (old) =>
        old ? { ...old, stage } : old,
      );
    },
    onSuccess: () => {
      toast.success('Stage updated');
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      toast.error('Stage update failed');
    },
  });

  async function handleUpdate(patch: Partial<Contact>) {
    await updateMutation.mutateAsync(patch);
  }

  async function handleStageChange(stage: Stage) {
    await stageMutation.mutateAsync(stage);
  }

  function changeTab(tab: C360Tab) {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`/contacts/${contactId}?${params.toString()}`, { scroll: false });
  }

  if (isUnknown) return <UnknownContactView contactId={contactId} />;

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

  const currentStage = resolveStage(pipelineStages, contact.stage);

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
      <div className="flex items-center gap-4 border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <Avatar name={contact.name} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {contact.name}
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-0.5">
            <span className="text-sm text-neutral-500">{contact.phone}</span>
            <Badge style={{ backgroundColor: currentStage.color + '20', color: currentStage.color }}>
              {currentStage.label}
            </Badge>
            {contact.ownerName && (
              <span className="text-xs text-neutral-400">
                Owner: {contact.ownerName}
              </span>
            )}
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

      {/* Tab bar */}
      <div className="scrollbar-thin flex overflow-x-auto border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-950">
        {TABS.map((tab) => (
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
            <span aria-hidden>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content + Activity panel */}
      <div className="flex flex-1 min-h-0">
        {/* Main tab area */}
        <div className="scrollbar-thin flex-1 overflow-y-auto" role="tabpanel">
          {activeTab === 'overview'      && <OverviewTab contact={contact} onUpdate={handleUpdate} onStageChange={handleStageChange} canEditOwner={canEditOwner} stages={pipelineStages} stagePending={stageMutation.isPending} />}
          {activeTab === 'conversations' && <ConversationsTab contactId={contactId} messageCount={messageCount} />}
          {activeTab === 'notes'         && <NotesTab notes={internalNotes} />}
          {activeTab === 'followups'     && <FollowupsTab contactId={contactId} />}
          {activeTab === 'timeline'      && <TimelineTab />}
          {activeTab === 'kyc'           && <KYCTab />}
          {activeTab === 'documents'     && <DocumentsTab />}
        </div>

        {/* Activity panel (280px, desktop only) */}
        <aside className="hidden xl:flex w-[280px] shrink-0 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Quick stats
            </p>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-500">Stage</span>
              <Badge style={{ backgroundColor: currentStage.color + '20', color: currentStage.color }}>
                {currentStage.label}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-500">Owner</span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {contact.ownerName ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-500">Messages</span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {messageCount}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-500">Created</span>
              <span className="text-neutral-700 dark:text-neutral-300">
                {contact.createdAt ? format(new Date(contact.createdAt), 'd MMM yyyy') : '—'}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
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
