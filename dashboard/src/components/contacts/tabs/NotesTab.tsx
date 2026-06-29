'use client';

import { memo, useState, useMemo } from 'react';
import { useCustomer360 } from '@/contexts/Customer360Context';
import { useContactMutations } from '@/hooks/useContactMutations';

function fmtRelTime(iso: string): string {
  const ms   = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function NotesPanel() {
  const { leadId, notes }  = useCustomer360();
  const { addNote }        = useContactMutations(leadId);
  const [text, setText]    = useState('');

  const sortedNotes = useMemo(() => [...notes].reverse(), [notes]);

  function handlePost() {
    const trimmed = text.trim();
    if (!trimmed) return;
    addNote.mutate(trimmed, { onSuccess: () => setText('') });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-10">

      {/* ── Compose ───────────────────────────────────────────── */}
      <section
        aria-labelledby="notes-compose-heading"
        className="rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h2
          id="notes-compose-heading"
          className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500"
        >
          Add Internal Note
        </h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write an internal note — only visible to your team…"
          rows={3}
          className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-indigo-500"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost(); }}
          aria-label="Internal note"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[10px] text-slate-400">Cmd / Ctrl + Enter to post</p>
          <button
            onClick={handlePost}
            disabled={addNote.isPending || !text.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {addNote.isPending ? 'Posting…' : 'Post Note'}
          </button>
        </div>
      </section>

      {/* ── Notes feed ────────────────────────────────────────── */}
      {sortedNotes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-700">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No notes yet</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            Internal notes are only visible to your team, not the contact.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" role="list" aria-label="Internal notes">
          {sortedNotes.map((note) => {
            const author = note.sentByName || note.authorName || 'Agent';
            return (
              <li
                key={note.SK}
                className="rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                    aria-hidden="true"
                  >
                    {initials(author) || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {author}
                      </span>
                      <time
                        dateTime={note.timestamp}
                        className="flex-shrink-0 text-[10px] text-slate-400"
                      >
                        {fmtRelTime(note.timestamp)}
                      </time>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      {note.content}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

    </div>
  );
}

export const NotesTab = memo(NotesPanel);
