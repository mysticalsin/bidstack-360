import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type {
  CustomFieldDefinition,
  CustomFieldDefinitionCreate,
  CustomFieldDefinitionList,
  CustomFieldDefinitionPatch,
  CustomFieldValueBulkUpsert,
  CustomFieldValueList,
  EntityType,
} from '@bidstack/shared';

// ── Definitions ──────────────────────────────────────────────────────────

export function useCustomFieldDefinitions(entityType: EntityType | undefined) {
  return useQuery({
    enabled: !!entityType,
    queryKey: ['custom-field-definitions', entityType],
    queryFn: ({ signal }) =>
      api<CustomFieldDefinitionList>(`/api/custom-fields/definitions?entityType=${entityType}`, {
        signal,
      }),
  });
}

export function useCreateCustomFieldDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomFieldDefinitionCreate) =>
      api<CustomFieldDefinition>('/api/custom-fields/definitions', {
        method: 'POST',
        body,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['custom-field-definitions', vars.entityType],
      });
    },
  });
}

export function usePatchCustomFieldDefinition(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      body,
      entityType: _entityType,
    }: {
      body: CustomFieldDefinitionPatch;
      entityType: EntityType;
    }) => {
      if (!id) throw new Error('Definition id required');
      return api<CustomFieldDefinition>(`/api/custom-fields/definitions/${id}`, {
        method: 'PATCH',
        body,
      });
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['custom-field-definitions', vars.entityType],
      });
    },
  });
}

export function useDeleteCustomFieldDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, entityType: _entityType }: { id: string; entityType: EntityType }) =>
      api<CustomFieldDefinition>(`/api/custom-fields/definitions/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['custom-field-definitions', vars.entityType],
      });
    },
  });
}

// ── Values ───────────────────────────────────────────────────────────────

export function useCustomFieldValues(
  entityType: EntityType | undefined,
  entityId: string | undefined,
) {
  return useQuery({
    enabled: !!entityType && !!entityId,
    queryKey: ['custom-field-values', entityType, entityId],
    queryFn: ({ signal }) =>
      api<CustomFieldValueList>(
        `/api/custom-fields/values?entityType=${entityType}&entityId=${entityId}`,
        { signal },
      ),
  });
}

export function useCustomFieldValuesBulk(entityType: EntityType | undefined, entityIds: string[]) {
  const key = entityIds.sort().join(',');
  return useQuery({
    enabled: !!entityType && entityIds.length > 0,
    queryKey: ['custom-field-values-bulk', entityType, key],
    queryFn: ({ signal }) =>
      api<CustomFieldValueList>(
        `/api/custom-fields/values/bulk?entityType=${entityType}&entityIds=${key}`,
        { signal },
      ),
  });
}

export function useUpsertCustomFieldValues() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomFieldValueBulkUpsert) =>
      api<CustomFieldValueList>('/api/custom-fields/values', {
        method: 'PATCH',
        body,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['custom-field-values', vars.entityType, vars.entityId],
      });
      void qc.invalidateQueries({
        queryKey: ['custom-field-values-bulk', vars.entityType],
      });
    },
  });
}
