import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { CrmDashboardSnapshot, DashboardWidget } from '@bidstack/shared';

export function useCrmDashboard(accountId?: string) {
  return useQuery({
    queryKey: ['crm-dashboard', accountId ?? 'default'],
    queryFn: ({ signal }) => {
      const path = accountId
        ? `/api/crm/dashboard?account=${encodeURIComponent(accountId)}`
        : '/api/crm/dashboard';
      return api<CrmDashboardSnapshot>(path, { signal });
    },
  });
}

export function useSaveDashboardWidgets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (widgets: DashboardWidget[]) =>
      api<{ widgets: DashboardWidget[] }>('/api/crm/widgets', {
        method: 'PATCH',
        body: { widgets },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
    },
  });
}
