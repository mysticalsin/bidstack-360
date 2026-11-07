/**
 * Prisma persistence for account intelligence (slice 12). Every query is
 * scoped by org and company. Identifiers matched automatically are stored
 * without `identifiersConfirmedAt`, so they stay visibly unconfirmed; the
 * financials scan still checks the filer name before using them.
 */
import { createHash } from 'node:crypto';

import { loadCompanyIntel, prisma, type Prisma } from '@bidstack/db';
import { composeAccountIntel, type IntelSourceKey } from '@bidstack/shared';

import { completeChat, resolveLlmFromEnv, type ResolvedLlm } from '../llm-provider.js';
import { resolveOrgLlm } from '../org-llm.js';
import { runFinancialsScan } from '../financials/scan.js';
import { derived } from '../financials/xbrl.js';
import { edgarAnnualReportSection, esefSections, statementsFromSections, type FilingSection, type StatementLlm } from './filing-text.js';
import { createIntelClient, defaultIntelFetch, intelUserAgent } from './http.js';
import type { EvidenceRow, IntelIdentifiers, IntelStore, IntelSubject, PostingRow, SourceRunResult } from './run.js';

type Log = { info(o: object, m?: string): void; warn(o: object, m?: string): void };

const DAY = 86_400_000;
/** Job board postings not seen for this long are pruned. */
export const POSTING_RETENTION_DAYS = 180;
/** Company posts and evidence older than this are pruned. */
export const POST_RETENTION_DAYS = 3 * 365;
const PRUNABLE_POSTING_SOURCES = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'personio', 'careers_jsonld', 'theirstack', 'adzuna'];

const keyOf = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

const IDENTIFIER_FIELDS: Array<keyof IntelIdentifiers> = ['lei', 'secCik', 'companiesHouseNumber', 'brregOrgNumber', 'frSiren', 'careersUrl', 'atsProvider', 'atsBoard', 'newsroomUrl', 'irFeedUrl'];

