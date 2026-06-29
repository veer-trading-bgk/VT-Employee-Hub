'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { Trash2, UserPlus } from 'lucide-react';
import { useInbox, avatarLetters, CHAT_STATUS_CHIP } from '@/contexts/InboxContext';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';

export function LeadSidebar() {
  const {
    selected, selectConv, currentLead, liveStage, liveAssignedTo, liveTags, stageObj,
    stages, employees, tagCatalog, tagById, editingName, nameInput,
    setEditingName, setNameInput, stageMutation, assignMutation, tagMutation,
    noteMutation, qc, showSidebar, windowExpired, nameMutation,
  } = useInbox();

  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [quickNote, setQuickNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [promoteExpanded, setPromoteExpanded] = useState(false);
  const [promoteName, setPromoteName] = useState('');

  // Reset transient UI state when switching conversations
  const convKey = selected?.type === 'lead' ? selected.leadId : selected?.phone;
  useEffect(() => {
    setConfirmDelete(false);
    setPromoteExpanded(false);
    setPromoteName('');
    setQuickNote('');
  }, [convKey]);

  // Keyboard: Escape closes the delete dialog
  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirmDelete(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmDelete]);

  // ── Promote unknown contact to CRM lead ───────────────────────────────────
  const promoteMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch('/api/crm/leads', {
        method: 'POST',
        retries: 0,
        body: JSON.stringify({
          name,
          phone: selected!.phone,
          source: selected!.source ?? 'whatsapp',
        }),
      }),
    onSuccess: () => {
      toast.success('Contact saved to CRM');
      setPromoteExpanded(false);
      setPromoteName('');
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (err: any) => {
      if (err?.status === 409) toast.error('This phone number is already in CRM');
      else toast.error('Failed to save contact');
    },
  });

  // ── Hard-purge contact + all message history ──────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => {
      if (selected!.type === 'lead') {
        return apiFetch(`/api/crm/leads/${selected!.leadId}`, { method: 'DELETE' });
      }
      return apiFetch(`/api/contacts/unknown/${encodeURIComponent(selected!.phone)}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast.success('Contact permanently deleted');
      setConfirmDelete(false);
      selectConv(null);
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: () => {
      setConfirmDelete(false);
      toast.error('Failed to delete contact');
    },
  });

  async function handleSidebarAddTag() {
    const label = newTag.trim();
    if (!label || addingTag || !selected?.leadId) return;
    setAddingTag(true);
    try {
      let tagId: string;
      const found = tagCatalog.find((t) => t.label.toLowerCase() === label.toLowerCase());
      if (found) {
        tagId = found.id;
      } else {
        const res = await apiFetch<{ success: boolean; tag: { id: string } }>('/api/tags', {
          method: 'POST',
          body: JSON.stringify({ label, color: '#6366f1' }),
        });
        tagId = res.tag.id;
        qc.invalidateQueries({ queryKey: ['tag-catalog'] });
      }
      if (!liveTags.includes(tagId)) {
        tagMutation.mutate([...liveTags, tagId]);
      }
      setNewTag('');
    } catch { toast.error('Failed to add tag'); } finally { setAddingTag(false); }
  }

  if (!selected || !showSidebar) return null;

  const displayName = currentLead?.name ?? selected.displayName ?? selected.phone;

  return (
    <div className="hidden w-[268px] flex-shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
      <div className="flex flex-1 flex-col overflow-y-auto">

        {/* ── Contact Info ──────────────────────────────────────────────── */}
        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="mb-3 flex items-center gap-3">
            <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${selected.type === 'unknown' ? 'bg-slate-400' : 'bg-indigo-500'}`}>
              {avatarLetters(currentLead?.name ?? selected.displayName, selected.phone)}
            </div>
            <div className="min-w-0 flex-1">
              {editingName ? (
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nameInput.trim()) {
                      nameMutation.mutate({ leadId: selected.leadId, phone: selected.type === 'unknown' ? selected.phone : undefined, name: nameInput.trim() });
                    } else if (e.key === 'Escape') {
                      setEditingName(false);
                    }
                  }}
                  onBlur={() => setEditingName(false)}
                  className="w-full rounded border border-indigo-300 px-2 py-0.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 dark:border-indigo-700 dark:bg-slate-800 dark:text-white"
                />
              ) : (
                <button
                  className="group flex w-full items-center gap-1.5 text-left"
                  onClick={() => { setNameInput(displayName); setEditingName(true); }}
                  title="Click to edit name"
                >
                  <span className="truncate text-sm font-bold text-slate-900 dark:text-white">{displayName}</span>
                  <span className="flex-shrink-0 text-[10px] text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600">✏</span>
                </button>
              )}
              <p className="text-xs text-slate-400">{selected.phone}</p>
              {selected.email && <p className="truncate text-xs text-slate-400">{selected.email}</p>}
            </div>
          </div>

          {/* Unknown contact notice */}
          {selected.type === 'unknown' && (
            <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-900/10 dark:text-amber-400">
              Not in CRM yet{isAdmin ? ' — save as contact to unlock full profile' : ''}
            </div>
          )}

          {selected.type === 'lead' && (
            <Link href={`/admin/contacts/${selected.leadId}?tab=conversation&from=inbox`}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400">
              Open in Customer 360 ↗
            </Link>
          )}
        </div>

        {/* ── Pipeline: stage + assign (leads only) ────────────────────── */}
        {selected.type === 'lead' && (
          <div className="border-b border-slate-100 p-4 dark:border-slate-800">
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Pipeline</p>
            <select value={liveStage ?? ''}
              onChange={(e) => stageMutation.mutate(e.target.value)}
              style={stageObj ? { borderColor: stageObj.color } : {}}
              className="mb-2.5 w-full rounded-lg border bg-white px-3 py-2 text-xs font-semibold outline-none dark:bg-slate-800 dark:text-white">
              {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select value={liveAssignedTo}
              onChange={(e) => assignMutation.mutate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <option value="">Unassigned</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        )}

        {/* ── Tags (leads only) ────────────────────────────────────────── */}
        {selected.type === 'lead' && (
          <div className="border-b border-slate-100 p-4 dark:border-slate-800">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Tags</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {liveTags.map((t) => {
                const tag = tagById(t);
                return (
                  <span key={t} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                    style={{ backgroundColor: tag?.color ?? '#6366f1' }}>
                    {tag?.label ?? t}
                    <button onClick={() => tagMutation.mutate(liveTags.filter((x) => x !== t))}
                      className="opacity-70 hover:opacity-100">×</button>
                  </span>
                );
              })}
            </div>
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newTag.trim()) handleSidebarAddTag(); }}
              disabled={addingTag}
              placeholder="Add tag + Enter"
              className="w-full rounded-lg border border-dashed border-slate-300 bg-transparent px-2.5 py-1.5 text-[11px] outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-slate-600 dark:text-white"
            />
          </div>
        )}

        {/* ── Quick Note (leads only) ──────────────────────────────────── */}
        {selected.type === 'lead' && (
          <div className="border-b border-slate-100 p-4 dark:border-slate-800">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Quick Note</p>
            <textarea value={quickNote} onChange={(e) => setQuickNote(e.target.value)} rows={3}
              placeholder="Add a private note…"
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
            <button
              onClick={() => {
                if (!quickNote.trim()) return;
                noteMutation.mutate(quickNote, {
                  onSuccess: () => { setQuickNote(''); toast.success('Note saved'); },
                  onError: () => toast.error('Failed to save note'),
                });
              }}
              disabled={!quickNote.trim() || noteMutation.isPending}
              className="mt-2 w-full rounded-lg bg-amber-500 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-40">
              {noteMutation.isPending ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        )}

        {/* ── Save as Contact (unknown contacts, admin only) ───────────── */}
        {selected.type === 'unknown' && isAdmin && (
          <div className="border-b border-slate-100 p-4 dark:border-slate-800">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Add to CRM</p>
            {!promoteExpanded ? (
              <button
                onClick={() => {
                  setPromoteName(selected.name ?? selected.displayName ?? '');
                  setPromoteExpanded(true);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 py-2 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Save as Contact
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  autoFocus
                  value={promoteName}
                  onChange={(e) => setPromoteName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && promoteName.trim()) promoteMutation.mutate(promoteName.trim());
                    if (e.key === 'Escape') setPromoteExpanded(false);
                  }}
                  placeholder="Full name *"
                  disabled={promoteMutation.isPending}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setPromoteExpanded(false)}
                    disabled={promoteMutation.isPending}
                    className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">
                    Cancel
                  </button>
                  <button
                    onClick={() => promoteMutation.mutate(promoteName.trim())}
                    disabled={!promoteName.trim() || promoteMutation.isPending}
                    className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {promoteMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Meta details ─────────────────────────────────────────────── */}
        <div className="p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Details</p>
          <div className="space-y-2 text-xs">
            {selected.source && (
              <div className="flex justify-between">
                <span className="text-slate-400">Source</span>
                <span className="font-medium capitalize text-slate-700 dark:text-slate-300">{selected.source.replace(/_/g, ' ')}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400">Status</span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold capitalize ${CHAT_STATUS_CHIP[selected.chatStatus]}`}>{selected.chatStatus}</span>
            </div>
            {selected.createdAt && (
              <div className="flex justify-between">
                <span className="text-slate-400">Created</span>
                <span className="text-slate-500">{new Date(selected.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400">WhatsApp</span>
              <span className={`font-semibold ${windowExpired ? 'text-red-500' : 'text-emerald-600'}`}>{windowExpired ? '24h expired' : 'Active'}</span>
            </div>
          </div>
        </div>

      </div>

      {/* ── Delete Contact — admin only, pinned to bottom ─────────────── */}
      {isAdmin && (
        <div className="flex-shrink-0 border-t border-slate-100 p-3 dark:border-slate-800">
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-medium text-red-600 transition hover:bg-red-100 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Contact
          </button>
        </div>
      )}

      {/* ── Delete confirmation dialog ────────────────────────────────── */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !deleteMutation.isPending && setConfirmDelete(false)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="mb-1 text-base font-semibold text-slate-900 dark:text-white">
              Delete contact permanently?
            </h3>
            <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">
              {displayName}
            </p>
            <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
              This will erase the contact record and <strong>all message history</strong>. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleteMutation.isPending}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {deleteMutation.isPending ? 'Deleting…' : 'Delete Forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
