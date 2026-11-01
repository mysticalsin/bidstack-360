// MARS integration (2026-10-31). MARS is the internal tool where managers log,
// every week, which client people they met and when. Polo pulls those entries
// (REST, cursor based, plus an optional webhook nudge), maps them into meeting
// intel and org chart suggestions, and exposes a read-only tool surface (MCP
// style) over the same data. Nothing here talks to MARS: the contract below is
// ASSUMED until the MARS owner confirms it. Design: fleet/polo-mars-integration.md.
//
// Pure helpers only (no env, no IO), so api, worker and web can share them.
import { z } from 'zod';

import { classifySeniority, MeetingIntelSource, type SeniorityLevel, seniorityRank } from './meeting-intel.js';

// ─── assumed MARS wire contract ─────────────────────────────────────────────

const Text = (max: number) => z.string().trim().max(max);
const OptText = (max: number) => Text(max).nullish();

export const MarsPerson = z.object({
  /** MARS contact id, when MARS keeps a contact directory. */
  id: OptText(100),
  fullName: Text(200).min(1),
  email: z.string().trim().toLowerCase().email().max(320).nullish(),
  linkedinUrl: z.string().trim().url().max(300).nullish(),
  jobTitle: OptText(200),
  department: OptText(200),
  country: OptText(100),
  /** Manager as the logging manager understood it. A hint, never a fact. */
  reportsTo: z.object({ fullName: Text(200).min(1), email: z.string().trim().toLowerCase().email().max(320).nullish() }).nullish(),
});
export type MarsPerson = z.infer<typeof MarsPerson>;

export const MarsClientCompany = z.object({
  marsAccountId: OptText(100),
  name: Text(300).min(1),
  legalName: OptText(300),
  domain: OptText(255),
  parentName: OptText(300),
  country: OptText(100),
});
export type MarsClientCompany = z.infer<typeof MarsClientCompany>;

export const MarsMeetingType = z.enum(['in_person', 'video', 'phone', 'event', 'meal', 'other']);

export const MarsEntry = z.object({
  id: Text(100).min(1),
  /** Increments on every edit in MARS. */
  version: z.number().int().min(1),
  updatedAt: z.string().datetime(),
  /** ISO date of the Monday of the logged week. */
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meetingDate: z.string().datetime(),
  loggedBy: z.object({ email: z.string().trim().toLowerCase().email().max(320), name: Text(200).min(1), region: OptText(100) }),
  internalAttendees: z.array(z.object({ email: z.string().trim().toLowerCase().email().max(320), name: Text(200).min(1) })).max(20).default([]),
  client: MarsClientCompany,
  contacts: z.array(MarsPerson).max(50).default([]),
  meetingType: MarsMeetingType.default('other'),
  topic: OptText(300),
  notes: z.string().max(20_000).nullish(),
  challenges: z.array(Text(500).min(1)).max(30).default([]),
  nextSteps: z.array(Text(500).min(1)).max(30).default([]),
  confidential: z.boolean().default(false),
  /** Tombstone: the entry was deleted in MARS. */
  deleted: z.boolean().default(false),
});
export type MarsEntry = z.infer<typeof MarsEntry>;

/** Webhook nudge body. It only says "something changed"; Polo then pulls. */
export const MarsWebhookEvent = z.object({
  type: z.enum(['entry.created', 'entry.updated', 'entry.deleted']),
  entryId: Text(100).min(1),
  occurredAt: z.string().datetime(),
});
export type MarsWebhookEvent = z.infer<typeof MarsWebhookEvent>;

/** Env value of MARS_INTEGRATION_ENABLED. Off unless exactly "true". */
export function isMarsEnabled(value: string | undefined | null): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

// ─── account matching (strict, never substring) ────────────────────────────

