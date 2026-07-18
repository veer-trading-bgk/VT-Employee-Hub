'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { invalidateContactCaches } from '@/lib/contactCache';
import { useTagCatalog } from '@/hooks/useTagCatalog';
import { TagBadge, type Tag } from './TagBadge';
import { TagSelector } from './TagSelector';

interface ContactTagsProps {
  /** Current tag IDs on the contact (catalog IDs) */
  tagIds: string[];
  /** CRM lead id — preferred identity for tag writes */
  leadId?: string;
  /** Phone fallback for inbox-only contacts without a lead */
  phone?: string;
  canEdit?: boolean;
  /** Called after a successful add/remove so callers can invalidate their caches */
  onMutated?: () => void;
  emptyText?: string;
}

/**
 * Reusable contact tag display + editor.
 * Owns the /api/tags/contacts mutation and tag creation; resolves IDs
 * through the shared tag catalog. Callers provide their own section chrome.
 */
export function ContactTags({
  tagIds,
  leadId,
  phone,
  canEdit = true,
  onMutated,
  emptyText = 'No tags yet',
}: ContactTagsProps) {
  const qc = useQueryClient();
  const { tags: catalog, isLoading: catalogLoading } = useTagCatalog();
  const [open, setOpen] = useState(false);
  // Local mirror so badges update instantly; the server response is authoritative.
  // Re-sync during render when the prop changes (e.g. switching conversations).
  const [ids, setIds] = useState<string[]>(tagIds);
  const [prevKey, setPrevKey] = useState(tagIds.join(','));
  const key = tagIds.join(',');
  if (key !== prevKey) {
    setPrevKey(key);
    setIds(tagIds);
  }

  const resolved = ids
    .map((id) => catalog.find((t) => t.id === id))
    .filter((t): t is Tag => Boolean(t));

  const mutateTags = useMutation({
    mutationFn: ({ add, remove }: { add: string[]; remove: string[] }) =>
      apiFetch<{ success: boolean; tags: string[] }>('/api/tags/contacts', {
        method: 'PUT',
        body: JSON.stringify({ ...(leadId ? { leadId } : { phone }), add, remove }),
      }),
    onMutate: ({ add, remove }) => {
      setIds((prev) => [
        ...prev.filter((t) => !remove.includes(t)),
        ...add.filter((t) => !prev.includes(t)),
      ]);
    },
    onSuccess: (res) => {
      if (res.tags) setIds(res.tags);
      // Every caller (Contacts list, Inbox, Customer 360 header) rendered its
      // own tags from a different cache family and only invalidated that one
      // via onMutated — owning the full three-family sweep here means a new
      // caller never has to remember it. onMutated still fires afterward for
      // callers with a genuinely separate cache (e.g. Inbox's ['wa-inbox']).
      invalidateContactCaches(qc, leadId);
      onMutated?.();
    },
    onError: () => {
      setIds(tagIds);
      toast.error('Failed to update tags');
    },
  });

  const createTag = useMutation({
    mutationFn: ({ label, color }: { label: string; color: string }) =>
      apiFetch<{ success: boolean; tag: Tag }>('/api/tags', {
        method: 'POST',
        body: JSON.stringify({ label, color }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tag-catalog'] }),
    onError: () => toast.error('Failed to create tag'),
  });

  function toggle(tagId: string) {
    const selected = ids.includes(tagId);
    mutateTags.mutate({ add: selected ? [] : [tagId], remove: selected ? [tagId] : [] });
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1 min-h-[20px]">
        {resolved.map((tag) => (
          <TagBadge
            key={tag.id}
            tag={tag}
            onRemove={
              canEdit
                ? (e) => {
                    e.stopPropagation();
                    mutateTags.mutate({ add: [], remove: [tag.id] });
                  }
                : undefined
            }
          />
        ))}
        {resolved.length === 0 && !canEdit && (
          <span className="text-xs text-neutral-400">{emptyText}</span>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Add tag"
            className="flex items-center gap-1 rounded-full border border-dashed border-neutral-300 px-2 py-0.5 text-[10px] font-medium text-neutral-500 transition hover:border-primary-400 hover:text-primary-600 dark:border-neutral-600 dark:hover:border-primary-500"
          >
            <Plus className="h-3 w-3" aria-hidden />
            Add tag
          </button>
        )}
      </div>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1">
          <TagSelector
            catalogTags={catalog}
            selectedIds={ids}
            loading={catalogLoading}
            onToggle={toggle}
            onCreate={async (label, color) => {
              const res = await createTag.mutateAsync({ label, color });
              if (res.tag?.id) mutateTags.mutate({ add: [res.tag.id], remove: [] });
            }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
