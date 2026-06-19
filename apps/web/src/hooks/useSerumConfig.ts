import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  SerumConfigDraftUpsert,
  SerumConfigApprovalDecision,
  SerumConfigApprovalRequest,
  SerumConfigPublishRequest,
  SerumConfigRollbackRequest,
  SerumConfigSnapshot,
  SerumConfigTestRequest,
  SerumConfigTestResult,
  SerumConfigType,
  SerumConfigVersion,
} from '@bidstack/shared';

import { api } from '@/lib/api';

const KEY = 'serum-config';

export function serumConfigQueryKey(configType: SerumConfigType, configKey: string, environment = 'dev') {
  return [KEY, configType, configKey, environment] as const;
}

export function useSerumConfig(
  configType: SerumConfigType,
  configKey: string,
  environment = 'dev',
) {
  return useQuery<SerumConfigSnapshot>({
    queryKey: serumConfigQueryKey(configType, configKey, environment),
    queryFn: ({ signal }) =>
      api<SerumConfigSnapshot>(
        `/api/serum/configs/${configType}/${configKey}?environment=${environment}`,
        { signal },
      ),
  });
}

export function useSaveSerumConfigDraft(configType: SerumConfigType, configKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SerumConfigDraftUpsert) =>
      api<SerumConfigVersion>(`/api/serum/configs/${configType}/${configKey}/draft`, {
        method: 'POST',
        body,
      }),
    onSuccess: (version) =>
      void qc.invalidateQueries({
        queryKey: serumConfigQueryKey(configType, configKey, version.environment),
      }),
  });
}

export function useTestSerumConfig(configType: SerumConfigType, configKey: string) {
  return useMutation({
    mutationFn: (body: SerumConfigTestRequest) =>
      api<SerumConfigTestResult>(`/api/serum/configs/${configType}/${configKey}/test`, {
        method: 'POST',
        body,
      }),
  });
}

export function usePublishSerumConfigVersion(configType: SerumConfigType, configKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: SerumConfigPublishRequest }) =>
      api<SerumConfigVersion>(`/api/serum/configs/${id}/publish`, {
        method: 'POST',
        body: body ?? {},
      }),
    onSuccess: (version) =>
      void qc.invalidateQueries({
        queryKey: serumConfigQueryKey(configType, configKey, version.environment),
      }),
  });
}

export function useRequestSerumConfigApproval(configType: SerumConfigType, configKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SerumConfigApprovalRequest }) =>
      api<SerumConfigVersion>(`/api/serum/configs/${id}/request-approval`, {
        method: 'POST',
        body,
      }),
    onSuccess: (version) =>
      void qc.invalidateQueries({
        queryKey: serumConfigQueryKey(configType, configKey, version.environment),
      }),
  });
}

export function useApproveSerumConfigVersion(configType: SerumConfigType, configKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SerumConfigApprovalDecision }) =>
      api<SerumConfigVersion>(`/api/serum/configs/${id}/approve`, {
        method: 'POST',
        body,
      }),
    onSuccess: (version) =>
      void qc.invalidateQueries({
        queryKey: serumConfigQueryKey(configType, configKey, version.environment),
      }),
  });
}

export function useRollbackSerumConfigVersion(configType: SerumConfigType, configKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SerumConfigRollbackRequest }) =>
      api<SerumConfigVersion>(`/api/serum/configs/${id}/rollback`, {
        method: 'POST',
        body,
      }),
    onSuccess: (version) =>
      void qc.invalidateQueries({
        queryKey: serumConfigQueryKey(configType, configKey, version.environment),
      }),
  });
}
