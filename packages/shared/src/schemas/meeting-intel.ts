// Strategic account meeting intel (2026-10-31). Meetings arrive from ABC (CRM),
// Metis (each user's second brain, per-user consent) or manual entry, behind
// one adapter interface, and are normalized to NormalizedMeeting before the
// meeting-intel pipeline matches, enriches, dedupes and flags them.
// API contract: /workspace/fleet/polo-meeting-intel-api.md.
import { z } from 'zod';

export const MeetingIntelSource = z.enum(['abc', 'metis', 'manual']);
export type MeetingIntelSource = z.infer<typeof MeetingIntelSource>;

export const MeetingIntelVisibility = z.enum(['account_team', 'org']);
export type MeetingIntelVisibility = z.infer<typeof MeetingIntelVisibility>;

export const SeniorityLevel = z.enum(['c_level', 'vp', 'director', 'manager', 'ic', 'unknown']);
export type SeniorityLevel = z.infer<typeof SeniorityLevel>;
/** Display order for the coverage map, most senior first. */
export const SENIORITY_ORDER: readonly SeniorityLevel[] = ['c_level', 'vp', 'director', 'manager', 'ic', 'unknown'];

const IsoDate = z.string().datetime();
const ShortText = z.string().trim().min(1).max(500);
const List = z.array(ShortText).max(30).default([]);

/** One attendee as an adapter reports it. */
export const NormalizedAttendee = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).optional(),
  title: z.string().trim().max(200).optional(),
  region: z.string().trim().max(100).optional(),
  businessUnit: z.string().trim().max(200).optional(),
});
export type NormalizedAttendee = z.infer<typeof NormalizedAttendee>;

/**
 * The adapter-neutral meeting. Every adapter (ABC, Metis, manual) produces
 * this shape; the pipeline never sees source-specific payloads.
 * Account hints are tried in order: companyId, accountExternalId (ABC id),
 * accountName / attendee email domains.
 */
export const NormalizedMeeting = z.object({
  externalId: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(300),
  heldAt: IsoDate,
  url: z.string().url().max(2000).optional(),
  companyId: z.string().uuid().optional(),
  accountExternalId: z.string().trim().max(255).optional(),
  accountName: z.string().trim().max(300).optional(),
  attendees: z.array(NormalizedAttendee).max(100).default([]),
  summary: z.string().max(20_000).optional(),
  /** Dropped before storage unless the connection allows transcripts. */
  transcript: z.string().max(500_000).optional(),
  challenges: List,
  similarProjects: List,
  opportunities: List,
  nextSteps: List,
  visibility: MeetingIntelVisibility.optional(),
  /** Metis confidential meetings are refused at ingest. */
  confidential: z.boolean().optional(),
});
export type NormalizedMeeting = z.infer<typeof NormalizedMeeting>;

// ─── API shapes ─────────────────────────────────────────────────────────────

export const MeetingIntelAttendeeOut = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  title: z.string().nullable(),
  seniority: SeniorityLevel,
  region: z.string().nullable(),
  businessUnit: z.string().nullable(),
  isInternal: z.boolean(),
  contactId: z.string().uuid().nullable(),
  /** Contact's manager (org chart), when known and visible. */
  reportsToContactId: z.string().uuid().nullable(),
});
export type MeetingIntelAttendeeOut = z.infer<typeof MeetingIntelAttendeeOut>;

export const MeetingIntelSourceOut = z.object({
  source: MeetingIntelSource,
  externalId: z.string(),
  url: z.string().nullable(),
  ingestedAt: IsoDate,
});

export const MeetingIntelRow = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  companyName: z.string(),
  title: z.string(),
  heldAt: IsoDate,
  visibility: MeetingIntelVisibility,
  sources: z.array(MeetingIntelSource),
  attendeeCount: z.number().int(),
  topSeniority: SeniorityLevel,
  challenges: z.array(z.string()),
  nextSteps: z.array(z.string()),
});
export type MeetingIntelRow = z.infer<typeof MeetingIntelRow>;

export const MeetingIntelDetail = MeetingIntelRow.extend({
  summary: z.string().nullable(),
  /** Present only when stored with the connecting user's consent. */
  transcript: z.string().nullable(),
  similarProjects: z.array(z.string()),
  opportunities: z.array(z.string()),
  attendees: z.array(MeetingIntelAttendeeOut),
  sourceLinks: z.array(MeetingIntelSourceOut),
  createdAt: IsoDate,
});
export type MeetingIntelDetail = z.infer<typeof MeetingIntelDetail>;

