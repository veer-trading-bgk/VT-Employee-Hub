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
import type { Contact, Followup, Conversation, Message } from '@/types/v3';
import { STAGE_LABELS, type Stage } from '@/types/v3';
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

const STAGE_OPTIONS = (Object.entries(STAGE_LABELS) as [Stage, string][]).map(([value, label]) => ({
  value,
  label,
}));

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

function OverviewTab({ contact, onUpdate }: { contact: Contact; onUpdate: (patch: Partial<Contact>) => Promise<void> }) {
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
            <p className="mb-1 text-xs text-neutral-500">Stage</p>
            <Select
              options={STAGE_OPTIONS}
              value={contact.stage}
              onChange={(e) => onUpdate({ stage: e.target.value as Stage })}
              aria-label="Contact stage"
            />
          </div>
          <div>
            <p className="mb-0.5 text-xs text-neutral-500">Assigned to</p>
            <p className="text-sm text-neutral-900 dark:text-neutral-100">
              {contact.ownerName ?? 'Unassigned'}
            </p>
          </div>
        </div>
      </Card>

      {contact.tags.length > 0 && (
        <Card>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Tags
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {contact.tags.map((tag) => (
              <Badge key={tag} variant="default">
                {tag}
              </Badge>
            ))}
            <button
              className="flex items-center gap-1 rounded-full border border-dashed border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 hover:border-primary-400 hover:text-primary-600"
              aria-label="Add tag"
            >
              <Plus className="h-3 w-3" aria-hidden />
              Add tag
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Follow-ups Tab ────────────────────────────────────────────────────────────

function FollowupsTab({ contactId }: { contactId: string }) {
  const qc = useQueryClient();

  const { data: followups = [], isLoading } = useQuery<Followup[]>({
    queryKey: ['contact-followups', contactId],
    queryFn: async () => {
      const data = await apiFetch<{ followups: Followup[] }>(`/api/contacts/${contactId}/followups`);
      return data.followups ?? [];
    },
    staleTime: 30_000,
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/followups/${id}/complete`, { method: 'POST' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-followups', contactId] });
      toast.success('Follow-up marked complete');
    },
  });

  const upcoming = followups.filter((f) => !f.completedAt);
  const completed = followups.filter((f) => f.completedAt);

  if (isLoading) return <div className="space-y-2 p-4"><SkeletonText lines={4} /></div>;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Upcoming follow-ups
        </h3>
        <Button size="sm" iconLeft={<Plus className="h-4 w-4" />}>
          Add follow-up
        </Button>
      </div>

      {upcoming.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No upcoming follow-ups"
          description="Schedule a call, meeting, or callback"
          action={{ label: 'Add follow-up', onClick: () => {} }}
        />
      ) : (
        <ul className="space-y-2" role="list">
          {upcoming.map((f) => (
            <li
              key={f.id}
              className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning-50 dark:bg-warning-900/20">
                <Clock className="h-4 w-4 text-warning-600" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium capitalize text-neutral-900 dark:text-neutral-100">
                    {f.type}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {format(new Date(f.dueAt), 'EEE, d MMM · h:mm a')}
                  </p>
                </div>
                {f.notes && <p className="mt-0.5 text-xs text-neutral-500">{f.notes}</p>}
              </div>
              <button
                onClick={() => completeMutation.mutate(f.id)}
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
                key={f.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-400"
              >
                <Check className="h-4 w-4 text-success-500 shrink-0" aria-hidden />
                <span className="line-through capitalize">{f.type}</span>
                <span className="ml-auto text-xs">
                  {format(new Date(f.completedAt!), 'd MMM')}
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

function NotesTab({ contactId }: { contactId: string }) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  interface Note {
    id: string;
    body: string;
    authorName: string;
    createdAt: string;
  }

  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ['contact-notes', contactId],
    queryFn: async () => {
      const data = await apiFetch<{ notes: Note[] }>(`/api/contacts/${contactId}/notes`);
      return data.notes ?? [];
    },
    staleTime: 60_000,
  });

  async function addNote() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/api/contacts/${contactId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: draft }),
      });
      setDraft('');
      qc.invalidateQueries({ queryKey: ['contact-notes', contactId] });
    } catch {
      toast.error('Failed to save note');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note about this contact…"
          rows={3}
          className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
        <Button
          size="sm"
          onClick={addNote}
          disabled={!draft.trim()}
          loading={saving}
          className="self-end"
        >
          Save note
        </Button>
      </div>

      <ul className="space-y-3" role="list">
        {notes.map((note) => (
          <li
            key={note.id}
            className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <p className="text-sm text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap">
              {note.body}
            </p>
            <p className="mt-1.5 text-[10px] text-neutral-400">
              {note.authorName} · {format(new Date(note.createdAt), 'd MMM yyyy, h:mm a')}
            </p>
          </li>
        ))}
        {notes.length === 0 && (
          <EmptyState
            icon={FileText}
            title="No notes yet"
            description="Add a note about this contact"
            className="py-8"
          />
        )}
      </ul>
    </div>
  );
}

// ── Conversations Tab ─────────────────────────────────────────────────────────

function ConversationsTab({ contactId }: { contactId: string }) {
  const { data: convs = [] } = useQuery<Conversation[]>({
    queryKey: ['contact-conversations', contactId],
    queryFn: async () => {
      const data = await apiFetch<{ conversations: Conversation[] }>(`/api/contacts/${contactId}/conversations`);
      return data.conversations ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <div className="p-4 space-y-3">
      {convs.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No conversations"
          description="Start a WhatsApp conversation"
          action={{ label: 'New conversation', onClick: () => {} }}
        />
      ) : (
        convs.map((conv) => (
          <Link
            key={conv.id}
            href={`/communications?contactId=${contactId}`}
            className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 hover:border-primary-300 hover:shadow-sm transition-all dark:border-neutral-800 dark:bg-neutral-900"
          >
            <Badge variant={conv.status === 'open' ? 'success' : conv.status === 'pending' ? 'warning' : 'default'}>
              {conv.status}
            </Badge>
            <p className="flex-1 text-sm text-neutral-700 dark:text-neutral-300">
              {conv.lastMessagePreview || 'No messages'}
            </p>
            {conv.lastMessageAt && (
              <span className="text-xs text-neutral-400">
                {format(new Date(conv.lastMessageAt), 'd MMM')}
              </span>
            )}
          </Link>
        ))
      )}
    </div>
  );
}

// ── Timeline Tab ──────────────────────────────────────────────────────────────

function TimelineTab({ contactId }: { contactId: string }) {
  interface TimelineEvent {
    id: string;
    type: string;
    summary: string;
    createdAt: string;
    createdByName?: string;
  }

  const { data: events = [] } = useQuery<TimelineEvent[]>({
    queryKey: ['contact-timeline', contactId],
    queryFn: async () => {
      const data = await apiFetch<{ events: TimelineEvent[] }>(`/api/contacts/${contactId}/timeline`);
      return data.events ?? [];
    },
    staleTime: 60_000,
  });

  if (events.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Activity will appear here as you interact with this contact"
        className="py-12"
      />
    );
  }

  return (
    <div className="p-4">
      <ol className="relative border-l border-neutral-200 dark:border-neutral-800 space-y-4 ml-3">
        {events.map((event) => (
          <li key={event.id} className="pl-5 relative">
            <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-neutral-400 dark:border-neutral-900 dark:bg-neutral-600" />
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {event.summary}
            </p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {event.createdByName && `${event.createdByName} · `}
              {format(new Date(event.createdAt), 'd MMM yyyy, h:mm a')}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Stub tabs ─────────────────────────────────────────────────────────────────

function KYCTab({ contactId: _contactId }: { contactId: string }) {
  return (
    <EmptyState
      icon={Shield}
      title="KYC details"
      description="PAN, Aadhaar, bank account, and verification status will appear here"
      className="py-12"
    />
  );
}

function DocumentsTab({ contactId: _contactId }: { contactId: string }) {
  return (
    <EmptyState
      icon={FolderOpen}
      title="No documents"
      description="Shared WhatsApp media and uploaded files will appear here"
      className="py-12"
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function Contact360Content({ contactId }: { contactId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();

  const tabParam = searchParams.get('tab') as C360Tab | null;
  const [activeTab, setActiveTab] = useState<C360Tab>(tabParam ?? 'overview');

  const { data: contact, isLoading } = useQuery<Contact>({
    queryKey: ['contact', contactId],
    queryFn: async () => {
      const data = await apiFetch<{ contact: Contact }>(`/api/contacts/${contactId}`);
      return data.contact;
    },
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<Contact>) => {
      return apiFetch<{ contact: Contact }>(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['contact', contactId] });
      qc.setQueryData<Contact>(['contact', contactId], (old) =>
        old ? { ...old, ...patch } : old,
      );
    },
    onSuccess: (data) => {
      qc.setQueryData(['contact', contactId], (data as { contact: Contact }).contact);
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      toast.error('Update failed');
    },
  });

  async function handleUpdate(patch: Partial<Contact>) {
    await updateMutation.mutateAsync(patch);
  }

  function changeTab(tab: C360Tab) {
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
          description="This contact may have been deleted"
          action={{ label: 'Go to Contacts', onClick: () => router.push('/contacts') }}
        />
      </div>
    );
  }

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
            <Badge variant="stage" stage={contact.stage}>
              {STAGE_LABELS[contact.stage]}
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
          {activeTab === 'overview'      && <OverviewTab contact={contact} onUpdate={handleUpdate} />}
          {activeTab === 'conversations' && <ConversationsTab contactId={contactId} />}
          {activeTab === 'notes'         && <NotesTab contactId={contactId} />}
          {activeTab === 'followups'     && <FollowupsTab contactId={contactId} />}
          {activeTab === 'timeline'      && <TimelineTab contactId={contactId} />}
          {activeTab === 'kyc'           && <KYCTab contactId={contactId} />}
          {activeTab === 'documents'     && <DocumentsTab contactId={contactId} />}
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
              <Badge variant="stage" stage={contact.stage}>{STAGE_LABELS[contact.stage]}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-500">Owner</span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {contact.ownerName ?? '—'}
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
