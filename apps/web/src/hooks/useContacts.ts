import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import type { Contact, ContactCreate, ContactPatch } from '@bidstack/shared';

interface ContactsParams {
  customer?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

// Cursor-paginated envelope. nextCursor is the opaque token for the next page
// (null when there are no more rows). The backend already returns this; the
// client previously dropped it, silently capping the list at the default 50.
type ContactsPayload = { items: Contact[]; nextCursor: string | null };

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: ['contact', id],
    queryFn: ({ signal }) => api<Contact>(`/api/contacts/${id}`, { signal }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useContacts(params: ContactsParams = {}) {
  return useQuery({
    queryKey: ['contacts', params],
    queryFn: ({ signal }) => {
      const usp = new URLSearchParams();
      if (params.customer) usp.set('customer', params.customer);
      if (params.search) usp.set('search', params.search);
      if (params.cursor) usp.set('cursor', params.cursor);
      if (params.limit) usp.set('limit', String(params.limit));
      const path = `/api/contacts${usp.toString() ? `?${usp.toString()}` : ''}`;
      return api<ContactsPayload>(path, { signal });
    },
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContactCreate) =>
      api<Contact>('/api/contacts', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

// Optimistic patch. The list key is ['contacts', …]. The record is
// ['contact', id]. A prefix match does not cross those, so a saved phone
// would stay on the row while the open record kept dialing the number it
// loaded. Patch both, and roll both back together.
export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ContactPatch }) =>
      api<Contact>(`/api/contacts/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['contacts'] }),
        qc.cancelQueries({ queryKey: ['contact', id] }),
      ]);
      const { customFieldValues: _cf, ...rest } = patch as Record<string, unknown>;
      const snapshots: Array<readonly [readonly unknown[], ContactsPayload | undefined]> = [];
      qc.getQueriesData<ContactsPayload>({ queryKey: ['contacts'] }).forEach(([key, value]) => {
        snapshots.push([key, value]);
        if (!value) return;
        qc.setQueryData<ContactsPayload>(key, {
          ...value,
          items: value.items.map((c) => (c.id === id ? { ...c, ...rest } : c)),
        });
      });
      const detailKey = ['contact', id] as const;
      const detailSnap = qc.getQueryData<Contact>(detailKey);
      if (detailSnap) {
        qc.setQueryData<Contact>(detailKey, { ...detailSnap, ...rest });
      }
      return { snapshots, detailKey, detailSnap };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, value]) => qc.setQueryData(key, value));
      if (ctx?.detailSnap) qc.setQueryData(ctx.detailKey, ctx.detailSnap);
      toast.error(err instanceof Error ? err.message : 'Could not update contact');
    },
    onSettled: (_data, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      void qc.invalidateQueries({ queryKey: ['contact', id] });
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/api/contacts/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['contacts'] });
      const snapshots: Array<readonly [readonly unknown[], ContactsPayload | undefined]> = [];
      qc.getQueriesData<ContactsPayload>({ queryKey: ['contacts'] }).forEach(([key, value]) => {
        snapshots.push([key, value]);
        if (!value) return;
        qc.setQueryData<ContactsPayload>(key, {
          ...value,
          items: value.items.filter((c) => c.id !== id),
        });
      });
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, value]) => qc.setQueryData(key, value));
    },
    onSettled: (_data, _err, id) => {
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      // Drop the deleted contact's detail cache so an open ContactDetailPage
      // refetches (and 404s) instead of showing a stale record.
      qc.removeQueries({ queryKey: ['contact', id] });
    },
  });
}
