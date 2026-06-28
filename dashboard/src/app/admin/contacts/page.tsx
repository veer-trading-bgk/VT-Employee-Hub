'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { TagBadge } from '@/components/tags/TagBadge';
import { TagSelector } from '@/components/tags/TagSelector';
import type { Tag } from '@/components/tags/TagBadge';
import { apiFetch } from '@/lib/api';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Contact {
  id: string;
  type: 'lead' | 'unknown';
  PK: string;
  leadId: string | null;
  displayName: string;
  name: string | null;
  waName: string | null;
  phone: string;
  email: string | null;
  stage: string | null;
  source: string | null;
  tags: string[]; // tag IDs — resolved via tag catalog
  createdAt: string | null;
  lastMessageAt: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  chatStatus: string | null;
}

interface PipelineStage { key: string; label: string; color: string; }

interface ContactsResponse {
  success: boolean;
  contacts: Contact[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

// ── Column definitions — add future columns here ──────────────────────────────
const COLUMNS = [
  { key: 'name',      label: 'Contact Name', sortable: true  },
  { key: 'phone',     label: 'Phone Number', sortable: false },
  { key: 'email',     label: 'Email ID',     sortable: false },
  { key: 'createdAt', label: 'Created On',   sortable: true  },
  { key: 'stage',     label: 'Status',       sortable: false },
  { key: 'source',    label: 'Source',       sortable: false },
  { key: 'tags',      label: 'Tags',         sortable: false },
] as const;

const SKELETON_WIDTHS: Record<string, string> = {
  name: '65%', phone: '55%', email: '72%', createdAt: '38%', stage: '50%', source: '42%', tags: '60%',
};

// ── Source badge config — add future sources here ─────────────────────────────
const SOURCE_CONFIG: Record<string, { label: string; cls: string }> = {
  whatsapp:    { label: 'WhatsApp',  cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  instagram:   { label: 'Instagram', cls: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400' },
  form:        { label: 'Form',      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  api:         { label: 'API',       cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  import:      { label: 'Import',    cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  manual:      { label: 'Manual',    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  referral:    { label: 'Referral',  cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  webinar:     { label: 'Webinar',   cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
  social:      { label: 'Social',    cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  walk_in:     { label: 'Walk-in',   cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
  whatsapp_ai: { label: 'WA AI',     cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];
function avatarColor(str?: string | null) {
  if (!str) return '#94a3b8';
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}
function avatarLetters(name?: string | null, phone?: string) {
  if (name) return name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  return (phone ?? '??').slice(-2);
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

// ── Source Badge ──────────────────────────────────────────────────────────────
function SourceBadge({ source }: { source: string | null }) {
  if (!source) return <span className="text-slate-400">—</span>;
  const cfg = SOURCE_CONFIG[source] ?? { label: source, cls: 'bg-slate-100 text-slate-500' };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({ page, pages, total, pageSize, onChange }: {
  page: number; pages: number; total: number; pageSize: number;
  onChange: (p: number) => void;
}) {
  const from = Math.min((page - 1) * pageSize + 1, total);
  const to   = Math.min(page * pageSize, total);

  const nums: (number | '…')[] = [];
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) nums.push(i);
  } else {
    nums.push(1);
    if (page > 3) nums.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i++) nums.push(i);
    if (page < pages - 2) nums.push('…');
    nums.push(pages);
  }

  return (
    <div className="flex flex-col items-center gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800 sm:flex-row sm:justify-between">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {total === 0 ? 'No contacts' : `Showing ${from}–${to} of ${total} contacts`}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onChange(page - 1)} disabled={page === 1}
            className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
            ‹ Prev
          </button>
          {nums.map((n, i) =>
            n === '…' ? (
              <span key={`e${i}`} className="px-1 text-slate-400">…</span>
            ) : (
              <button key={n} onClick={() => onChange(n as number)}
                className={`min-w-[28px] rounded-lg px-2 py-1 text-xs font-medium transition ${
                  n === page
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}>
                {n}
              </button>
            )
          )}
          <button onClick={() => onChange(page + 1)} disabled={page === pages}
            className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ContactHubPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Filter state
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch]           = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [stageFilter, setStageFilter]   = useState('');
  const [tagFilter, setTagFilter]       = useState('');
  const [page, setPage]               = useState(1);

  // Tag selector state — which contact's tag selector is open + screen position
  const [selectorState, setSelectorState] = useState<{
    contact: Contact;
    top: number;
    left: number;
  } | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [sourceFilter, stageFilter, tagFilter]);

  // Build the query key used everywhere for this contacts list
  const contactsQKey = ['contacts', { search, sourceFilter, stageFilter, tagFilter, page }] as const;

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: contactsQKey,
    queryFn: () =>
      apiFetch<ContactsResponse>(
        `/api/contacts?q=${encodeURIComponent(search)}&source=${sourceFilter}&stage=${stageFilter}&tag=${tagFilter}&page=${page}&pageSize=50`
      ),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });

  const { data: tagCatalogData, isLoading: tagsLoading } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () => apiFetch<{ success: boolean; tags: Tag[] }>('/api/tags'),
    staleTime: 2 * 60_000,
  });

  const contacts     = data?.contacts ?? [];
  const total        = data?.total ?? 0;
  const pages        = data?.pages ?? 1;
  const stages       = pipelineData?.stages ?? [];
  const tagCatalog   = tagCatalogData?.tags ?? [];

  // Clear selection when contacts page/filter result changes
  useEffect(() => { setSelectedIds(new Set()); }, [data]);

  // ── Stage mutation ────────────────────────────────────────────────────────
  const stageMutation = useMutation({
    mutationFn: ({ leadId, phone, stage }: { leadId: string | null; phone: string; stage: string }) =>
      apiFetch('/api/contacts/stage', { method: 'PUT', body: JSON.stringify({ leadId, phone, stage }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });

  // ── Tag mutation (optimistic) ─────────────────────────────────────────────
  const tagMutation = useMutation({
    mutationFn: ({ leadId, phone, add, remove }: {
      leadId: string | null; phone: string; add: string[]; remove: string[];
    }) =>
      apiFetch('/api/tags/contacts', { method: 'PUT', body: JSON.stringify({ leadId, phone, add, remove }) }),

    onMutate: async ({ leadId, phone, add, remove }) => {
      await qc.cancelQueries({ queryKey: contactsQKey });
      const prev = qc.getQueryData<ContactsResponse>(contactsQKey);
      if (prev) {
        qc.setQueryData(contactsQKey, {
          ...prev,
          contacts: prev.contacts.map((c) => {
            const match = leadId ? c.leadId === leadId : c.phone === phone;
            if (!match) return c;
            const updated = [
              ...c.tags.filter((t) => !remove.includes(t)),
              ...add.filter((t) => !c.tags.includes(t)),
            ];
            return { ...c, tags: updated };
          }),
        });
      }
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(contactsQKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });

  // ── Create tag mutation ───────────────────────────────────────────────────
  const createTagMutation = useMutation({
    mutationFn: ({ label, color }: { label: string; color: string }) =>
      apiFetch<{ success: boolean; tag: Tag }>('/api/tags', {
        method: 'POST',
        body: JSON.stringify({ label, color }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tag-catalog'] }),
  });

  // ── Bulk delete mutation ──────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async ({ leadIds, unknownPhones }: { leadIds: string[]; unknownPhones: string[] }) => {
      await Promise.all([
        ...leadIds.map((id) => apiFetch(`/api/crm/leads/${id}`, { method: 'DELETE' })),
        ...unknownPhones.map((phone) => apiFetch(`/api/contacts/unknown/${encodeURIComponent(phone)}`, { method: 'DELETE' })),
      ]);
      return leadIds.length + unknownPhones.length;
    },
    onSuccess: (count) => {
      setSelectedIds(new Set());
      setConfirmDelete(false);
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(`${count} contact(s) deleted`);
    },
    onError: () => {
      setConfirmDelete(false);
      toast.error('Failed to delete contacts. Please try again.');
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const allRowIds = contacts.map((c) => `${c.type}-${c.id}`);
  const allSelected = allRowIds.length > 0 && allRowIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  // Lead contacts: soft-deleted via DELETE /api/crm/leads/:id
  const selectedLeadIds = contacts
    .filter((c) => selectedIds.has(`${c.type}-${c.id}`) && c.type === 'lead' && c.leadId)
    .map((c) => c.leadId as string);

  // Unknown/inbox contacts: hard-deleted via DELETE /api/contacts/unknown/:phone
  const selectedUnknownPhones = contacts
    .filter((c) => selectedIds.has(`${c.type}-${c.id}`) && c.type === 'unknown' && c.phone)
    .map((c) => c.phone);

  const totalSelected = selectedLeadIds.length + selectedUnknownPhones.length;

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allRowIds));
  }
  function toggleOne(key: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const SELECTOR_HEIGHT = 280;
  function openTagSelector(contact: Contact, e: React.MouseEvent<HTMLElement>) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const top = rect.bottom + 4 + SELECTOR_HEIGHT > window.innerHeight
      ? rect.top - SELECTOR_HEIGHT - 4
      : rect.bottom + 4;
    setSelectorState({
      contact,
      top,
      left: Math.min(rect.left, window.innerWidth - 240),
    });
  }

  function handleToggleTag(contact: Contact, tagId: string) {
    const isApplied = contact.tags.includes(tagId);
    // Update selector state optimistically so checkboxes respond instantly
    setSelectorState((s) =>
      s && s.contact.id === contact.id && s.contact.type === contact.type
        ? {
            ...s,
            contact: {
              ...s.contact,
              tags: isApplied
                ? s.contact.tags.filter((t) => t !== tagId)
                : [...s.contact.tags, tagId],
            },
          }
        : s
    );
    tagMutation.mutate({
      leadId: contact.leadId,
      phone: contact.phone,
      add: isApplied ? [] : [tagId],
      remove: isApplied ? [tagId] : [],
    });
  }

  async function handleCreateTag(contact: Contact, label: string, color: string) {
    const res = await createTagMutation.mutateAsync({ label, color });
    if (res?.tag) {
      // Immediately apply the newly created tag to the triggering contact
      handleToggleTag({ ...contact, tags: contact.tags }, res.tag.id);
    }
  }

  const openChat = useCallback((c: Contact) => {
    if (c.type === 'lead' && c.leadId) {
      router.push(`/admin/whatsapp?leadId=${c.leadId}`);
    } else {
      router.push(`/admin/whatsapp?phone=${encodeURIComponent(c.phone)}`);
    }
  }, [router]);

  const exportCsv = () => {
    const rows = contacts.map((c: any) => ({
      Name: c.name ?? '',
      Phone: c.phone ?? '',
      Email: c.email ?? '',
      Stage: c.stage ?? '',
      Source: c.source ?? '',
      Tags: (c.tags ?? []).join('; '),
      Assigned: c.assignedToName ?? '',
      Updated: c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('en-IN') : '',
    }));
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map((r: any) => headers.map((h: string) => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} contacts exported to CSV`);
  };

  const anyFilter = !!(searchInput || sourceFilter || stageFilter || tagFilter);

  return (
    <ErrorBoundary>
    <div className="flex h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Page header ──────────────────────────────────────────────── */}
        <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Contact Hub</h1>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Unified view of all leads and WhatsApp contacts
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                {total} total
              </span>
            </div>
          </div>

          {/* ── Filters bar ──────────────────────────────────────────────── */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative min-w-[180px] flex-1 max-w-xs">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">🔍</span>
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by name or phone"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-indigo-500"
              />
              {searchInput && (
                <button onClick={() => setSearchInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  ✕
                </button>
              )}
            </div>

            {/* Source filter */}
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <option value="">All Sources</option>
              {Object.entries(SOURCE_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>

            {/* Status filter */}
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <option value="">All Statuses</option>
              {stages.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>

            {/* Tag filter */}
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <option value="">All Tags</option>
              {tagCatalog.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>

            {/* Clear filters */}
            {anyFilter && (
              <button
                onClick={() => { setSearchInput(''); setSourceFilter(''); setStageFilter(''); setTagFilter(''); }}
                className="text-xs text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-200"
              >
                Clear all
              </button>
            )}

            {/* CSV export */}
            {contacts.length > 0 && (
              <button
                onClick={exportCsv}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                ↓ CSV
              </button>
            )}

            {/* Bulk delete — visible when any deletable contact is selected */}
            {totalSelected > 0 && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete ({totalSelected})
              </button>
            )}
          </div>

          {/* Active tag filter chip */}
          {tagFilter && (() => {
            const tag = tagCatalog.find((t) => t.id === tagFilter);
            return tag ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">Filtered by tag:</span>
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: tag.color + '20', color: tag.color, borderColor: tag.color + '50' }}
                >
                  {tag.label}
                  <button onClick={() => setTagFilter('')} className="opacity-60 hover:opacity-100">×</button>
                </span>
              </div>
            ) : null;
          })()}
        </div>

        {/* ── Table ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="w-8 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                </th>
                {COLUMNS.map((col) => (
                  <th key={col.key}
                    className="border-b border-slate-200 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    {col.label}
                  </th>
                ))}
                <th className="border-b border-slate-200 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Message
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-4 py-3"><div className="h-3 w-3 rounded bg-slate-200 dark:bg-slate-700" /></td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-3 py-3">
                        <div className="h-3 rounded bg-slate-200 dark:bg-slate-700" style={{ width: SKELETON_WIDTHS[c.key] ?? '60%' }} />
                      </td>
                    ))}
                    <td className="px-3 py-3"><div className="h-3 w-6 rounded bg-slate-200 dark:bg-slate-700" /></td>
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="py-16 text-center text-slate-400">
                    <p className="mb-2 text-4xl">📭</p>
                    <p className="text-sm font-medium">No contacts found</p>
                    {anyFilter && <p className="mt-1 text-xs">Try clearing the filters</p>}
                  </td>
                </tr>
              ) : (
                contacts.map((c) => {
                  const stageObj  = stages.find((s) => s.key === c.stage);
                  const color     = avatarColor(c.displayName);
                  const resolvedTags = c.tags
                    .map((id) => tagCatalog.find((t) => t.id === id))
                    .filter((t): t is Tag => !!t);
                  const isOpen =
                    selectorState?.contact.id === c.id &&
                    selectorState?.contact.type === c.type;

                  return (
                    <tr key={`${c.type}-${c.id}`}
                      className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">

                      {/* Checkbox — row selection */}
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(`${c.type}-${c.id}`)}
                          onChange={() => toggleOne(`${c.type}-${c.id}`)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                      </td>

                      {/* Contact Name */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                            style={{ backgroundColor: color }}>
                            {avatarLetters(c.displayName, c.phone)}
                          </div>
                          <div className="min-w-0">
                            <p className="max-w-[160px] truncate font-medium text-slate-900 dark:text-white">
                              {c.displayName || '—'}
                            </p>
                            {c.waName && c.waName !== c.displayName && (
                              <p className="max-w-[160px] truncate text-[10px] text-slate-400">
                                WA: {c.waName}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Phone */}
                      <td className="px-3 py-3">
                        <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
                          {c.phone ? `+91 ${c.phone}` : '—'}
                        </span>
                      </td>

                      {/* Email */}
                      <td className="px-3 py-3">
                        <span className="block max-w-[150px] truncate text-xs text-slate-600 dark:text-slate-400">
                          {c.email ?? '—'}
                        </span>
                      </td>

                      {/* Created On */}
                      <td className="px-3 py-3">
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {fmtDate(c.createdAt)}
                        </span>
                      </td>

                      {/* Status — inline editable dropdown */}
                      <td className="px-3 py-3">
                        <select
                          value={c.stage ?? ''}
                          onChange={(e) => stageMutation.mutate({ leadId: c.leadId, phone: c.phone, stage: e.target.value })}
                          onClick={(e) => e.stopPropagation()}
                          className="cursor-pointer rounded-lg border px-2 py-1 text-xs font-medium outline-none transition"
                          style={
                            stageObj
                              ? { borderColor: stageObj.color + '80', color: stageObj.color, backgroundColor: stageObj.color + '18' }
                              : { borderColor: '#e2e8f0', color: '#64748b', backgroundColor: '#f8fafc' }
                          }
                        >
                          <option value="">Select Status</option>
                          {stages.map((s) => (
                            <option key={s.key} value={s.key}>{s.label}</option>
                          ))}
                        </select>
                      </td>

                      {/* Source */}
                      <td className="px-3 py-3">
                        <SourceBadge source={c.source} />
                      </td>

                      {/* Tags — click to open selector */}
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={(e) => openTagSelector(c, e)}
                          className={`group/tags flex min-h-[28px] min-w-[60px] flex-wrap items-center gap-1 rounded-lg px-1 py-0.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800 ${isOpen ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
                          title="Click to edit tags"
                        >
                          {resolvedTags.length === 0 ? (
                            <span className="text-[10px] text-slate-300 group-hover/tags:text-slate-400 dark:text-slate-600 dark:group-hover/tags:text-slate-500">
                              + Add tag
                            </span>
                          ) : (
                            <>
                              {resolvedTags.slice(0, 2).map((tag) => (
                                <TagBadge key={tag.id} tag={tag} />
                              ))}
                              {resolvedTags.length > 2 && (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800">
                                  +{resolvedTags.length - 2}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      </td>

                      {/* Send Message */}
                      <td className="px-3 py-3">
                        <button
                          onClick={() => openChat(c)}
                          title="Open WhatsApp chat"
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.532 5.849L0 24l6.335-1.508A11.933 11.933 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.369l-.36-.214-3.727.977.995-3.635-.235-.374A9.818 9.818 0 1112 21.818z"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ────────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-slate-900">
          <Pagination page={page} pages={pages} total={total} pageSize={50} onChange={setPage} />
        </div>
      </div>

      {/* ── Delete confirm dialog ─────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setConfirmDelete(false)}>
          <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="mb-1 text-base font-semibold text-slate-900 dark:text-white">
              Delete {totalSelected} contact{totalSelected !== 1 ? 's' : ''}?
            </h3>
            <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
              {selectedLeadIds.length > 0 && 'CRM leads can be restored later. '}
              {selectedUnknownPhones.length > 0 && 'Inbox-only contacts will be permanently removed.'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleteMutation.isPending}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate({ leadIds: selectedLeadIds, unknownPhones: selectedUnknownPhones })}
                disabled={deleteMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tag Selector — rendered outside table to avoid overflow clip ─── */}
      {selectorState && (
        <div
          style={{
            position: 'fixed',
            top: selectorState.top,
            left: selectorState.left,
            zIndex: 9999,
          }}
        >
          <TagSelector
            catalogTags={tagCatalog}
            selectedIds={selectorState.contact.tags}
            loading={tagsLoading}
            onToggle={(tagId) => handleToggleTag(selectorState.contact, tagId)}
            onCreate={(label, color) => handleCreateTag(selectorState.contact, label, color)}
            onClose={() => setSelectorState(null)}
          />
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
