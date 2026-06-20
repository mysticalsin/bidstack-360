/**
 * React Query hooks for Voice + Video calls (Wave 8).
 *
 * WHY three hooks: `useCalls` lists sessions for an entity (paginated),
 * `useCall` fetches full detail with signed recording URL + transcript,
 * `useStartCall` wraps the quick-start mutation so call sites are trivial.
 */

import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CallProvider = 'ZOOM' | 'TEAMS' | 'GOOGLE_MEET' | 'TWILIO_VOICE';
export type CallEntityType = 'DEAL' | 'CONTACT' | 'OPPORTUNITY' | 'LEAD';
export type CallStatus = 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface CallActionItem {
  owner?: string | null;
  description: string;
  dueDate?: string | null;
}

/** Display text for an action item, tolerating legacy string rows. */
export function callActionItemText(item: CallActionItem | string): string {
  if (typeof item === 'string') return item;
  return item?.description ?? '';
}

export interface CallSession {
  id: string;
  orgId: string;
  userId: string;
  entityType: string;
  entityId: string;
  provider: CallProvider;
  externalMeetingId: string | null;
  joinUrl: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  participantEmails: string[] | null;
  /** '[available]' in list view; null if no recording */
  recordingUrl: string | null;
  summary: string | null;
  // The analysis worker stores structured items ({owner, description, dueDate}).
  // Union with string for legacy rows / model variance so render never crashes.
  actionItems: Array<CallActionItem | string> | null;
  sentimentScore: number | null;
  talkRatio: Record<string, number> | null;
  status: CallStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CallSummaryEntry {
  id: string;
  key: string;
  value: string;
  confidence: number;
  sourceQuoteRef: string | null;
}

export interface CallDetail extends CallSession {
  transcriptText: string | null;
  transcriptStructured: TranscriptSegment[] | null;
  signedRecordingUrl: string | null;
  summaries: CallSummaryEntry[];
}

export interface TranscriptSegment {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

interface CallsPage {
  calls: CallSession[];
  nextCursor: string | null;
}

interface StartCallInput {
  entityType: CallEntityType;
  entityId: string;
  provider: CallProvider;
  topic?: string;
  toPhoneNumber?: string;
}

interface StartCallResult {
  callSessionId: string;
  joinUrl: string | null;
  hostJoinUrl: string | null;
  provider: CallProvider;
}

interface ScheduleCallInput {
  entityType: CallEntityType;
  entityId: string;
  provider: Exclude<CallProvider, 'TWILIO_VOICE'>;
  startsAt: string;
  durationMinutes?: number;
  attendeeEmails?: string[];
  topic?: string;
}

// ─── useCalls — paginated list for an entity ─────────────────────────────────

interface UseCallsParams {
  entityType?: CallEntityType;
  entityId?: string;
  provider?: CallProvider;
  limit?: number;
}

export function useCalls(params: UseCallsParams = {}) {
  const { entityType, entityId, provider, limit = 25 } = params;
  return useInfiniteQuery({
    queryKey: ['calls', params],
    queryFn: ({ signal, pageParam }) => {
      const usp = new URLSearchParams();
      if (entityType) usp.set('entityType', entityType);
      if (entityId) usp.set('entityId', entityId);
      if (provider) usp.set('provider', provider);
      usp.set('limit', String(limit));
      if (pageParam) usp.set('cursor', pageParam as string);
      return api<CallsPage>(`/api/calls?${usp.toString()}`, { signal });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

// ─── useCall — single session with recording URL + transcript ─────────────────

export function useCall(id: string | undefined) {
  return useQuery({
    queryKey: ['call', id],
    queryFn: ({ signal }) => api<{ call: CallDetail }>(`/api/calls/${id}`, { signal }),
    enabled: Boolean(id),
    // WHY 0 staleTime: signed recording URLs expire in 5 min; always refetch
    staleTime: 0,
    select: (data) => data.call,
  });
}

// ─── useStartCall — quick-start mutation ──────────────────────────────────────

export function useStartCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartCallInput) =>
      api<StartCallResult>('/api/calls/quick-start', { method: 'POST', body: input }),
    onSuccess: () => {
      // Invalidate call lists so newly created sessions appear
      void qc.invalidateQueries({ queryKey: ['calls'] });
    },
  });
}

// ─── useScheduleCall — schedule future meeting ────────────────────────────────

export function useScheduleCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduleCallInput) =>
      api<{ callSessionId: string; joinUrl: string | null; provider: string }>(
        '/api/calls/schedule',
        { method: 'POST', body: input },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calls'] });
    },
  });
}

// ─── useExtractInsights — re-trigger AI analysis ──────────────────────────────

export function useExtractInsights(callSessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ jobId: string; message: string }>(`/api/calls/${callSessionId}/extract-insights`, {
        method: 'POST',
      }),
    onSuccess: () => {
      // Invalidate this call's detail so the UI picks up updated summaries
      void qc.invalidateQueries({ queryKey: ['call', callSessionId] });
    },
  });
}
