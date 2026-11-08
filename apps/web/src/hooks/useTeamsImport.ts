import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  TeamsAccess,
  TeamsChatList,
  TeamsImportRequest,
  TeamsImportResult,
  TeamsSyncLinks,
  TeamsThreadMessages,
  TeamsThreadRef,
} from '@bidstack/shared';

import { ApiError, api } from '@/lib/api';

const BASE = '/api/integrations/teams';

/** The 409 code the API sends when Teams cannot be read; null for any other failure. */
export function teamsAccessCode(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const code = (err.body as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

export function teamsRefQuery(ref: TeamsThreadRef): string {
  const params = new URLSearchParams(
    ref.kind === 'chat'
      ? { kind: 'chat', chatId: ref.chatId }
      : { kind: 'channel_thread', teamId: ref.teamId, channelId: ref.channelId, messageId: ref.messageId },
  );
  return params.toString();
}

export function teamsRefKey(ref: TeamsThreadRef): string {
  return ref.kind === 'chat' ? `chat:${ref.chatId}` : `channel:${ref.teamId}:${ref.channelId}:${ref.messageId}`;
}

/** No retry on a consent problem: the prompt is the answer. */
const retry = (count: number, err: unknown) => teamsAccessCode(err) === null && count < 2;

export function useTeamsAccess(enabled: boolean) {
  return useQuery<TeamsAccess>({
    queryKey: ['teams-access'],
    queryFn: () => api(`${BASE}/access`),
    enabled,
    staleTime: 30_000,
  });
}

export function useTeamsChats(enabled: boolean) {
  return useQuery<TeamsChatList>({
    queryKey: ['teams-chats'],
    queryFn: () => api(`${BASE}/chats`),
    enabled,
    retry,
    staleTime: 30_000,
  });
}

type Named = { items: Array<{ id: string; displayName: string }> };

export function useTeamsTeams(enabled: boolean) {
  return useQuery<Named>({
    queryKey: ['teams-teams'],
    queryFn: () => api(`${BASE}/teams`),
    enabled,
    retry,
    staleTime: 5 * 60_000,
  });
}

export function useTeamsChannels(teamId: string | null) {
  return useQuery<Named>({
    queryKey: ['teams-channels', teamId],
    queryFn: () => api(`${BASE}/teams/${encodeURIComponent(teamId ?? '')}/channels`),
    enabled: Boolean(teamId),
    retry,
    staleTime: 5 * 60_000,
  });
}

export function useTeamsChannelThreads(teamId: string | null, channelId: string | null) {
  return useQuery<TeamsChatList>({
    queryKey: ['teams-threads', teamId, channelId],
    queryFn: () =>
      api(
        `${BASE}/teams/${encodeURIComponent(teamId ?? '')}/channels/${encodeURIComponent(channelId ?? '')}/threads`,
      ),
    enabled: Boolean(teamId && channelId),
    retry,
    staleTime: 30_000,
  });
}

export function useTeamsMessages(ref: TeamsThreadRef | null) {
  return useQuery<TeamsThreadMessages>({
    queryKey: ['teams-messages', ref ? teamsRefKey(ref) : null],
    queryFn: () => api(`${BASE}/messages?${teamsRefQuery(ref!)}`),
    enabled: Boolean(ref),
    retry,
    staleTime: 15_000,
  });
}

export function useTeamsLinks(companyId: string, enabled: boolean) {
  return useQuery<TeamsSyncLinks>({
    queryKey: ['teams-links', companyId],
    queryFn: () => api(`${BASE}/links?companyId=${encodeURIComponent(companyId)}`),
    enabled,
    staleTime: 30_000,
  });
}

export function useConnectTeams() {
  return useMutation({
    mutationFn: () => api<{ authUrl: string }>(`${BASE}/connect`, { method: 'POST' }),
    onSuccess: (res) => {
      if (res?.authUrl) window.location.assign(res.authUrl);
    },
  });
}

export function useImportTeams(companyId: string) {
  const qc = useQueryClient();
  return useMutation<TeamsImportResult, unknown, Omit<TeamsImportRequest, 'keepSyncing'> & { keepSyncing: boolean }>({
    mutationFn: (body) => api(`${BASE}/import`, { method: 'POST', body }),
    onSuccess: (_res, body) => {
      void qc.invalidateQueries({ queryKey: ['account-conversations', companyId] });
      void qc.invalidateQueries({ queryKey: ['company-activity-summary', companyId] });
      void qc.invalidateQueries({ queryKey: ['account-conversations', body.companyId] });
      void qc.invalidateQueries({ queryKey: ['teams-messages'] });
      void qc.invalidateQueries({ queryKey: ['teams-links'] });
      void qc.invalidateQueries({ queryKey: ['teams-chats'] });
    },
  });
}

export function useSetTeamsLink(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; keepSyncing: boolean }) =>
      api(`${BASE}/links/${input.id}`, { method: 'PATCH', body: { keepSyncing: input.keepSyncing } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['teams-links', companyId] });
      void qc.invalidateQueries({ queryKey: ['teams-chats'] });
    },
  });
}
