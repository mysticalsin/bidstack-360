/**
 * React Query hooks for Custom Objects (Wave 7).
 *
 * Hook naming follows the existing pattern (useOpportunities, useTasks etc.).
 * All mutations invalidate relevant query keys so the UI stays fresh.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  CustomObjectDef,
  CustomObjectDefCreate,
  CustomObjectDefList,
  CustomObjectDefPatch,
  CustomObjectFieldCreate,
  CustomObjectFieldList,
  CustomObjectRecord,
  CustomObjectRecordCreate,
  CustomObjectRecordPage,
  CustomObjectRecordPatch,
  CustomObjectRelationCreate,
  CustomObjectRelationList,
} from '@bidstack/shared';

// ─── Definitions ───────────────────────────────────────────────────────────

export function useCustomObjectDefs() {
  return useQuery({
    queryKey: ['custom-objects'],
    queryFn: ({ signal }) => api<CustomObjectDefList>('/api/custom-objects', { signal }),
    staleTime: 30_000,
  });
}

export function useCustomObjectDef(id: string) {
  return useQuery({
    queryKey: ['custom-objects', id],
    queryFn: ({ signal }) => api<CustomObjectDef>(`/api/custom-objects/${id}`, { signal }),
    enabled: !!id,
  });
}

export function useCreateCustomObjectDef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomObjectDefCreate) =>
      api<CustomObjectDef>('/api/custom-objects', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-objects'] });
    },
  });
}

export function useUpdateCustomObjectDef(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomObjectDefPatch) =>
      api<CustomObjectDef>(`/api/custom-objects/${id}`, {
        method: 'PUT',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-objects'] });
    },
  });
}

export function useDeleteCustomObjectDef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<CustomObjectDef>(`/api/custom-objects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-objects'] });
    },
  });
}

// ─── Fields ────────────────────────────────────────────────────────────────

export function useCustomObjectFields(objectId: string) {
  return useQuery({
    queryKey: ['custom-objects', objectId, 'fields'],
    queryFn: ({ signal }) =>
      api<CustomObjectFieldList>(`/api/custom-objects/${objectId}/fields`, { signal }),
    enabled: !!objectId,
  });
}

export function useAddCustomObjectField(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomObjectFieldCreate) =>
      api(`/api/custom-objects/${objectId}/fields`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-objects', objectId, 'fields'] });
    },
  });
}

// ─── Relations ─────────────────────────────────────────────────────────────

export function useCustomObjectRelations(objectId: string) {
  return useQuery({
    queryKey: ['custom-objects', objectId, 'relations'],
    queryFn: ({ signal }) =>
      api<CustomObjectRelationList>(`/api/custom-objects/${objectId}/relations`, { signal }),
    enabled: !!objectId,
  });
}

export function useAddCustomObjectRelation(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomObjectRelationCreate) =>
      api<CustomObjectRelationList>(`/api/custom-objects/${objectId}/relations`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-objects', objectId, 'relations'] });
    },
  });
}

// ─── Records ───────────────────────────────────────────────────────────────

export interface RecordListFilter {
  page?: number;
  limit?: number;
  sort?: string;
  filter?: Record<string, unknown>;
}

export function useCustomObjectRecords(objectId: string, opts: RecordListFilter = {}) {
  return useQuery({
    queryKey: ['custom-objects', objectId, 'records', opts],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (opts.page) params.set('page', String(opts.page));
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.sort) params.set('sort', opts.sort);
      if (opts.filter && Object.keys(opts.filter).length > 0) {
        params.set('filter', JSON.stringify(opts.filter));
      }
      return api<CustomObjectRecordPage>(
        `/api/custom-objects/${objectId}/records?${params.toString()}`,
        { signal },
      );
    },
    enabled: !!objectId,
  });
}

export function useCustomObjectRecord(objectId: string, recordId: string) {
  return useQuery({
    queryKey: ['custom-objects', objectId, 'records', recordId],
    queryFn: ({ signal }) =>
      api<CustomObjectRecord>(`/api/custom-objects/${objectId}/records/${recordId}`, { signal }),
    enabled: !!objectId && !!recordId,
  });
}

export function useCreateCustomObjectRecord(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomObjectRecordCreate) =>
      api<CustomObjectRecord>(`/api/custom-objects/${objectId}/records`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-objects', objectId, 'records'] });
    },
  });
}

export function useUpdateCustomObjectRecord(objectId: string, recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomObjectRecordPatch) =>
      api<CustomObjectRecord>(`/api/custom-objects/${objectId}/records/${recordId}`, {
        method: 'PUT',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-objects', objectId, 'records'] });
      void qc.invalidateQueries({ queryKey: ['custom-objects', objectId, 'records', recordId] });
    },
  });
}

export function useDeleteCustomObjectRecord(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recordId: string) =>
      api<CustomObjectRecord>(`/api/custom-objects/${objectId}/records/${recordId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['custom-objects', objectId, 'records'] });
    },
  });
}