const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'ltd', 'limited', 'llc', 'llp', 'plc', 'sa', 'sas', 'sasu', 'sarl', 'ag', 'gmbh', 'bv', 'nv', 'spa', 'srl',
  'corp', 'corporation', 'co', 'company', 'group', 'groupe', 'holding', 'holdings', 'se', 'oy', 'ab', 'as', 'kk', 'pty', 'lda', 'sl',
]);

/** Name key: no accents, punctuation or legal suffixes. "Acme, S.A." and "ACME SA" give "acme". */
export function normalizeCompanyName(s: string | null | undefined): string {
  const base = (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = base.split(' ').filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

export function normalizeDomain(s: string | null | undefined): string | null {
  const d = (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#:]/)[0]!
    .replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com', 'aol.com']);

export interface MarsAccountCandidate {
  companyId: string;
  name: string;
  legalName: string | null;
  domain: string | null;
  parentId: string | null;
  /** Stored MARS account id once an admin confirmed a mapping. */
  marsAccountId?: string | null;
}

export type MarsAccountMatchMethod = 'mars_id' | 'domain' | 'legal_name' | 'name' | 'contact_domain' | 'parent';
export type MarsAccountMatch =
  | { companyId: string; method: MarsAccountMatchMethod }
  | { companyId: null; reason: 'no_match' | 'ambiguous'; candidates: string[] };

/** True when `host` is `domain` or a subdomain of it (label boundary, not substring). */
function domainCovers(domain: string, host: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Client company of a MARS entry to one Polo account. Every rule needs a
 * UNIQUE hit; two hits stop the search as ambiguous (kept for admin mapping).
 * Order: confirmed MARS id, company domain, legal name, name, client staff
 * email domain (free mail and our own domains ignored), then the parent
 * company by name when the entity itself is unknown to Polo.
 */
export function matchMarsAccount(
  client: MarsClientCompany,
  accounts: readonly MarsAccountCandidate[],
  opts: { contactEmails?: readonly (string | null | undefined)[]; ownDomains?: ReadonlySet<string> } = {},
): MarsAccountMatch {
  const decide = (hits: MarsAccountCandidate[], method: MarsAccountMatchMethod): MarsAccountMatch | null => {
    const ids = [...new Set(hits.map((h) => h.companyId))];
    if (ids.length === 1) return { companyId: ids[0]!, method };
    if (ids.length > 1) return { companyId: null, reason: 'ambiguous', candidates: ids.slice(0, 10) };
    return null;
  };
  if (client.marsAccountId) {
    const r = decide(accounts.filter((a) => a.marsAccountId && a.marsAccountId === client.marsAccountId), 'mars_id');
    if (r) return r;
  }
  const dom = normalizeDomain(client.domain);
  if (dom) {
    const exact = accounts.filter((a) => normalizeDomain(a.domain) === dom);
    const r = decide(exact.length ? exact : accounts.filter((a) => { const d = normalizeDomain(a.domain); return !!d && domainCovers(d, dom); }), 'domain');
    if (r) return r;
  }
  const legal = normalizeCompanyName(client.legalName);
  if (legal) {
    const r = decide(accounts.filter((a) => normalizeCompanyName(a.legalName) === legal || normalizeCompanyName(a.name) === legal), 'legal_name');
    if (r) return r;
  }
  const name = normalizeCompanyName(client.name);
  if (name) {
    const r = decide(accounts.filter((a) => normalizeCompanyName(a.name) === name || normalizeCompanyName(a.legalName) === name), 'name');
    if (r) return r;
  }
  const own = opts.ownDomains ?? new Set<string>();
  const hosts = [...new Set((opts.contactEmails ?? []).map((e) => normalizeDomain(e?.split('@')[1])).filter((d): d is string => !!d && !FREE_MAIL.has(d) && ![...own].some((o) => domainCovers(o, d))))];
  if (hosts.length) {
    const hits = accounts.filter((a) => { const d = normalizeDomain(a.domain); return !!d && hosts.some((h) => domainCovers(d, h)); });
    const r = decide(hits, 'contact_domain');
    if (r) return r;
  }
  const parent = normalizeCompanyName(client.parentName);
  if (parent) {
    const r = decide(accounts.filter((a) => normalizeCompanyName(a.name) === parent || normalizeCompanyName(a.legalName) === parent), 'parent');
    if (r) return r;
  }
  return { companyId: null, reason: 'no_match', candidates: [] };
}

// ─── people: dedupe by email, LinkedIn, then name + company ────────────────

export function normalizeLinkedinHandle(url: string | null | undefined): string | null {
  const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(url ?? '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!).toLowerCase().replace(/\/+$/, '') || null;
  } catch {
    return m[1]!.toLowerCase();
  }
}

export function normalizePersonName(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(mr|mrs|ms|dr|prof|mme|m)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface PersonSighting {
  name: string;
  email?: string | null;
  linkedinUrl?: string | null;
  companyId: string;
  title?: string | null;
  department?: string | null;
  country?: string | null;
  seenAt: string;
  /** Opaque ref of the meeting this sighting came from. */
  meetingRef?: string | null;
  reportsTo?: { name: string; email?: string | null } | null;
}

export interface MergedPerson {
  key: string;
  name: string;
  emails: string[];
  linkedinHandle: string | null;
  companyId: string;
  title: string | null;
  seniority: SeniorityLevel;
  department: string | null;
  country: string | null;
  meetingRefs: string[];
  meetingCount: number;
  firstMetAt: string;
  lastMetAt: string;
  reportsTo: { name: string; email: string | null } | null;
}

/**
 * Same person when email or LinkedIn handle match. A sighting with neither
 * joins a group only by exact normalized name within the same company, and
 * only when exactly one group carries that name (two "J. Smith" stay apart).
 * The newest sighting wins for title, department, country and manager hint.
 */
export function dedupePeople(sightings: readonly PersonSighting[]): MergedPerson[] {
  const parent = sightings.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const byKey = new Map<string, number>();
  sightings.forEach((s, i) => {
    const keys = [s.email ? `e:${s.email.trim().toLowerCase()}` : null, normalizeLinkedinHandle(s.linkedinUrl) ? `l:${normalizeLinkedinHandle(s.linkedinUrl)}` : null].filter((k): k is string => !!k);
    for (const k of keys) {
      const j = byKey.get(k);
      if (j === undefined) byKey.set(k, i);
      else union(j, i);
    }
  });
  const nameKey = (s: PersonSighting) => `${s.companyId}|${normalizePersonName(s.name)}`;
  const strong = (s: PersonSighting) => !!s.email || !!normalizeLinkedinHandle(s.linkedinUrl);
  const groupsByName = new Map<string, Set<number>>();
  sightings.forEach((s, i) => { if (strong(s)) { const k = nameKey(s); if (!groupsByName.has(k)) groupsByName.set(k, new Set()); groupsByName.get(k)!.add(find(i)); } });
  const weakFirst = new Map<string, number>();
  sightings.forEach((s, i) => {
    if (strong(s)) return;
    const k = nameKey(s);
    const g = groupsByName.get(k);
    if (g && g.size === 1) union([...g][0]!, i);
    else if (!g) { const j = weakFirst.get(k); if (j === undefined) weakFirst.set(k, i); else union(j, i); }
  });
  const groups = new Map<number, PersonSighting[]>();
  sightings.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(s); });
  const out: MergedPerson[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.seenAt.localeCompare(b.seenAt));
    const newest = sorted[sorted.length - 1]!;
    const latest = <K extends keyof PersonSighting>(k: K) => [...sorted].reverse().find((s) => s[k])?.[k] ?? null;
    const emails = [...new Set(sorted.map((s) => s.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
    const li = sorted.map((s) => normalizeLinkedinHandle(s.linkedinUrl)).find(Boolean) ?? null;
    const title = (latest('title') as string | null) ?? null;
    const refs = [...new Set(sorted.map((s) => s.meetingRef).filter((r): r is string => !!r))];
    const mgr = latest('reportsTo') as PersonSighting['reportsTo'];
    out.push({
      key: emails[0] ? `email:${emails[0]}` : li ? `linkedin:${li}` : `name:${newest.companyId}:${normalizePersonName(newest.name)}`,
      name: newest.name.trim(),
      emails,
      linkedinHandle: li,
      companyId: newest.companyId,
      title,
      seniority: classifySeniority(title),
      department: (latest('department') as string | null) ?? null,
      country: (latest('country') as string | null) ?? null,
      meetingRefs: refs,
      meetingCount: refs.length || sorted.length,
      firstMetAt: sorted[0]!.seenAt,
      lastMetAt: newest.seenAt,
      reportsTo: mgr ? { name: mgr.name, email: mgr.email ?? null } : null,
    });
  }
  return out.sort((a, b) => seniorityRank(a.seniority) - seniorityRank(b.seniority) || b.lastMetAt.localeCompare(a.lastMetAt));
}

// ─── recency badge ──────────────────────────────────────────────────────────

export const MEETING_RECENCY_DAYS = { recent: 30, warm: 90 } as const;
export type MeetingRecency = 'recent' | 'warm' | 'stale' | 'never';

/** recent = met in the last 30 days (green), warm = 31 to 90 (amber), stale = older. */
export function meetingRecency(lastMetAt: string | Date | null | undefined, now: Date = new Date()): MeetingRecency {
  if (!lastMetAt) return 'never';
  const t = new Date(lastMetAt).getTime();
  if (Number.isNaN(t)) return 'never';
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days <= MEETING_RECENCY_DAYS.recent) return 'recent';
  if (days <= MEETING_RECENCY_DAYS.warm) return 'warm';
  return 'stale';
}

// ─── reporting-line suggestions ─────────────────────────────────────────────

const FUNCTIONS: Array<[string, RegExp]> = [
  ['finance', /\b(finance|financial|cfo|controller|controlling|treasury|accounting|comptable|tax)\b/i],
  ['technology', /\b(it|cio|cto|technology|technical|engineering|digital|data|software|infrastructure|security|ciso|architect)\b/i],
  ['people', /\b(hr|chro|human|people|talent|recruit\w*|rh)\b/i],
  ['sales', /\b(sales|commercial|cco|business development|account|revenue)\b/i],
  ['marketing', /\b(marketing|cmo|brand|communications?)\b/i],
  ['operations', /\b(operations|coo|supply|logistics|manufacturing|production|plant)\b/i],
  ['procurement', /\b(procurement|purchasing|sourcing|achats?|buyer|cpo)\b/i],
  ['legal', /\b(legal|counsel|compliance|clo|juridique)\b/i],
];

export function titleFunction(title: string | null | undefined, department?: string | null): string | null {
  for (const text of [department, title]) {
    if (!text) continue;
    for (const [fn, re] of FUNCTIONS) if (re.test(text)) return fn;
  }
  return null;
}

const CEO = /\b(ceo|chief executive|managing director|president|directeur g[eé]n[eé]ral|general manager|gesch[aä]ftsf[uü]hrer)\b/i;

export const OrgSuggestionConfidence = z.enum(['low', 'medium', 'high']);
export type OrgSuggestionConfidence = z.infer<typeof OrgSuggestionConfidence>;

export const OrgChartSuggestionStatus = z.enum(['new_node', 'matches_chart', 'conflicts_chart', 'add_link']);

export const OrgChartSuggestion = z.object({
  personKey: z.string(),
  personName: z.string(),
  personTitle: z.string().nullable(),
  managerKey: z.string(),
  managerName: z.string(),
  managerTitle: z.string().nullable(),
  confidence: OrgSuggestionConfidence,
  score: z.number(),
  reasons: z.array(z.string()),
  coAttendedMeetings: z.number().int(),
  status: OrgChartSuggestionStatus,
  /** Chart node ids when the people are already on the chart. */
  personNodeId: z.string().uuid().nullable(),
  managerNodeId: z.string().uuid().nullable(),
  currentParentNodeId: z.string().uuid().nullable(),
});
export type OrgChartSuggestion = z.infer<typeof OrgChartSuggestion>;

export interface ChartPersonRef {
  nodeId: string;
  parentId: string | null;
  emails: string[];
  linkedinHandle: string | null;
  name: string;
}

const confRank: Record<OrgSuggestionConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Who probably reports to whom, from what MARS saw. Suggestions only: an
 * admin accepts them through the normal org chart move endpoint.
 *
 * Signals: the logging manager's own "reports to" note (strong), a more
 * senior person in the same function, one seniority level up, and how often
 * the two were in the same meeting. A person never gets a manager of equal or
 * lower seniority, and ties are dropped as ambiguous.
 */
export function inferReportingLines(input: {
  people: readonly MergedPerson[];
  chart?: readonly ChartPersonRef[];
  minConfidence?: OrgSuggestionConfidence;
}): OrgChartSuggestion[] {
  const people = input.people;
  const min = confRank[input.minConfidence ?? 'low'];
  const chart = input.chart ?? [];
  const nodeOf = (p: MergedPerson): ChartPersonRef | null =>
    chart.find((n) => p.emails.some((e) => n.emails.includes(e))) ??
    (p.linkedinHandle ? chart.find((n) => n.linkedinHandle === p.linkedinHandle) : undefined) ??
    (() => { const hits = chart.filter((n) => normalizePersonName(n.name) === normalizePersonName(p.name)); return hits.length === 1 ? hits[0]! : null; })();
  const fn = new Map(people.map((p) => [p.key, titleFunction(p.title, p.department)]));
  const refs = new Map(people.map((p) => [p.key, new Set(p.meetingRefs)]));
  const co = (a: MergedPerson, b: MergedPerson) => { const ra = refs.get(a.key)!; let n = 0; for (const r of refs.get(b.key)!) if (ra.has(r)) n++; return n; };
  const ceo = people.filter((p) => CEO.test(p.title ?? '') && p.seniority === 'c_level');
  const out: OrgChartSuggestion[] = [];
  for (const p of people) {
    if (CEO.test(p.title ?? '') && p.seniority === 'c_level') continue;
    const mine = seniorityRank(p.seniority);
    let best: { m: MergedPerson; score: number; reasons: string[]; co: number } | null = null;
    let tie = false;
    for (const m of people) {
      if (m.key === p.key) continue;
      const theirs = seniorityRank(m.seniority);
      let score = 0;
      const reasons: string[] = [];
      const stated =
        !!p.reportsTo &&
        ((p.reportsTo.email && m.emails.includes(p.reportsTo.email.toLowerCase())) || normalizePersonName(p.reportsTo.name) === normalizePersonName(m.name));
      if (stated) { score += 6; reasons.push('Logged in MARS as their manager'); }
      else {
        if (m.seniority === 'unknown' || p.seniority === 'unknown' || theirs >= mine) continue;
        const gap = mine - theirs;
        if (ceo.includes(m) && (p.seniority === 'c_level' || !fn.get(p.key))) { score += 2; reasons.push('Chief executive of the account'); }
        if (fn.get(p.key) && fn.get(p.key) === fn.get(m.key)) { score += 2; reasons.push(`Same function (${fn.get(p.key)})`); }
        if (gap === 1) { score += 1; reasons.push('One seniority level above'); }
        else if (gap > 2) score -= 1;
      }
      const together = co(p, m);
      if (together) { score += Math.min(3, together); reasons.push(`Met together ${together} time${together === 1 ? '' : 's'}`); }
      if (!best || score > best.score) { best = { m, score, reasons, co: together }; tie = false; }
      else if (score === best.score) tie = true;
    }
    if (!best || best.score < 2 || (tie && best.score < 6)) continue;
    const confidence: OrgSuggestionConfidence = best.score >= 6 ? 'high' : best.score >= 4 ? 'medium' : 'low';
    if (confRank[confidence] < min) continue;
    const pn = nodeOf(p);
    const mn = nodeOf(best.m);
    const status = !pn ? 'new_node' : !mn ? 'add_link' : pn.parentId === mn.nodeId ? 'matches_chart' : 'conflicts_chart';
    out.push({
      personKey: p.key,
      personName: p.name,
      personTitle: p.title,
      managerKey: best.m.key,
      managerName: best.m.name,
      managerTitle: best.m.title,
      confidence,
      score: best.score,
      reasons: best.reasons,
      coAttendedMeetings: best.co,
      status,
      personNodeId: pn?.nodeId ?? null,
      managerNodeId: mn?.nodeId ?? null,
      currentParentNodeId: pn?.parentId ?? null,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.personName.localeCompare(b.personName));
}

// ─── read-only tool surface (MCP style) ─────────────────────────────────────

export const MARS_TOOL_NAMES = ['list_meetings', 'list_contacts', 'suggest_org_chart'] as const;
export const MarsToolName = z.enum(MARS_TOOL_NAMES);
export type MarsToolName = z.infer<typeof MarsToolName>;

export const MarsToolInputs = {
  list_meetings: z.object({
    accountId: z.string().uuid(),
    since: z.string().datetime().optional(),
    source: MeetingIntelSource.optional(),
    limit: z.number().int().min(1).max(100).default(25),
  }).strict(),
  list_contacts: z.object({
    accountId: z.string().uuid(),
    windowDays: z.number().int().min(7).max(1095).default(365),
    limit: z.number().int().min(1).max(500).default(200),
  }).strict(),
  suggest_org_chart: z.object({
    accountId: z.string().uuid(),
    windowDays: z.number().int().min(30).max(1095).default(365),
    minConfidence: OrgSuggestionConfidence.default('medium'),
  }).strict(),
} as const;

const uuidProp = { type: 'string', format: 'uuid', description: 'Polo account (company) id' } as const;

/** Tool descriptors in MCP `tools/list` shape. All read-only. */
export const MARS_TOOLS = [
  {
    name: 'list_meetings',
    description: 'Meetings logged for one Polo account (MARS, ABC, Metis or manual), newest first. Only meetings the caller may read.',
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['accountId'],
      properties: {
        accountId: uuidProp,
        since: { type: 'string', format: 'date-time' },
        source: { type: 'string', enum: ['abc', 'metis', 'manual', 'mars'] },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
  },
  {
    name: 'list_contacts',
    description: 'Client people met at one account, deduplicated by email, LinkedIn, then name, with last met date and recency (recent, warm, stale).',
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['accountId'],
      properties: { accountId: uuidProp, windowDays: { type: 'integer', minimum: 7, maximum: 1095, default: 365 }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 } },
    },
  },
  {
    name: 'suggest_org_chart',
    description: 'Suggested reporting lines for one account from titles, seniority and repeated co-attendance. Suggestions only; an admin applies them in the org chart.',
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['accountId'],
      properties: {
        accountId: uuidProp,
        windowDays: { type: 'integer', minimum: 30, maximum: 1095, default: 365 },
        minConfidence: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
      },
    },
  },
] as const;

export const MarsContactOut = z.object({
  key: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  seniority: z.string(),
  department: z.string().nullable(),
  country: z.string().nullable(),
  /** Null when the caller lacks contacts:read. */
  email: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  contactId: z.string().uuid().nullable(),
  meetingCount: z.number().int(),
  firstMetAt: z.string(),
  lastMetAt: z.string(),
  recency: z.enum(['recent', 'warm', 'stale', 'never']),
});
export type MarsContactOut = z.infer<typeof MarsContactOut>;
