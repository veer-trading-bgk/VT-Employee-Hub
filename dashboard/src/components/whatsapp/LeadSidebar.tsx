'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useInbox, avatarLetters, CHAT_STATUS_CHIP } from '@/contexts/InboxContext';
import { apiFetch } from '@/lib/api';

export function LeadSidebar() {
  const {
    selected, currentLead, liveStage, liveAssignedTo, liveTags, stageObj,
    stages, employees, tagCatalog, tagById, editingName, nameInput,
    setEditingName, setNameInput, stageMutation, assignMutation, tagMutation,
    noteMutation, qc, showSidebar, windowExpired, nameMutation,
  } = useInbox();
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [quickNote, setQuickNote] = useState('');

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

  return (
    <div className="hidden w-[268px] flex-shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">

      {/* Contact Info */}
      <div className="border-b border-slate-100 p-4 dark:border-slate-800">
        <div className="mb-3 flex items-center gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white ${selected.type === 'unknown' ? 'bg-slate-400' : 'bg-indigo-500'}`}>
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
                onClick={() => { setNameInput(currentLead?.name ?? selected.displayName ?? selected.phone); setEditingName(true); }}
                title="Click to edit name"
              >
                <span className="truncate text-sm font-bold text-slate-900 dark:text-white">{currentLead?.name ?? selected.displayName ?? selected.phone}</span>
                <span className="flex-shrink-0 text-[10px] text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600">✏</span>
              </button>
            )}
            <p className="text-xs text-slate-400">{selected.phone}</p>
            {selected.email && <p className="truncate text-xs text-slate-400">{selected.email}</p>}
          </div>
        </div>

        {selected.type === 'lead' && (
          <Link href={`/admin/crm/${selected.leadId}`}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400">
            View CRM Profile ↗
          </Link>
        )}
      </div>

      {/* Stage + Assign (leads only) */}
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

      {/* Tags */}
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
          <div className="flex gap-1">
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newTag.trim()) handleSidebarAddTag(); }}
              disabled={addingTag}
              placeholder="Add tag + Enter"
              className="flex-1 rounded-lg border border-dashed border-slate-300 bg-transparent px-2.5 py-1.5 text-[11px] outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-slate-600 dark:text-white" />
          </div>
        </div>
      )}

      {/* Quick note */}
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

      {/* Meta info */}
      <div className="p-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Details</p>
        <div className="space-y-2 text-xs">
          {selected.source && <div className="flex justify-between"><span className="text-slate-400">Source</span><span className="font-medium capitalize text-slate-700 dark:text-slate-300">{selected.source.replace(/_/g, ' ')}</span></div>}
          <div className="flex justify-between"><span className="text-slate-400">Status</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold capitalize ${CHAT_STATUS_CHIP[selected.chatStatus]}`}>{selected.chatStatus}</span>
          </div>
          {selected.createdAt && <div className="flex justify-between"><span className="text-slate-400">Created</span><span className="text-slate-500">{new Date(selected.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</span></div>}
          <div className="flex justify-between"><span className="text-slate-400">WhatsApp</span>
            <span className={`font-semibold ${windowExpired ? 'text-red-500' : 'text-emerald-600'}`}>{windowExpired ? '24h expired' : 'Active'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
