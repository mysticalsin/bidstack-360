// Meeting intel API client. Types come from @bidstack/shared
// (packages/shared/src/schemas/meeting-intel.ts) so web and API cannot drift.
import type {
  ChallengeRollupResponse, CoverageMapResponse, CrossRegionFlagOut, FlagMeetingDetail, MeetingIntelDetail, MeetingIntelListQuery,
  MeetingIntelManualCreate, MeetingIntelPatch, MeetingIntelRow, MeetingIntelSource, MeetingIntelWatchdogItem,
  MeetingSourceStatus, SeniorityLevel,
} from '@bidstack/shared';
import type { z } from 'zod';

import { api } from '@/lib/api';

export type {
  ChallengeRollupResponse, CoverageMapResponse, CrossRegionFlagOut, FlagMeetingDetail, MeetingIntelDetail, MeetingIntelRow,
  MeetingIntelWatchdogItem, MeetingSourceStatus, SeniorityLevel,
};
export type MeetingSource = z.infer<typeof MeetingIntelSource>;
export type MeetingListQuery = Partial<z.input<typeof MeetingIntelListQuery>>;
export type MeetingCreate = z.input<typeof MeetingIntelManualCreate>;
export type MeetingPatch = z.input<typeof MeetingIntelPatch>;
export interface MeetingListResponse { items: MeetingIntelRow[]; nextCursor: number | null }
export interface MetisConnectResult { token: string; tokenPrefix: string; shareSummary: true; shareTranscript: boolean }

export const SENIORITY_LABEL: Record<SeniorityLevel, string> = {
  c_level: 'C-level', vp: 'VP', director: 'Director', manager: 'Manager', ic: 'Individual contributor', unknown: 'Unknown',
};
export const SENIORITY_SHORT: Record<SeniorityLevel, string> = {
  c_level: 'C-level', vp: 'VP', director: 'Director', manager: 'Manager', ic: 'IC', unknown: 'Other',
};
/** Levels the coverage map shows as columns; IC and unknown fold into the people count only. */
export const COVERAGE_LEVELS: SeniorityLevel[] = ['c_level', 'vp', 'director', 'manager'];
export const SENIOR_LEVELS = new Set<SeniorityLevel>(['c_level', 'vp', 'director']);
export const SOURCE_LABEL: Record<MeetingSource, string> = { abc: 'ABC', metis: 'Métis', manual: 'Manual' };

export function meetingQueryString(q: MeetingListQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

const MI = '/api/meeting-intel';
export const meetingClient = {
  list: (q: MeetingListQuery, signal?: AbortSignal) => api<MeetingListResponse>(`${MI}${meetingQueryString(q)}`, { signal }),
  detail: (id: string, signal?: AbortSignal) => api<MeetingIntelDetail>(`${MI}/${encodeURIComponent(id)}`, { signal }),
  create: (body: MeetingCreate) => api<{ id: string }>(MI, { method: 'POST', body: body }),
  patch: (id: string, body: MeetingPatch) => api<unknown>(`${MI}/${encodeURIComponent(id)}`, { method: 'PATCH', body: body }),
  coverage: (groupId: string, windowDays = 365, signal?: AbortSignal) =>
    api<CoverageMapResponse>(`${MI}/accounts/${encodeURIComponent(groupId)}/coverage?windowDays=${windowDays}`, { signal }),
  challenges: (groupId: string, signal?: AbortSignal) =>
    api<ChallengeRollupResponse>(`${MI}/accounts/${encodeURIComponent(groupId)}/challenges`, { signal }),
  flags: (status: 'open' | 'dismissed' | 'all', signal?: AbortSignal) =>
    api<{ items: CrossRegionFlagOut[] }>(`${MI}/flags?status=${status}`, { signal }),
  watchdogFeed: (signal?: AbortSignal) => api<{ items: MeetingIntelWatchdogItem[] }>(`${MI}/flags?format=watchdog`, { signal }),
  /** The meeting behind a flag, for its recipient (redacted if the account is outside their scope). */
  flagMeeting: (flagId: string, signal?: AbortSignal) =>
    api<FlagMeetingDetail>(`${MI}/flags/${encodeURIComponent(flagId)}/meeting`, { signal }),
  dismissFlag: (id: string) => api<void>(`${MI}/flags/${encodeURIComponent(id)}/dismiss`, { method: 'POST' }),
  sources: (signal?: AbortSignal) => api<{ items: MeetingSourceStatus[] }>(`${MI}/sources`, { signal }),
  connectMetis: (shareTranscript: boolean) =>
    api<MetisConnectResult>(`${MI}/sources/metis/connect`, { method: 'POST', body: { shareSummary: true, shareTranscript } }),
  revokeMetis: () => api<void>(`${MI}/sources/metis`, { method: 'DELETE' }),
  syncAbc: () => api<{ connectionId: string; queued: boolean }>(`${MI}/sources/abc/sync`, { method: 'POST' }),
};

/** "Cloud cost review\nEmma Clarke, VP Technology" → attendees. One per line: "Name, Title, Region, BU". */
export function parseAttendees(text: string): MeetingCreate['attendees'] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((l) => {
      const [name, title, region, businessUnit] = l.split(',').map((s) => s.trim());
      return {
        name: name!,
        ...(title ? { title } : {}),
        ...(region ? { region } : {}),
        ...(businessUnit ? { businessUnit } : {}),
      };
    });
}

export const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 30);

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtMeetingDate = (iso: string) => dateFmt.format(new Date(iso));
export function agoLabel(iso: string, now = Date.now()): string {
  const d = Math.round((now - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 60) return `${d} days ago`;
  const m = Math.round(d / 30);
  return m < 24 ? `${m} months ago` : `${Math.round(d / 365)} years ago`;
}
