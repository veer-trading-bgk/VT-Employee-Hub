'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus, BookOpen } from 'lucide-react';
import { Button } from '@/components/v3/ui/Button';
import { Input } from '@/components/v3/ui/Input';
import { Badge } from '@/components/v3/ui/Badge';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { knowledgeKeys, fetchKnowledgeEntries, type KnowledgeEntry } from '@/lib/knowledge/api';
import { KnowledgeEntryDrawer } from './KnowledgeEntryDrawer';

function statusBadge(entry: KnowledgeEntry) {
  if (entry.archived) return <Badge variant="default">Archived</Badge>;
  if (entry.activeVersion > 0) return <Badge variant="primary">Published v{entry.activeVersion}</Badge>;
  return <Badge variant="warning">Draft</Badge>;
}

export function KnowledgeList() {
  const { data, isLoading } = useQuery({ queryKey: knowledgeKeys.list(), queryFn: fetchKnowledgeEntries });
  const [search, setSearch] = useState('');
  const [drawerEntry, setDrawerEntry] = useState<KnowledgeEntry | null | undefined>(undefined); // undefined = closed

  const filtered = useMemo(() => {
    const entries = data?.entries ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => (
      e.draftQuestion.toLowerCase().includes(q)
      || (e.category ?? '').toLowerCase().includes(q)
      || e.draftTriggers.some((t) => t.includes(q))
    ));
  }, [data, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by question, category, or trigger…"
            className="pl-9"
          />
        </div>
        <Button iconLeft={<Plus className="h-4 w-4" />} onClick={() => setDrawerEntry(null)}>
          New entry
        </Button>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <BookOpen className="h-8 w-8 text-neutral-300" />
            <p className="text-sm text-neutral-500">
              {data?.entries.length ? 'No entries match your search.' : 'No knowledge entries yet — create your first one.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {filtered.map((entry) => (
              <li key={entry.entryId}>
                <button
                  onClick={() => setDrawerEntry(entry)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{entry.draftQuestion}</p>
                    <p className="mt-0.5 truncate text-xs text-neutral-500">
                      {entry.draftTriggers.join(', ')}
                      {entry.category && <span className="ml-2 text-neutral-400">· {entry.category}</span>}
                    </p>
                  </div>
                  <div className="shrink-0">{statusBadge(entry)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <KnowledgeEntryDrawer
        open={drawerEntry !== undefined}
        onClose={() => setDrawerEntry(undefined)}
        entry={drawerEntry ?? null}
      />
    </div>
  );
}
