'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { Tag } from '@/components/tags/TagBadge';

/**
 * Shared company tag catalog — single React Query owner for ['tag-catalog'].
 * Use this everywhere instead of declaring the query inline.
 */
export function useTagCatalog() {
  const { data, isLoading } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () => apiFetch<{ success: boolean; tags: Tag[] }>('/api/tags'),
    staleTime: 5 * 60_000,
  });
  return { tags: data?.tags ?? [], isLoading };
}
