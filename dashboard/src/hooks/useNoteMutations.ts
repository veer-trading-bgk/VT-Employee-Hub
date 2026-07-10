'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';

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

export interface InternalNoteItem {
  SK: string;
  content: string;
  authorId?: string;
  authorName?: string;
  timestamp: string;
  editedAt?: string;
}

interface WaConvNotesShape {
  internalNotes?: InternalNoteItem[];
  [key: string]: unknown;
}

// Track A5 Fix 2 (2026-07-10, docs/phase3/TECHNICAL_DEBT.md): the "did my
// note actually save?" report traced to no optimistic UI update — the POST
// used to return only {success, timestamp}, so the only way a new note
// appeared was an invalidateQueries()-triggered refetch landing sometime
// after the "Note saved" toast already fired. Same shape as this file's
// sibling mutations (inbox/page.tsx's sendMutation onMutate/onError
// against the same ['wa-conv', X] cache) — optimistic append in onMutate,
// snapshot+rollback in onError, precise reconcile (swap the temp
// placeholder for the real object the server returns) in onSuccess, so
// there's no unnecessary extra round-trip once we already have the
// authoritative note back.
export function useAddNote(leadId: string | undefined, onAdded: () => void) {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (content: string) =>
      apiFetch<{ success: boolean; timestamp: string; note: InternalNoteItem }>(`/api/whatsapp/inbox/${leadId}/note`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    onMutate: async (content: string) => {
      const queryKey = ['wa-conv', leadId];
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<WaConvNotesShape>(queryKey);
      const tempSK = `NOTE#optimistic-${Date.now()}`;
      const optimisticNote: InternalNoteItem = {
        SK: tempSK,
        content,
        authorId: user?.id,
        authorName: user?.name,
        timestamp: new Date().toISOString(),
      };
      qc.setQueryData<WaConvNotesShape>(queryKey, (old) => ({
        ...old,
        internalNotes: [...(old?.internalNotes ?? []), optimisticNote],
      }));
      return { previous, tempSK, queryKey };
    },
    onError: (_err, _content, context) => {
      if (context) qc.setQueryData(context.queryKey, context.previous);
      toast.error('Failed to save note');
    },
    onSuccess: (res, _content, context) => {
      if (context) {
        // Swap the optimistic placeholder for the real object (real SK,
        // real authorName if it ever differs) instead of leaving the temp
        // one in the cache or invalidating for a second round-trip.
        qc.setQueryData<WaConvNotesShape>(context.queryKey, (old) => ({
          ...old,
          internalNotes: (old?.internalNotes ?? []).map((n) => (n.SK === context.tempSK ? res.note : n)),
        }));
      }
      onAdded();
    },
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
