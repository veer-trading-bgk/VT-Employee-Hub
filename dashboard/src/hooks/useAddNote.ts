'use client';

import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

/**
 * Single shared owner of the internal-note write path — POST
 * /api/whatsapp/inbox/:leadId/note, the one real notes endpoint (writes
 * NOTE#<timestamp> under LEAD#<companyId>#<leadId>). Every surface that lets
 * an agent add a note (Customer 360 Notes tab, Inbox sidebar) should call
 * this instead of hand-rolling another mutation against another URL —
 * that's how the C360 Notes tab ended up posting to a crm.js route that
 * never existed.
 *
 * Notes are lead-scoped only — there is no unknown-contact (phone-only)
 * notes endpoint yet, so callers should guard on `leadId` being defined.
 */
export function useAddNote(leadId: string | undefined, onSuccess: () => void) {
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch(`/api/whatsapp/inbox/${leadId}/note`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    onSuccess,
    onError: () => toast.error('Failed to save note'),
  });
}
