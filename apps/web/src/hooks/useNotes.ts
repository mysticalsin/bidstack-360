// React Query hooks for the /api/notes endpoint.
// Each mutation invalidates the per-account list on success so the cockpit
// panel re-renders without a manual refetch. Update + delete use optimistic
// mutations so pin toggles and removals feel instant — the round-trip
// settles into a cache reconciliation afterwards.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  MeetingNotesImportRequest,
  MeetingNotesImportResponse,
  Note,
  NoteCreate,
  NotePatch,
} from '@bidstack/shared';

const notesKey = (accountId: string) => ['notes', accountId] as const;

// Same order as GET /api/notes: pinned notes first, then newest createdAt.
// Optimistic pin and create land in the cache before the refetch, so the
// panel and the cache write have to share this comparator or a saved note
// jumps when the refetch arrives.
export function orderNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

function insertNote(current: { items: Note[] } | undefined, created: Note): { items: Note[] } {
  const items = current?.items ?? [];
  return {
    ...(current ?? {}),
    items: orderNotes([created, ...items.filter((note) => note.id !== created.id)]),
  };
}

export function useNotes(accountId: string | undefined) {
  return useQuery({
    queryKey: notesKey(accountId ?? ''),
    // Only fetch when an accountId is available — the cockpit may render
    // briefly before route params resolve.
    enabled: Boolean(accountId),
    queryFn: ({ signal }) =>
      api<{ items: Note[] }>(`/api/notes?accountId=${encodeURIComponent(accountId!)}`, {
        signal,
      }),
  });
}

export function useCreateNote(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<NoteCreate, 'accountId'>) => {
      if (!accountId) throw new Error('Select an account before adding a note.');
      return api<Note>('/api/notes', {
        method: 'POST',
        body: { ...input, accountId },
      });
    },
    // Freeze the account that was current when Save was pressed. The panel
    // stays mounted across /accounts/:accountId, so a later render must not
    // file this note onto the account the user navigated to.
    onMutate: () => ({ accountId }),
    onSuccess: async (created, _input, ctx) => {
      const savedFor = ctx?.accountId;
      if (!savedFor) return;
      const key = notesKey(savedFor);
      // Drop an in-flight list fetch. If it resolves after this write it
      // still has the pre-save payload and would flash the empty state
      // over a note that just saved.
      await qc.cancelQueries({ queryKey: key });
      qc.setQueryData<{ items: Note[] }>(key, (current) => insertNote(current, created));
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useUpdateNote(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NotePatch }) =>
      api<Note>(`/api/notes/${id}`, { method: 'PATCH', body: patch }),
    // Optimistic: pin/unpin toggles especially benefit — clicking the star
    // should not feel like it round-trips.
    onMutate: async ({ id, patch }) => {
      if (!accountId) return undefined;
      const key = notesKey(accountId);
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<{ items: Note[] }>(key);
      if (snapshot) {
        qc.setQueryData<{ items: Note[] }>(key, {
          ...snapshot,
          items: orderNotes(snapshot.items.map((n) => (n.id === id ? { ...n, ...patch } : n))),
        });
      }
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot && accountId) qc.setQueryData(notesKey(accountId), ctx.snapshot);
    },
    onSettled: () => {
      if (accountId) void qc.invalidateQueries({ queryKey: notesKey(accountId) });
    },
  });
}

export function useDeleteNote(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/api/notes/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      if (!accountId) return undefined;
      const key = notesKey(accountId);
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<{ items: Note[] }>(key);
      if (snapshot) {
        qc.setQueryData<{ items: Note[] }>(key, {
          ...snapshot,
          items: snapshot.items.filter((n) => n.id !== id),
        });
      }
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot && accountId) qc.setQueryData(notesKey(accountId), ctx.snapshot);
    },
    onSettled: () => {
      if (accountId) void qc.invalidateQueries({ queryKey: notesKey(accountId) });
    },
  });
}

export function useImportMeetingNotes(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<MeetingNotesImportRequest, 'accountId'>) => {
      if (!accountId) throw new Error('Select an account before importing meeting notes.');
      return api<MeetingNotesImportResponse>('/api/notes/import-meeting', {
        method: 'POST',
        body: { ...input, accountId },
      });
    },
    onSuccess: () => {
      if (accountId) void qc.invalidateQueries({ queryKey: notesKey(accountId) });
      void qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['crm-company-lookup'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
