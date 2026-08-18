import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

import type { CrmCompany } from '@bidstack/shared';

// Wire to POST /api/crm/companies/:id/enrich. The route also fans out an
// Apollo BullMQ job, so the immediate response is the cached row and the
// `dust-poll` worker will overwrite it asynchronously when APOLLO_API_KEY
// is set. Invalidate the dashboard snapshot so the cockpit re-fetches.
interface EnrichBody {
  id: string;
  name: string;
  domain?: string;
  website?: string;
}

export function useEnrichCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: EnrichBody) =>
      api<CrmCompany>(`/api/crm/companies/${encodeURIComponent(id)}/enrich`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
    },
    // PageHead.handleEnrich only wires onSuccess — a rejected mutation left the
    // "Enrich now" button just stop spinning with no feedback.
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not enrich company'),
  });
}