export const MeetingIntelListQuery = z.object({
  companyId: z.string().uuid().optional(),
  /** Includes meetings on every descendant of this company (group view). */
  groupId: z.string().uuid().optional(),
  source: MeetingIntelSource.optional(),
  seniority: SeniorityLevel.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().min(0).default(0),
});
export type MeetingIntelListQuery = z.infer<typeof MeetingIntelListQuery>;

export const MeetingIntelListResponse = z.object({
  items: z.array(MeetingIntelRow),
  nextCursor: z.number().int().nullable(),
});

export const MeetingIntelManualCreate = NormalizedMeeting.omit({ externalId: true, confidential: true, transcript: true }).extend({
  companyId: z.string().uuid(),
});
export type MeetingIntelManualCreate = z.infer<typeof MeetingIntelManualCreate>;

export const MeetingIntelPatch = z
  .object({
    visibility: MeetingIntelVisibility.optional(),
    challenges: z.array(ShortText).max(30).optional(),
    similarProjects: z.array(ShortText).max(30).optional(),
    opportunities: z.array(ShortText).max(30).optional(),
    nextSteps: z.array(ShortText).max(30).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'PATCH body must contain at least one field' });
export type MeetingIntelPatch = z.infer<typeof MeetingIntelPatch>;

export const CoverageCell = z.object({
  region: z.string(),
  seniority: SeniorityLevel,
  meetings: z.number().int(),
  people: z.number().int(),
  lastMetAt: IsoDate.nullable(),
});
export const CoverageMapResponse = z.object({
  groupId: z.string().uuid(),
  regions: z.array(z.string()),
  seniorities: z.array(SeniorityLevel),
  cells: z.array(CoverageCell),
  /** Region x seniority pairs (C-level, VP, Director) with no meeting in the window. */
  gaps: z.array(z.object({ region: z.string(), seniority: SeniorityLevel })),
  windowDays: z.number().int(),
});
export type CoverageMapResponse = z.infer<typeof CoverageMapResponse>;

export const ChallengeRollupResponse = z.object({
  groupId: z.string().uuid(),
  items: z.array(
    z.object({
      challenge: z.string(),
      mentions: z.number().int(),
      regions: z.array(z.string()),
      lastMentionedAt: IsoDate,
      meetingIds: z.array(z.string().uuid()),
    }),
  ),
});
export type ChallengeRollupResponse = z.infer<typeof ChallengeRollupResponse>;

export const CrossRegionFlagOut = z.object({
  id: z.string().uuid(),
  meetingId: z.string().uuid(),
  parentCompanyId: z.string().uuid(),
  parentCompanyName: z.string(),
  /** 'Restricted company' when the meeting's account is outside your scope. */
  companyName: z.string(),
  companyRestricted: z.boolean(),
  ownedCompanyId: z.string().uuid(),
  ownedCompanyName: z.string(),
  reason: z.string(),
  talkingPoints: z.array(z.string()),
  status: z.enum(['open', 'dismissed']),
  createdAt: IsoDate,
});
export type CrossRegionFlagOut = z.infer<typeof CrossRegionFlagOut>;

/** Data interface for the watchdog feed (consumed by the watchdog owner). */
export const MeetingIntelWatchdogItem = z.object({
  kind: z.literal('MEETING_CROSS_REGION'),
  externalId: z.string(),
  companyId: z.string().uuid(),
  occurredAt: IsoDate,
  title: z.string(),
  summary: z.string(),
  implication: z.literal('OPPORTUNITY'),
  url: z.string(),
});
export type MeetingIntelWatchdogItem = z.infer<typeof MeetingIntelWatchdogItem>;

export const MeetingSourceStatus = z.object({
  source: MeetingIntelSource,
  scope: z.enum(['org', 'user']),
  status: z.enum(['connected', 'not_connected', 'revoked', 'error', 'not_configured']),
  shareSummary: z.boolean().nullable(),
  shareTranscript: z.boolean().nullable(),
  tokenPrefix: z.string().nullable(),
  lastSyncAt: IsoDate.nullable(),
  lastError: z.string().nullable(),
  itemsReceived: z.number().int(),
  pending: z.number().int(),
  unmatched: z.number().int(),
});
export type MeetingSourceStatus = z.infer<typeof MeetingSourceStatus>;

export const MetisConnectBody = z.object({
  /** Consent: share meeting metadata and summary for accounts in Polo. */
  shareSummary: z.literal(true),
  /** Off by default; raw transcripts are only stored when true. */
  shareTranscript: z.boolean().default(false),
});
export type MetisConnectBody = z.infer<typeof MetisConnectBody>;

