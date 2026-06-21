import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

// Optimistic patch — fans across every cached `['contacts', …]` query so
// inline edits to influence / sentiment / role land instantly on any list
// that has the contact.
export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ContactPatch }) =>
      api<Contact>(`/api/contacts/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['contacts'] });
      const snapshots: Array<readonly [readonly unknown[], ContactsPayload | undefined]> = [];
      qc.getQueriesData<ContactsPayload>({ queryKey: ['contacts'] }).forEach(([key, value]) => {
        snapshots.push([key, value]);
        if (!value) return;
        const { customFieldValues: _cf, ...rest } = patch as Record<string, unknown>;
        qc.setQueryData<ContactsPayload>(key, {
          ...value,
          items: value.items.map((c) => (c.id === id ? { ...c, ...rest } : c)),
        });
      });
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, value]) => qc.setQueryData(key, value));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['contacts'] }),
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
