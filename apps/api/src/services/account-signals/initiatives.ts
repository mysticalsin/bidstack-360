// Inferred initiatives (v21), shared by /initiatives and /positioning (v24).
import { prisma } from '@bidstack/db';
import {
  categoryForKind,
  cleanText,
  OFFERING_HOOKS,
  stripSamplePrefix,
  themeForText,
  type Implication,
  type Initiative,
  type InitiativeTheme,
} from '@bidstack/shared';

import type { AccessScope } from '../../lib/access-scope.js';
import { visibleMeetingWhere } from '../../meeting-intel/access.js';
import { groupMap, pageIsCapped } from './load.js';
import { companiesWithLiveSignals, hideSampleWhere } from './live-signals.js';

const DAY = 86_400_000;
const EVIDENCE_PAGE = 100;
const SOLUTION_PAGE = 1000;
const SOLUTION_LIMIT = 5000;
/** Retrieval net for a sold theme that sits past the read ceiling. Classification still uses themeForText. */
const SOLUTION_PROBES = ['cloud', 'cyber', 'security', 'analytics', 'kubernetes', 'sap', 'compliance', 'layoff', 'acquisition', 'erp'];

export function soldThemesFromSolutions(rows: readonly { name: string; category: string }[]): Set<InitiativeTheme> {
  return new Set(rows.map((row) => themeForText(`${row.category} ${row.name}`)));
}

/** Read bounded pages until a short page, or stop and say the list is capped. */
export async function readBoundedPages<T extends { id: string }>(
  load: (cursor: string | undefined) => Promise<T[]>,
  pageSize: number,
  maxRows: number,
): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await load(cursor);
    rows.push(...page);
    if (page.length < pageSize) return { rows, capped: false };
    if (rows.length >= maxRows) return { rows, capped: true };
    cursor = page[page.length - 1]!.id;
  }
}

/** True when the latest news page or the latest meeting page is not the whole year. */
export function evidencePageCapped(
  events: number,
  eventTotal: number,
  meetings: number,
  meetingTotal: number,
  limit = EVIDENCE_PAGE,
): boolean {
  return pageIsCapped(events, eventTotal, limit) || pageIsCapped(meetings, meetingTotal, limit);
}
const importanceOf = (e: { importance: number; severity: number }) =>
  e.importance || Math.min(100, e.severity * 20);

