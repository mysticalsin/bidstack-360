/**
 * React Query hooks for Document Templates.
 *
 * WHY: Centralizes all template data-fetching in one place so pages
 * (list + editor) share invalidation keys and stay in sync.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { api } from '@/lib/api';
import type {
  DocumentTemplate,
  DocumentTemplatePage,
  DocumentTemplateCreate,
  DocumentTemplatePatch,
  DocumentTemplateVersion,
  TemplateKind,
} from '@bidstack/shared';

const TEMPLATES_KEY = 'document-templates';
const VERSIONS_KEY = 'document-template-versions';

// ─── List ─────────────────────────────────────────────────────────────────────

interface TemplateFilter {
  kind?: TemplateKind;
  search?: string;
  cursor?: string;
  limit?: number;
}

export function useDocumentTemplates(filter: TemplateFilter = {}) {
  return useQuery<DocumentTemplatePage>({
    queryKey: [TEMPLATES_KEY, filter],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filter.kind) params.set('kind', filter.kind);
      if (filter.search) params.set('search', filter.search);
      if (filter.cursor) params.set('cursor', filter.cursor);
      if (filter.limit) params.set('limit', String(filter.limit));
      const qs = params.toString();
      return api<DocumentTemplatePage>(`/api/document-templates${qs ? `?${qs}` : ''}`, { signal });
    },
  });
}

// ─── Single ───────────────────────────────────────────────────────────────────

export function useDocumentTemplate(id: string) {
  return useQuery<DocumentTemplate>({
    queryKey: [TEMPLATES_KEY, id],
    queryFn: ({ signal }) =>
      api<DocumentTemplate>(`/api/document-templates/${id}`, { signal }),
    enabled: Boolean(id) && id !== 'new',
  });
}

// ─── Version history ──────────────────────────────────────────────────────────

export function useDocumentTemplateVersions(templateId: string) {
  return useQuery<DocumentTemplateVersion[]>({
    queryKey: [VERSIONS_KEY, templateId],
    queryFn: ({ signal }) =>
      api<DocumentTemplateVersion[]>(`/api/document-templates/${templateId}/versions`, { signal }),
    enabled: Boolean(templateId) && templateId !== 'new',
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function useCreateDocumentTemplate() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return useMutation({
    mutationFn: (body: DocumentTemplateCreate) =>
      api<DocumentTemplate>('/api/document-templates', { method: 'POST', body }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [TEMPLATES_KEY] });
      nav(`/settings/document-templates/${data.id}/edit`);
    },
  });
}

// ─── Update (save new version) ────────────────────────────────────────────────

export function useUpdateDocumentTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DocumentTemplatePatch) =>
      api<DocumentTemplate>(`/api/document-templates/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TEMPLATES_KEY, id] });
      qc.invalidateQueries({ queryKey: [TEMPLATES_KEY] });
      qc.invalidateQueries({ queryKey: [VERSIONS_KEY, id] });
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function useDeleteDocumentTemplate() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/document-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TEMPLATES_KEY] });
      nav('/settings/document-templates');
    },
  });
}
