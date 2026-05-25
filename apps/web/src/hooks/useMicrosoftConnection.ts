import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  MicrosoftConnectionStatus,
  MicrosoftConnectRequest,
  MicrosoftDisconnectRequest,
} from '@bidstack/shared';

export function useMicrosoftConnection() {
  return useQuery<MicrosoftConnectionStatus>({
    queryKey: ['microsoft-connection'],
    queryFn: async () => {
      return api<MicrosoftConnectionStatus>('/api/settings/microsoft');
    },
  });
}

export function useMicrosoftConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MicrosoftConnectRequest) => {
      return api<{ authUrl: string }>('/api/settings/microsoft/connect', {
        method: 'POST',
        body,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['microsoft-connection'] });
    },
  });
}

export function useMicrosoftDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MicrosoftDisconnectRequest) => {
      await api('/api/settings/microsoft/disconnect', {
        method: 'POST',
        body,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['microsoft-connection'] });
    },
  });
}
