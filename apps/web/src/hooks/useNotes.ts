// React Query hooks for the /api/notes endpoint.
// Each mutation invalidates the per-account list on success so the cockpit
// panel re-renders without a manual refetch. Update + delete use optimistic
// mutations so pin toggles and removals feel instant — the round-trip
// settles into a cache reconciliation afterwards.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Note, NoteCreate, NotePatch } from '@bidstack/shared';

const notesKey = (accountId: string) => ['notes', accountId] as const;

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
    mutationFn: (input: Omit<NoteCreate, 'accountId'>) =>
      api<Note>('/api/notes', {
        method: 'POST',
        body: { ...input, accountId },
      }),
    onSuccess: () => {
      if (accountId) void qc.invalidateQueries({ queryKey: notesKey(accountId) });
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
          items: snapshot.items.map((n) => (n.id === id ? { ...n, ...patch } : n)),
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
