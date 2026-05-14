import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Contact, ContactCreate, ContactPatch } from '@bidstack/shared';

interface ContactsParams {
  customer?: string;
  search?: string;
}

// Each list query holds an `items` envelope so the API can append metadata
// later (counts, next-cursor) without a breaking type change.
type ContactsPayload = { items: Contact[] };

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
        qc.setQueryData<ContactsPayload>(key, {
          ...value,
          items: value.items.map((c) => (c.id === id ? { ...c, ...patch } : c)),
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
    onSettled: () => void qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}
