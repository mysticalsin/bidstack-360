import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { AuditLogFilter, AuditLogPage } from '@bidstack/shared';

export function useAuditLogs(filter: Partial<AuditLogFilter> = {}) {
  return useQuery({
    queryKey: ['audit-logs', filter],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filter)) {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, String(v));
        }
      }
      return api<AuditLogPage>(`/api/audit-logs?${params.toString()}`, { signal });
    },
  });
}
