'use client';

import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

/**
 * Single shared owner of the internal-note write paths — POST/PUT/DELETE
 * /api/whatsapp/inbox/:leadId/note[/:timestamp], the one real notes endpoint
 * (NOTE#<timestamp> items under LEAD#<companyId>#<leadId>). Every surface that
 * lets an agent add, edit, or delete a note (Customer 360 Notes tab, Inbox
 * sidebar, Conversation tab's note toggle) should call these instead of
 * hand-rolling another mutation against another URL — that's how the C360
 * Notes tab ended up posting to a crm.js route that never existed.
 *
 * Notes are lead-scoped only — there is no unknown-contact (phone-only)
 * notes endpoint yet, so callers should guard on `leadId` being defined.
 * Edit/delete are authorized server-side (author or admin/manager/superadmin
 * only) — callers should also hide the affordance client-side to avoid a
 * surprising 403, but must not rely on the client check alone.
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

export function useEditNote(leadId: string | undefined, onSuccess: () => void) {
  return useMutation({
    mutationFn: ({ timestamp, content }: { timestamp: string; content: string }) =>
      apiFetch(`/api/whatsapp/inbox/${leadId}/note/${encodeURIComponent(timestamp)}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      }),
    onSuccess,
    onError: () => toast.error('Failed to update note'),
  });
}

export function useDeleteNote(leadId: string | undefined, onSuccess: () => void) {
  return useMutation({
    mutationFn: (timestamp: string) =>
      apiFetch(`/api/whatsapp/inbox/${leadId}/note/${encodeURIComponent(timestamp)}`, {
        method: 'DELETE',
      }),
    onSuccess,
    onError: () => toast.error('Failed to delete note'),
  });
}

/** True if the given user may edit/delete this note — mirrors the backend's canModifyNote check. */
export function canModifyNote(note: { authorId?: string }, user: { id?: string; role?: string } | null | undefined): boolean {
  if (!user) return false;
  return note.authorId === user.id || ['admin', 'manager', 'superadmin'].includes(user.role ?? '');
}
