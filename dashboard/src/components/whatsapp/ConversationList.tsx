'use client';

import { useState } from 'react';
import { useInbox, timeAgo, avatarLetters, CHAT_STATUS_CHIP } from '@/contexts/InboxContext';
import { SkeletonConversation } from '@/components/common/Skeleton';
import { apiFetch } from '@/lib/api';
import { Pin, PinOff } from 'lucide-react';

const TABS: Array<{ key: 'open' | 'unassigned' | 'unread' | 'resolved' | 'all'; label: string }> = [
  { key: 'open',       label: 'Open' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'unread',     label: 'Unread' },
  { key: 'resolved',   label: 'Resolved' },
];

export function ConversationList() {
  const {
    selected, selectConv, activeTab, setActiveTab,
    conversations, counts, stages, inboxLoading,
    isAvailable, availMutation, autoAssignMutation,
    pinMutation,
  } = useInbox();
  const [search, setSearch] = useState('');

  const filtered = conversations.filter(
    (c) => !search || c.displayName?.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
  );

  return (
    <div className={`flex w-full flex-shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:w-[288px] ${selected ? 'hidden md:flex' : 'flex'}`}>
      {/* Search + availability */}
      <div className="border-b border-slate-100 p-3 dark:border-slate-800 space-y-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-400">Your status</span>
          <button
            onClick={() => availMutation.mutate(!isAvailable)}
            disabled={availMutation.isPending}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
              isAvailable
                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
            }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isAvailable ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {isAvailable ? 'Available' : 'Away'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 dark:border-slate-800">
        {TABS.map((tab) => {
          const count = counts[tab.key] ?? 0;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}>
              {tab.label}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                  activeTab === tab.key ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                }`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Auto-assign button (unassigned tab) */}
      {activeTab === 'unassigned' && counts.unassigned > 0 && (
        <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
          <button onClick={() => autoAssignMutation.mutate()} disabled={autoAssignMutation.isPending}
            className="w-full rounded-lg bg-indigo-600 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            {autoAssignMutation.isPending ? 'Assigning…' : `⚡ Auto-Assign ${counts.unassigned} Chats`}
          </button>
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 divide-y divide-slate-50 overflow-y-auto dark:divide-slate-800/50">
        {inboxLoading ? (
          <div className="flex-1 overflow-y-auto">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <SkeletonConversation key={i} />)}
          </div>
        ) : null}
        {!inboxLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center p-10 text-center">
            <span className="mb-3 text-4xl">💬</span>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {activeTab === 'resolved' ? 'No resolved conversations' : activeTab === 'unassigned' ? 'All chats are assigned' : 'No open conversations'}
            </p>
          </div>
        )}
        {filtered.map((conv) => {
          const key = conv.type === 'lead' ? conv.leadId! : `unk-${conv.phone}`;
          const stage = stages.find((s) => s.key === conv.stage);
          const isActive = selected
            ? conv.type === 'lead' ? selected.leadId === conv.leadId : selected.phone === conv.phone && selected.type === 'unknown'
            : false;
          const assigneeInitials = conv.assignedToName?.split(' ').map((n) => n[0]).join('').slice(0, 2) ?? '';
          const unread = conv.unreadCount ?? 0;
          return (
            <div key={key} className="group relative">
              {conv.type === 'lead' && conv.leadId && (
                <button
                  onClick={(e) => { e.stopPropagation(); pinMutation.mutate(conv.leadId!); }}
                  title={conv.pinned ? 'Unpin' : 'Pin conversation'}
                  className={`absolute right-2 top-2 z-10 rounded-full p-0.5 transition-opacity ${
                    conv.pinned ? 'text-indigo-500' : 'text-slate-300 opacity-0 group-hover:opacity-100'
                  } hover:text-indigo-600`}>
                  {conv.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                </button>
              )}
              <button onClick={() => {
                selectConv({ ...conv, unreadCount: 0 });
                if (conv.type === 'lead' && conv.leadId) {
                  apiFetch(`/api/whatsapp/inbox/${conv.leadId}/mark-read`, { method: 'POST', body: JSON.stringify({ lastWaMessageId: '' }) }).catch(() => {});
                } else {
                  apiFetch(`/api/whatsapp/inbox/unknown/${conv.phone}/mark-read`, { method: 'POST' }).catch(() => {});
                }
              }}
                className={`relative flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/10' : ''} ${unread > 0 && !isActive ? 'bg-emerald-50/40 dark:bg-emerald-900/5' : ''}`}>

                <div className="flex-shrink-0">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${conv.type === 'unknown' ? 'bg-slate-400' : 'bg-indigo-500'}`}>
                    {avatarLetters(conv.displayName, conv.phone)}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-1">
                    <p className={`truncate text-sm ${unread > 0 ? 'font-bold text-slate-900 dark:text-white' : 'font-semibold text-slate-700 dark:text-slate-200'}`}>
                      {conv.displayName ?? conv.phone}
                    </p>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      {unread > 1 && (
                        <span title="Unread messages" className="flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                          {unread}
                        </span>
                      )}
                      {unread === 1 && (
                        <span title="Unread message" className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      )}
                      <span className="text-[10px] text-slate-400">{conv.lastMessageAt ? timeAgo(conv.lastMessageAt) : ''}</span>
                    </div>
                  </div>

                  <div className="mt-0.5 flex items-center gap-1.5">
                    {conv.type === 'unknown' && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">New</span>}
                    {stage && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ backgroundColor: stage.color }}>{stage.label}</span>}
                    {conv.assignedToName && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{assigneeInitials}</span>}
                  </div>

                  {conv.lastMessagePreview && (
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {conv.lastMessageDirection === 'outbound' ? '↗ ' : ''}{conv.lastMessagePreview}
                    </p>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
