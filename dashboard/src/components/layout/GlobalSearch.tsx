'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

interface Contact {
  id: string;
  leadId: string | null;
  displayName: string;
  name: string | null;
  phone: string;
  stage: string | null;
}

interface ContactsResponse {
  success: boolean;
  contacts: Contact[];
}

function avatar(c: Contact): string {
  const label = c.name ?? c.displayName ?? c.phone;
  return (label[0] ?? '?').toUpperCase();
}

export function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery]       = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const router    = useRouter();
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const trimmed = query.trim();
  const enabled = trimmed.length >= 2;

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', trimmed],
    queryFn: () =>
      apiFetch<ContactsResponse>(
        `/api/contacts?q=${encodeURIComponent(trimmed)}&pageSize=8`
      ),
    enabled,
    staleTime: 30_000,
  });

  const results = data?.contacts ?? [];

  function open(c: Contact) {
    if (c.leadId) {
      router.push(`/admin/contacts/${c.leadId}?from=search`);
    } else {
      router.push(`/admin/whatsapp?phone=${encodeURIComponent(c.phone)}`);
    }
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape')    { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[activeIdx]) { open(results[activeIdx]); }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label="Global search"
    >
      {/* Panel */}
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-slate-400" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search contacts by name or phone…"
            className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
            aria-label="Search"
            autoComplete="off"
          />
          {isFetching && (
            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          )}
          <kbd className="hidden rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-slate-700 sm:block">
            Esc
          </kbd>
        </div>

        {/* Results */}
        {enabled && (
          <div className="max-h-80 overflow-y-auto py-1">
            {results.length === 0 && !isFetching && (
              <p className="py-8 text-center text-sm text-slate-400">
                No results for &ldquo;{trimmed}&rdquo;
              </p>
            )}
            {results.map((c, i) => (
              <button
                key={c.id}
                onClick={() => open(c)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === activeIdx
                    ? 'bg-indigo-50 dark:bg-indigo-900/20'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                  {avatar(c)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                    {c.name ?? c.displayName ?? c.phone}
                  </p>
                  <p className="text-xs text-slate-400">{c.phone}</p>
                </div>
                {c.stage && (
                  <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {c.stage}
                  </span>
                )}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            ))}
          </div>
        )}

        {/* Prompt when query is empty */}
        {!enabled && (
          <div className="py-8 text-center">
            <p className="text-sm text-slate-400">Type at least 2 characters to search</p>
            <p className="mt-1 text-xs text-slate-300 dark:text-slate-600">
              Searches contacts and leads by name or phone
            </p>
          </div>
        )}

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-slate-50 px-4 py-2 dark:border-slate-800/50">
          <span className="text-[10px] text-slate-300 dark:text-slate-600">
            ↑↓ navigate &nbsp;·&nbsp; Enter open &nbsp;·&nbsp; Esc close
          </span>
        </div>
      </div>
    </div>
  );
}
