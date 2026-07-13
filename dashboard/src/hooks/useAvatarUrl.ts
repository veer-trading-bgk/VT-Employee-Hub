'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

/**
 * Resolves a profile photo's S3 key into a displayable presigned GET URL —
 * same ['media-url', key] cache convention and GET /api/whatsapp/s3-url
 * endpoint Inbox's MediaBubble already uses for WhatsApp media (B3 finding
 * #11). Avatar keys share that route's uploads/{companyId}/... prefix, so
 * no new backend resolver was needed for display, only for upload.
 */
export function useAvatarUrl(avatarKey: string | null | undefined): string | undefined {
  const { data } = useQuery<string>({
    queryKey: ['media-url', avatarKey],
    queryFn: () => apiFetch<{ url: string }>(`/api/whatsapp/s3-url?key=${encodeURIComponent(avatarKey as string)}`).then((d) => d.url),
    enabled: !!avatarKey,
    staleTime: 50 * 60_000,
    retry: 2,
  });
  return data;
}
