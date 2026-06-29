// React Query hooks for the Tag entity + EntityTag join. Mirrors the
// useLeads / useOpportunities patterns: one keyspace per concept, optimistic
// invalidations on mutate.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  Tag,
  TagApply,
  TagCreate,
  TagPatch,
  TagList,
  EntityTagsResponse,
  TagSuggestRequest,
  TagSuggestResponse,
  TaggableEntityType,
} from '@bidstack/shared';

const TAGS_KEY = 'tags';
const ENTITY_TAGS_KEY = 'entity-tags';

export function useTags(search?: string, options: { enabled?: boolean } = {}) {
  return useQuery<TagList>({
    queryKey: [TAGS_KEY, { search: search ?? '' }],
    queryFn: ({ signal }) => {
      const qs = search ? `?search=${encodeURIComponent(search)}` : '';
      return api<TagList>(`/api/tags${qs}`, { signal });
    },
    enabled: options.enabled ?? true,
  });
}

export function useEntityTags(entityType: TaggableEntityType | null, entityId: string | null) {
  return useQuery<EntityTagsResponse>({
    queryKey: [ENTITY_TAGS_KEY, entityType, entityId],
    queryFn: ({ signal }) =>
      api<EntityTagsResponse>(`/api/tags/entity/${entityType}/${entityId}`, { signal }),
    enabled: Boolean(entityType && entityId),
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TagCreate) => api<Tag>('/api/tags', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [TAGS_KEY] }),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TagPatch }) =>
      api<Tag>(`/api/tags/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TAGS_KEY] });
      qc.invalidateQueries({ queryKey: [ENTITY_TAGS_KEY] });
    },
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/tags/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TAGS_KEY] });
      qc.invalidateQueries({ queryKey: [ENTITY_TAGS_KEY] });
    },
  });
}

export function useApplyTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TagApply) =>
      api<EntityTagsResponse>('/api/tags/apply', { method: 'POST', body }),
    onSuccess: (data) => {
      qc.setQueryData([ENTITY_TAGS_KEY, data.entityType, data.entityId], data);
      qc.invalidateQueries({ queryKey: [TAGS_KEY] });
    },
  });
}

export function useRemoveTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TagApply) =>
      api<EntityTagsResponse>('/api/tags/remove', { method: 'POST', body }),
    onSuccess: (data) => {
      qc.setQueryData([ENTITY_TAGS_KEY, data.entityType, data.entityId], data);
      qc.invalidateQueries({ queryKey: [TAGS_KEY] });
    },
  });
}

export function useTagSuggestions() {
  return useMutation({
    mutationFn: (body: TagSuggestRequest) =>
      api<TagSuggestResponse>('/api/tags/suggest', { method: 'POST', body }),
  });
}
