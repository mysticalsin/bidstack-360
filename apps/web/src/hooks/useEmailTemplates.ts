import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type {
  EmailTemplate,
  EmailTemplateCreate,
  EmailTemplateList,
  EmailTemplatePatch,
  EmailTemplateRenderRequest,
  EmailTemplateRenderResponse,
} from '@bidstack/shared';

const KEY = 'email-templates';

export function useEmailTemplates(opts: { includeArchived?: boolean; enabled?: boolean } = {}) {
  return useQuery<EmailTemplateList>({
    queryKey: [KEY, { includeArchived: opts.includeArchived ?? false }],
    queryFn: ({ signal }) => {
      const qs = opts.includeArchived ? '?includeArchived=true' : '';
      return api<EmailTemplateList>(`/api/email-templates${qs}`, { signal });
    },
    enabled: opts.enabled ?? true,
  });
}

export function useCreateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EmailTemplateCreate) =>
      api<EmailTemplate>('/api/email-templates', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: EmailTemplatePatch }) =>
      api<EmailTemplate>(`/api/email-templates/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/email-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
    // EmailTemplatesSection.remove() has no catch of its own — without this
    // the delete silently no-ops on a rejected mutation.
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not delete template'),
  });
}

export function useRenderEmailTemplate() {
  return useMutation({
    mutationFn: (body: EmailTemplateRenderRequest) =>
      api<EmailTemplateRenderResponse>('/api/email-templates/render', { method: 'POST', body }),
  });
}
