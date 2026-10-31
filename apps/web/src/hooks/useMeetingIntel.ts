import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api';
import { meetingClient, type MeetingCreate, type MeetingListQuery, type MeetingPatch } from '@/lib/meeting-intel/client';

const KEY = 'meeting-intel';
const noRetry404 = (n: number, err: unknown) => n < 2 && !(err instanceof ApiError && (err.status === 404 || err.status === 403));

export function useMeetingList(q: MeetingListQuery, enabled = true) {
  return useQuery({ queryKey: [KEY, 'list', q], queryFn: ({ signal }) => meetingClient.list(q, signal), enabled, retry: noRetry404 });
}
export function useMeeting(id: string | undefined) {
  return useQuery({ queryKey: [KEY, 'detail', id], queryFn: ({ signal }) => meetingClient.detail(id!, signal), enabled: Boolean(id), retry: noRetry404 });
}
/** Details for a handful of meetings (person drill). Capped by the caller. */
export function useMeetingDetails(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({ queryKey: [KEY, 'detail', id], queryFn: ({ signal }: { signal: AbortSignal }) => meetingClient.detail(id, signal), retry: noRetry404 })),
  });
}
export function useCoverage(groupId: string | undefined, windowDays = 365) {
  return useQuery({ queryKey: [KEY, 'coverage', groupId, windowDays], queryFn: ({ signal }) => meetingClient.coverage(groupId!, windowDays, signal), enabled: Boolean(groupId), retry: noRetry404, staleTime: 60_000 });
}
export function useChallenges(groupId: string | undefined) {
  return useQuery({ queryKey: [KEY, 'challenges', groupId], queryFn: ({ signal }) => meetingClient.challenges(groupId!, signal), enabled: Boolean(groupId), retry: noRetry404, staleTime: 60_000 });
}
export function useMeetingFlags(status: 'open' | 'dismissed' | 'all') {
  return useQuery({ queryKey: [KEY, 'flags', status], queryFn: ({ signal }) => meetingClient.flags(status, signal), retry: noRetry404 });
}
/** Cross-region flags in the watchdog's shape. Optional: a 403/404 just means no meeting signals. */
export function useMeetingWatchdogFeed(enabled = true) {
  return useQuery({ queryKey: [KEY, 'flags', 'watchdog'], queryFn: ({ signal }) => meetingClient.watchdogFeed(signal), enabled, retry: noRetry404, staleTime: 60_000 });
}
export function useDismissFlag() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => meetingClient.dismissFlag(id), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'flags'] }) });
}
export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: MeetingCreate) => meetingClient.create(b), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }) });
}
export function usePatchMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: MeetingPatch) => meetingClient.patch(id, b), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }) });
}
export function useMeetingSources() {
  return useQuery({ queryKey: [KEY, 'sources'], queryFn: ({ signal }) => meetingClient.sources(signal), retry: noRetry404 });
}
export function useConnectMetis() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (shareTranscript: boolean) => meetingClient.connectMetis(shareTranscript), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'sources'] }) });
}
export function useRevokeMetis() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => meetingClient.revokeMetis(), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'sources'] }) });
}
export function useSyncAbc() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => meetingClient.syncAbc(), onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'sources'] }) });
}