export const MetisIngestBody = z.object({ meetings: z.array(NormalizedMeeting).min(1).max(50) });
export type MetisIngestBody = z.infer<typeof MetisIngestBody>;

export const MeetingIngestResult = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  refused: z.array(z.object({ externalId: z.string(), reason: z.string() })),
});
export type MeetingIngestResult = z.infer<typeof MeetingIngestResult>;

// ─── Pure helpers shared by the API and the pipeline worker ────────────────

const C_LEVEL = /\b(c[eofitmdrsp]o|chief|president|founder|co-?founder|managing director|general manager|owner|partner|directeur g[eé]n[eé]ral|pdg|dg|gesch[aä]ftsf[uü]hrer)\b/i;
const VP = /\b(vp|svp|evp|avp|vice[- ]president|head of|directeur ex[eé]cutif|bereichsleiter)\b/i;
const DIRECTOR = /\b(director|directeur|directrice|direktor|leiter|head)\b/i;
const MANAGER = /\b(manager|lead|responsable|chef de|team ?lead|supervisor|coordinator|principal)\b/i;
const IC = /\b(engineer|analyst|consultant|specialist|developer|architect|associate|officer|assistant|administrator|buyer|acheteur|ing[eé]nieur)\b/i;

/** Rule-based seniority from a job title. No LLM; unknown when unsure. */
export function classifySeniority(title: string | null | undefined): SeniorityLevel {
  const t = (title ?? '').trim();
  if (!t) return 'unknown';
  if (VP.test(t) && !/\bchief\b/i.test(t)) return 'vp';
  if (C_LEVEL.test(t)) return 'c_level';
  if (DIRECTOR.test(t)) return 'director';
  if (MANAGER.test(t)) return 'manager';
  if (IC.test(t)) return 'ic';
  return 'unknown';
}

export function seniorityRank(s: SeniorityLevel): number {
  return SENIORITY_ORDER.indexOf(s);
}

export function normalizeMeetingTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(re|fw|fwd|tr)\s*:\s*/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Cross-source dedupe material: same org, account and UTC day, plus either the
 * same normalized title or the same external attendee set (2+ emails). The
 * pipeline hashes each string (sha256) into meeting_intel.dedupe_key lookups.
 * Kept hash-free here so this module stays browser-safe.
 */
export function meetingDedupeMaterial(input: {
  orgId: string;
  companyId: string;
  heldAt: Date;
  title: string;
  attendeeEmails: string[];
}): { byTitle: string; byAttendees: string | null } {
  const day = input.heldAt.toISOString().slice(0, 10);
  const emails = [...new Set(input.attendeeEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))].sort();
  return {
    byTitle: `t|${input.orgId}|${input.companyId}|${day}|${normalizeMeetingTitle(input.title)}`,
    byAttendees: emails.length >= 2 ? `a|${input.orgId}|${input.companyId}|${day}|${emails.join(',')}` : null,
  };
}

export function emailDomain(email: string | null | undefined): string | null {
  const m = /@([^@\s]+)$/.exec((email ?? '').trim().toLowerCase());
  return m ? m[1]!.replace(/^www\./, '') : null;
}

/** Deterministic talking points for a cross-region flag. No em dashes. */
export function crossRegionTalkingPoints(input: {
  parentName: string;
  meetingRegion: string;
  ownedRegion: string;
  topSeniority: SeniorityLevel;
  challenges: string[];
  opportunities: string[];
  restricted: boolean;
}): string[] {
  const label: Record<SeniorityLevel, string> = {
    c_level: 'C-level',
    vp: 'VP',
    director: 'Director',
    manager: 'Manager',
    ic: 'IC',
    unknown: 'unknown seniority',
  };
  const where = input.restricted ? 'another region' : input.meetingRegion;
  const points = [
    `${input.parentName}: a ${label[input.topSeniority]} meeting took place in ${where}. Ask your ${input.ownedRegion} contacts whether the same topics are on their agenda.`,
  ];
  for (const c of input.challenges.slice(0, 3)) points.push(`Challenge raised: ${c}. Is ${input.ownedRegion} facing it too?`);
  for (const o of input.opportunities.slice(0, 2)) points.push(`Opportunity discussed: ${o}. Check for a ${input.ownedRegion} equivalent.`);
  return points.map((p) => p.replace(/\u2014/g, '-'));
}