async function saveEvidenceRows(s: IntelSubject, rows: EvidenceRow[]): Promise<string[]> {
  const ids: string[] = [];
  for (const r of rows) {
    const data = { label: r.label, url: r.url, excerpt: r.excerpt.slice(0, 2000), locator: r.locator, stance: r.stance ?? null, theme: r.theme ?? null, fetchedAt: r.fetchedAt, kind: r.kind };
    const row = await prisma.intelEvidence.upsert({
      where: { orgId_companyId_source_key: { orgId: s.orgId, companyId: s.companyId, source: r.source, key: r.key } },
      create: { orgId: s.orgId, companyId: s.companyId, source: r.source, key: r.key, ...data },
      update: data,
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

/** The production store. */
export function prismaIntelStore(): IntelStore {
  return {
    async loadSubject(orgId, companyId) {
      const c = await prisma.company.findFirst({ where: { id: companyId, orgId, deletedAt: null }, select: { id: true, orgId: true, name: true, legalName: true, domain: true, countryCode: true } });
      if (!c) return null;
      const w = await prisma.accountWatchSubject.findFirst({ where: { orgId, companyId } });
      const identifiers = Object.fromEntries(IDENTIFIER_FIELDS.map((k) => [k, (w?.[k] as string | null | undefined) ?? null])) as unknown as IntelIdentifiers;
      return { orgId, companyId, companyName: c.legalName || c.name, domain: c.domain?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null, countryCode: c.countryCode, identifiers };
    },

    async saveIdentifiers(s, patch, evidence) {
      const data = Object.fromEntries(Object.entries(patch).filter(([k, v]) => IDENTIFIER_FIELDS.includes(k as keyof IntelIdentifiers) && typeof v === 'string' && v));
      if (Object.keys(data).length) {
        await prisma.accountWatchSubject.upsert({
          where: { orgId_companyId: { orgId: s.orgId, companyId: s.companyId } },
          // A subject created here does not switch on the watchdog scanner.
          create: { orgId: s.orgId, companyId: s.companyId, enabled: false, ...data },
          update: data,
        });
        Object.assign(s.identifiers, data);
      }
      if (evidence.length) await saveEvidenceRows(s, evidence);
    },

    async upsertPostings(s, rows: PostingRow[]) {
      const now = new Date();
      const existing = await prisma.companyJobPosting.findMany({ where: { orgId: s.orgId, companyId: s.companyId, externalId: { in: rows.map((r) => r.externalId) } }, select: { source: true, externalId: true }, take: 1000 });
      const seen = new Set(existing.map((e) => `${e.source}|${e.externalId}`));
      let created = 0;
      for (const r of rows.slice(0, 1000)) {
        const data = { title: r.title.slice(0, 300), url: r.url, city: r.city, state: r.state, country: r.country, region: r.region, function: r.function, seniority: r.seniority, skills: r.skills, department: r.department?.slice(0, 200) ?? null, postedAt: r.postedAt, lastSeenAt: now, fetchedAt: now };
        await prisma.companyJobPosting.upsert({
          where: { orgId_companyId_source_externalId: { orgId: s.orgId, companyId: s.companyId, source: r.source, externalId: r.externalId } },
          create: { orgId: s.orgId, companyId: s.companyId, source: r.source, externalId: r.externalId, ...data },
          update: data,
        });
        if (!seen.has(`${r.source}|${r.externalId}`)) created++;
      }
      return { new: created, updated: Math.min(rows.length, 1000) - created };
    },

    async upsertPosts(s, rows) {
      const now = new Date();
      const existing = await prisma.companyPost.findMany({ where: { orgId: s.orgId, companyId: s.companyId, externalId: { in: rows.map((r) => r.externalId) } }, select: { source: true, externalId: true }, take: 1000 });
      const seen = new Set(existing.map((e) => `${e.source}|${e.externalId}`));
      let created = 0;
      for (const r of rows) {
        const data = { url: r.url, title: r.title.slice(0, 500), excerpt: r.excerpt, kind: r.kind, theme: r.theme, publishedAt: r.publishedAt, fetchedAt: now };
        await prisma.companyPost.upsert({
          where: { orgId_companyId_source_externalId: { orgId: s.orgId, companyId: s.companyId, source: r.source, externalId: r.externalId } },
          create: { orgId: s.orgId, companyId: s.companyId, source: r.source, externalId: r.externalId, ...data },
          update: data,
        });
        if (!seen.has(`${r.source}|${r.externalId}`)) created++;
      }
      return { new: created, updated: rows.length - created };
    },

    async upsertPeriods(s, source, rows) {
      let created = 0;
      const entityId = source === 'brreg' ? (s.identifiers.brregOrgNumber ?? '') : source === 'fr_rne' ? (s.identifiers.frSiren ?? '') : '';
      for (const p of rows) {
        const periodEnd = new Date(`${p.periodEnd}T00:00:00Z`);
        const where = { companyId_source_periodType_periodEnd: { companyId: s.companyId, source, periodType: p.periodType, periodEnd } };
        const had = await prisma.accountFinancialPeriod.findFirst({ where: { orgId: s.orgId, companyId: s.companyId, source, periodType: p.periodType, periodEnd }, select: { id: true } });
        const data = {
          orgId: s.orgId,
          companyId: s.companyId,
          source,
          entityId,
          periodType: p.periodType,
          fiscalYear: p.fiscalYear,
          periodStart: p.periodStart ? new Date(`${p.periodStart}T00:00:00Z`) : null,
          periodEnd,
          currency: p.currency,
          sourceUrl: p.sourceUrl,
          filedAt: p.filedAt ? new Date(p.filedAt) : null,
          metrics: { ...p.metrics, _derived: derived(p.metrics) } as unknown as Prisma.InputJsonValue,
        };
        await prisma.accountFinancialPeriod.upsert({ where, create: data, update: data });
        if (!had) created++;
      }
      return { new: created, updated: rows.length - created };
    },

    saveEvidence: saveEvidenceRows,

    async saveRegistryFacts(s, source, facts, url, fetchedAt) {
      await saveEvidenceRows(
        s,
        facts.map((f) => ({ source, kind: 'registry' as const, key: `fact:${f.label}`, label: f.label, url, excerpt: `${f.label}: ${f.value}`, locator: null, fetchedAt })),
      );
    },

    async rebuildThemes(s, now) {
      const snap = await loadCompanyIntel(prisma, s.orgId, s.companyId, now);
      if (!snap) return 0;
      const d = composeAccountIntel(snap).direction;
      const rows = [...d.investing, ...d.cutting, ...d.next12].map((t) => ({
        orgId: s.orgId,
        companyId: s.companyId,
        direction: t.direction,
        area: t.area,
        theme: t.theme,
        label: t.label,
        amount: t.amount,
        currency: t.currency,
        trendPct: t.trendPct,
        basis: t.basis,
        summary: t.summary.slice(0, 1000),
        evidenceIds: t.evidenceIds,
        computedAt: now,
      }));
      await prisma.$transaction([prisma.investmentTheme.deleteMany({ where: { orgId: s.orgId, companyId: s.companyId } }), prisma.investmentTheme.createMany({ data: rows })]);
      return rows.length;
    },

    async recordRun(s, key: IntelSourceKey, r: SourceRunResult) {
      const data = { status: r.status, lastFetchedAt: new Date(), result: { new: r.new, updated: r.updated, skipped: r.skipped, failed: r.failed }, detail: r.detail?.slice(0, 1000) ?? null };
      await prisma.intelSourceRun.upsert({
        where: { orgId_companyId_source: { orgId: s.orgId, companyId: s.companyId, source: key } },
        create: { orgId: s.orgId, companyId: s.companyId, source: key, ...data },
        update: data,
      });
    },
  };
}

async function statementLlm(orgId: string): Promise<StatementLlm | null> {
  let llm: ResolvedLlm | null;
  try {
    llm = (await resolveOrgLlm(orgId)) ?? resolveLlmFromEnv();
  } catch {
    llm = null;
  }
  if (!llm) return null;
  const resolved = llm;
  return ({ system, user }) => completeChat(resolved, { system, user, responseFormat: 'json_object', maxTokens: 1500, timeoutMs: 45_000 });
}

const FIN_STATUS: Record<string, { status: string; detail: (e: string | null) => string | null }> = {
  ok: { status: 'ok', detail: () => null },
  no_identifier: { status: 'not_configured', detail: () => 'No SEC CIK or LEI on file. Refresh Registries to match an LEI through GLEIF.' },
  mismatch: { status: 'failed', detail: (e) => e },
  error: { status: 'failed', detail: (e) => e },
  no_source: { status: 'partial', detail: () => 'No filed XBRL found for the CIK or LEI on file' },
};

/**
 * Scoped filings pull for one account, then stated priorities from the
 * latest report text (ESEF text blocks, EDGAR 10-K or 20-F).
 */
export function financialsForAccount(env: Record<string, string | undefined>, log?: Log) {
  return async (orgId: string, companyId: string): Promise<{ status: string; periods: number; detail: string | null }> => {
    const summary = await runFinancialsScan({ orgId, companyId, env, log });
    const row = summary.pulled[0];
    if (!row) return { status: 'failed', periods: 0, detail: 'Account not found' };
    const mapped = FIN_STATUS[row.status] ?? { status: 'failed', detail: (e: string | null) => e };
    let detail = mapped.detail(row.lastError ?? null);

    const ua = intelUserAgent(env);
    const sections: FilingSection[] = row.textBlocks?.length ? esefSections(row.textBlocks, row.textUrl ?? null) : [];
    if (ua && row.secCik) {
      try {
        const sec = await edgarAnnualReportSection(createIntelClient({ fetchImpl: defaultIntelFetch(60_000), userAgent: ua, minGapMs: 150 }), row.secCik);
        if (sec) sections.push(sec);
      } catch (err) {
        log?.warn({ companyId, err: (err as Error).message }, 'account intel: EDGAR annual report text failed');
      }
    }
    if (sections.length) {
      const statements = await statementsFromSections(sections, await statementLlm(orgId));
      const now = new Date();
      const source = row.source ?? (row.secCik ? 'sec_edgar' : 'esef');
      await prisma.intelEvidence.deleteMany({ where: { orgId, companyId, kind: 'statement' } });
      const s = { orgId, companyId } as IntelSubject;
      await saveEvidenceRows(
        s,
        statements.map((st) => ({ source, kind: 'statement' as const, key: `stmt:${keyOf(st.text)}`, label: st.method === 'llm' ? 'Filing text (sentence picked by LLM, quoted verbatim)' : 'Filing text', url: st.url, excerpt: st.text, locator: st.locator, stance: st.stance, theme: st.theme, fetchedAt: now })),
      );
      if (!statements.length) detail = [detail, 'No stated priorities found in the filing text'].filter(Boolean).join('; ');
    }
    return { status: mapped.status, periods: row.periods, detail };
  };
}

/** Retention: drop stale job board postings, old company posts and old evidence. */
export async function pruneAccountIntel(orgId: string, now: Date = new Date()): Promise<{ postings: number; posts: number; evidence: number }> {
  const postCut = new Date(now.getTime() - POST_RETENTION_DAYS * DAY);
  const jobCut = new Date(now.getTime() - POSTING_RETENTION_DAYS * DAY);
  const [postings, posts, evidence] = await Promise.all([
    prisma.companyJobPosting.deleteMany({ where: { orgId, source: { in: PRUNABLE_POSTING_SOURCES }, fetchedAt: { lt: jobCut } } }),
    prisma.companyPost.deleteMany({ where: { orgId, fetchedAt: { lt: postCut }, publishedAt: { lt: postCut } } }),
    prisma.intelEvidence.deleteMany({ where: { orgId, fetchedAt: { lt: postCut } } }),
  ]);
  return { postings: postings.count, posts: posts.count, evidence: evidence.count };
}
