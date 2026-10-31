/**
 * Meeting intel ingestion connectors behind one adapter interface.
 *
 * Every source produces NormalizedMeeting[]; the pipeline never sees a
 * source-specific payload. Two pull adapters live here:
 *
 *  - ABC (the CRM, system of record): org-level. No ABC API exists in Polo
 *    yet, so the client is a typed contract with a mocked implementation in
 *    tests and a "not configured" default. Open questions are listed in
 *    /workspace/fleet/polo-meeting-intel-api.md.
 *  - Metis (each user's second brain): per-user and consent-scoped. The shape
 *    mirrors Metis's MeetingExtraction (mysticalsin/AskToto-Mantu
 *    src/shared/brain.ts, read-only). Only metadata and summary fields are
 *    mapped by default; verbatim quotes and transcripts are transcript
 *    content and are dropped unless the user allowed transcript sharing.
 *
 * Manual entry is the fallback and goes straight through the API.
 */
import type { MeetingIntelSource, NormalizedMeeting } from '@bidstack/shared';

export class SourceNotConfiguredError extends Error {
  constructor(source: MeetingIntelSource) {
    super(`${source} connector is not configured`);
    this.name = 'SourceNotConfiguredError';
  }
}

/** Accounts known to Polo, so a source only returns meetings for them. */
export interface AccountHint {
  companyId: string;
  name: string;
  domain: string | null;
  abcExternalId: string | null;
}

export interface PullContext {
  orgId: string;
  /** Connecting user (Metis) or the admin who enabled the org source (ABC). */
  userId: string;
  since: Date | null;
  accounts: AccountHint[];
  /** From the connection's consent; adapters must not request more. */
  includeTranscript: boolean;
}

export interface MeetingSourceAdapter {
  readonly source: Exclude<MeetingIntelSource, 'manual'>;
  readonly scope: 'org' | 'user';
  pull(ctx: PullContext): Promise<NormalizedMeeting[]>;
}

// ─── ABC ────────────────────────────────────────────────────────────────────

/** ASSUMED ABC meeting shape. Every field is an open question until ABC confirms its API. */
export interface AbcMeeting {
  id: string;
  subject: string;
  startAt: string;
  accountId: string | null;
  accountName: string | null;
  webUrl: string | null;
  notes: string | null;
  participants: Array<{ fullName: string; email: string | null; jobTitle: string | null; country: string | null; department: string | null }>;
  nextSteps: string[];
}

export interface AbcClient {
  listMeetings(args: { since: Date | null; accountIds: string[]; pageToken?: string }): Promise<{ items: AbcMeeting[]; nextPageToken: string | null }>;
}

export const notConfiguredAbcClient: AbcClient = {
  async listMeetings() {
    throw new SourceNotConfiguredError('abc');
  },
};

const MAX_PAGES = 20;

export function mapAbcMeeting(m: AbcMeeting): NormalizedMeeting {
  return {
    externalId: m.id,
    title: m.subject.slice(0, 300) || '(untitled)',
    heldAt: new Date(m.startAt).toISOString(),
    ...(m.webUrl ? { url: m.webUrl } : {}),
    ...(m.accountId ? { accountExternalId: m.accountId } : {}),
    ...(m.accountName ? { accountName: m.accountName } : {}),
    attendees: m.participants.slice(0, 100).map((p) => ({
      name: p.fullName.slice(0, 200),
      ...(p.email ? { email: p.email } : {}),
      ...(p.jobTitle ? { title: p.jobTitle.slice(0, 200) } : {}),
      ...(p.country ? { region: p.country.slice(0, 100) } : {}),
      ...(p.department ? { businessUnit: p.department.slice(0, 200) } : {}),
    })),
    ...(m.notes ? { summary: m.notes.slice(0, 20_000) } : {}),
    challenges: [],
    similarProjects: [],
    opportunities: [],
    nextSteps: m.nextSteps.slice(0, 30).map((s) => s.slice(0, 500)),
  };
}