export async function loadInitiatives(
  orgId: string,
  scope: AccessScope,
  company: { id: string },
  now: Date,
  companyIds?: string[],
): Promise<{ items: Initiative[]; evidenceCapped: boolean; solutionsCapped: boolean }> {
  const ids = companyIds ?? (await groupMap(orgId, [company.id])).get(company.id) ?? [company.id];
  const live = await companiesWithLiveSignals(orgId, ids);
  const eventWhere = {
    orgId,
    companyId: { in: ids },
    status: { not: 'DISMISSED' as const },
    occurredAt: { gte: new Date(now.getTime() - 365 * DAY) },
    ...hideSampleWhere(live),
    kind: {
      in: [
        'STRATEGIC_INITIATIVE',
        'PRODUCT_LAUNCH',
        'FUNDING_ROUND',
        'PARTNERSHIP',
        'M_AND_A',
        'LAYOFFS',
        'RESTRUCTURING',
        'HIRING_SPIKE',
      ] as const,
    },
  };
  const solutionWhere = { orgId, companyId: company.id, deletedAt: null };
  const meetingWhere = {
    AND: [
      visibleMeetingWhere(orgId, scope),
      { companyId: { in: ids }, heldAt: { gte: new Date(now.getTime() - 365 * DAY) } },
    ],
  };
  const [firmo, events, solutions, meetings] = await Promise.all([
    prisma.companyFirmographics.findFirst({
      where: { orgId, companyId: company.id },
      select: { projects: true },
    }),
    prisma.accountWatchEvent.findMany({
      where: eventWhere,
      orderBy: { occurredAt: 'desc' },
      take: EVIDENCE_PAGE,
    }),
    readBoundedPages(
      (cursor) => prisma.accountSolution.findMany({
        where: solutionWhere,
        select: { id: true, name: true, category: true },
        orderBy: { id: 'asc' },
        take: SOLUTION_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      SOLUTION_PAGE,
      SOLUTION_LIMIT,
    ),
    prisma.meetingIntel.findMany({
      where: meetingWhere,
      select: { id: true, title: true, heldAt: true, opportunities: true, challenges: true },
      take: EVIDENCE_PAGE,
    }),
  ]);
  const evidenceCapped = evidencePageCapped(
    events.length,
    events.length < EVIDENCE_PAGE ? events.length : await prisma.accountWatchEvent.count({ where: eventWhere }),
    meetings.length,
    meetings.length < EVIDENCE_PAGE ? meetings.length : await prisma.meetingIntel.count({ where: meetingWhere }),
  );
  const solutionsCapped = solutions.capped;
  const soldThemes = soldThemesFromSolutions(solutions.rows);
  if (solutionsCapped) {
    const extra = await prisma.accountSolution.findMany({
      where: {
        ...solutionWhere,
        OR: SOLUTION_PROBES.flatMap((word) => [
          { name: { contains: word, mode: 'insensitive' as const } },
          { category: { contains: word, mode: 'insensitive' as const } },
        ]),
      },
      select: { name: true, category: true },
      take: 100,
    });
    for (const theme of soldThemesFromSolutions(extra)) soldThemes.add(theme);
  }
  const byTheme = new Map<InitiativeTheme, Initiative>();
  const confScore = { high: 0.85, medium: 0.6, low: 0.35 } as const;
  const label = (s: number): Initiative['confidence'] =>
    s >= 0.75 ? 'high' : s >= 0.5 ? 'medium' : 'low';
  const make = (
    theme: InitiativeTheme,
    title: string,
    rationale: string,
    score: number,
    sample: boolean,
  ): Initiative => {
    const hook = OFFERING_HOOKS[theme];
    return {
      id: `init:${theme}`,
      title,
      theme,
      themeLabel: hook.label,
      rationale,
      confidence: label(score),
      confidenceScore: score,
      firstSeen: null,
      lastSeen: null,
      evidence: [],
      hook: {
        offering: hook.offering,
        pitch: hook.pitch,
        nextStep: hook.nextStep,
        alreadySold: soldThemes.has(theme),
      },
      sample,
    };
  };
  const seen = (it: Initiative, at: string | null) => {
    if (!at) return;
    if (!it.firstSeen || at < it.firstSeen) it.firstSeen = at;
    if (!it.lastSeen || at > it.lastSeen) it.lastSeen = at;
  };
  // 1. Hiring-based potential projects (existing reverse engineering).
  const projects = Array.isArray(firmo?.projects)
    ? (firmo.projects as Array<Record<string, unknown>>)
    : [];
  for (const p of projects) {
    const name = String(p.name ?? '');
    if (!name) continue;
    const theme = themeForText(
      `${String(p.kind ?? '')} ${name} ${Array.isArray(p.skills) ? p.skills.join(' ') : ''}`,
    );
    const conf = (
      p.confidence === 'high' || p.confidence === 'medium' || p.confidence === 'low'
        ? p.confidence
        : 'low'
    ) as keyof typeof confScore;
    let it = byTheme.get(theme);
    if (!it) {
      it = make(
        theme,
        name,
        String(p.rationale ?? 'Inferred from hiring.'),
        confScore[conf],
        false,
      );
      byTheme.set(theme, it);
    } else it.confidenceScore = Math.max(it.confidenceScore, confScore[conf]);
    const ev = Array.isArray(p.evidence) ? (p.evidence as Array<Record<string, unknown>>) : [];
    for (const e of ev.slice(0, 4)) {
      const at = typeof e.postedAt === 'string' ? e.postedAt : null;
      it.evidence.push({
        kind: 'hiring',
        title: String(e.title ?? 'Job posting'),
        url: typeof e.url === 'string' ? e.url : null,
        at,
        source: String(e.source ?? 'enrichment'),
        sample: false,
      });
      seen(it, at);
    }
  }
  // 2. Announcements (news, press, provider, filings).
  for (const e of events) {
    const title = cleanText(stripSamplePrefix(e.title));
    const theme = themeForText(`${title} ${e.summary}`);
    const cat = categoryForKind(e.kind, e.implication as Implication);
    let it = byTheme.get(theme);
    const imp = importanceOf(e);
    if (!it) {
      it = make(theme, title, e.implicationRationale ?? e.summary, imp >= 70 ? 0.6 : 0.4, e.sample);
      byTheme.set(theme, it);
    } else {
      it.confidenceScore = Math.min(0.95, it.confidenceScore + 0.1);
      if (!e.sample) it.sample = false;
    }
    const kind =
      cat === 'funding'
        ? 'funding'
        : cat === 'launch'
          ? 'launch'
          : e.source === 'sec_edgar' || e.source === 'companies_house'
            ? 'filing'
            : 'news';
    const at = e.occurredAt.toISOString();
    it.evidence.push({
      kind,
      title,
      url: e.sourceUrl || null,
      at,
      source: e.source,
      sample: e.sample,
    });
    seen(it, at);
  }
  // 3. What they told us in meetings (only themes already on the board).
  for (const m of meetings) {
    for (const line of [...m.opportunities, ...m.challenges].slice(0, 6)) {
      const it = byTheme.get(themeForText(line));
      if (!it) continue;
      it.confidenceScore = Math.min(0.95, it.confidenceScore + 0.1);
      const at = m.heldAt.toISOString();
      it.evidence.push({
        kind: 'meeting',
        title: `${m.title}: ${line}`.slice(0, 200),
        url: null,
        at,
        source: 'Meeting intel',
        sample: false,
      });
      seen(it, at);
    }
  }
  const items = [...byTheme.values()]
    .map((it) => {
      const kinds = new Set(it.evidence.map((e) => e.kind));
      const score = Math.min(0.95, it.confidenceScore + (kinds.size >= 2 ? 0.1 : 0));
      return {
        ...it,
        confidenceScore: Math.round(score * 100) / 100,
        confidence: label(score),
        evidence: (() => {
          const sorted = it.evidence.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
          return sorted.slice(0, 8);
        })(),
        evidenceHidden: Math.max(0, it.evidence.length - 8),
      };
    })
    .sort(
      (a, b) =>
        b.confidenceScore - a.confidenceScore || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''),
    );
  return { items, evidenceCapped, solutionsCapped };
}