export function abcAdapter(client: AbcClient): MeetingSourceAdapter {
  return {
    source: 'abc',
    scope: 'org',
    async pull(ctx) {
      const accountIds = ctx.accounts.map((a) => a.abcExternalId).filter((x): x is string => !!x);
      const out: NormalizedMeeting[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await client.listMeetings({ since: ctx.since, accountIds, ...(pageToken ? { pageToken } : {}) });
        out.push(...res.items.map(mapAbcMeeting));
        if (!res.nextPageToken) break;
        pageToken = res.nextPageToken;
      }
      return out;
    },
  };
}

// ─── Metis ──────────────────────────────────────────────────────────────────

/** Subset of Metis MeetingExtraction (brain.ts) plus the envelope a brain API would add. */
export interface MetisMeetingSummary {
  /** Stable id of the meeting in the user's brain (e.g. sourceDigest). */
  id: string;
  date: string;
  title24: string;
  topics: string[];
  account: { name: string } | null;
  people: Array<{ name: string; role: string | null; org: string | null; email?: string | null }>;
  signals: Array<{ kind: 'positive' | 'objection' | 'neutral'; statement: string; quote: string }>;
  commitments: Array<{ text: string; by: string; quote: string }>;
  deal: { name: string; stage: string } | null;
  summary: string | null;
  confidential: boolean;
  /** Only returned when requested with includeTranscript. */
  transcript?: string;
  link?: string;
}

export interface MetisBrainClient {
  /** Pull for ONE user with that user's own consent token. */
  listMeetingSummaries(args: {
    userId: string;
    since: Date | null;
    accountNames: string[];
    includeTranscript: boolean;
  }): Promise<MetisMeetingSummary[]>;
}

export const notConfiguredMetisClient: MetisBrainClient = {
  async listMeetingSummaries() {
    throw new SourceNotConfiguredError('metis');
  },
};

/**
 * Metis to NormalizedMeeting. Uses statements (paraphrase), never the
 * verbatim `quote` fields, so no transcript text leaks through a summary.
 */
export function mapMetisMeeting(m: MetisMeetingSummary, opts: { includeTranscript: boolean }): NormalizedMeeting {
  const clip = (s: string) => s.trim().slice(0, 500);
  const nonEmpty = (xs: string[]) => [...new Set(xs.map(clip).filter(Boolean))].slice(0, 30);
  return {
    externalId: m.id,
    title: (m.title24 || m.topics[0] || '(untitled)').slice(0, 300),
    heldAt: new Date(m.date).toISOString(),
    ...(m.link ? { url: m.link } : {}),
    ...(m.account?.name ? { accountName: m.account.name } : {}),
    attendees: m.people.slice(0, 100).map((p) => ({
      name: p.name.slice(0, 200),
      ...(p.email ? { email: p.email } : {}),
      ...(p.role ? { title: p.role.slice(0, 200) } : {}),
    })),
    ...(m.summary ? { summary: m.summary.slice(0, 20_000) } : {}),
    ...(opts.includeTranscript && m.transcript ? { transcript: m.transcript } : {}),
    challenges: nonEmpty(m.signals.filter((s) => s.kind === 'objection').map((s) => s.statement)),
    similarProjects: nonEmpty(m.topics),
    opportunities: nonEmpty(m.deal?.name ? [`${m.deal.name}${m.deal.stage ? ` (${m.deal.stage})` : ''}`] : []),
    nextSteps: nonEmpty(m.commitments.map((c) => c.text)),
    confidential: m.confidential,
  };
}

export function metisAdapter(client: MetisBrainClient): MeetingSourceAdapter {
  return {
    source: 'metis',
    scope: 'user',
    async pull(ctx) {
      const rows = await client.listMeetingSummaries({
        userId: ctx.userId,
        since: ctx.since,
        accountNames: ctx.accounts.map((a) => a.name),
        includeTranscript: ctx.includeTranscript,
      });
      return rows.map((r) => mapMetisMeeting(r, { includeTranscript: ctx.includeTranscript }));
    },
  };
}

export interface AdapterRegistry {
  abc: MeetingSourceAdapter;
  metis: MeetingSourceAdapter;
}

export const defaultAdapters: AdapterRegistry = {
  abc: abcAdapter(notConfiguredAbcClient),
  metis: metisAdapter(notConfiguredMetisClient),
};
