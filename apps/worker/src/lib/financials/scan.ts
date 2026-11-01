/**
 * v23: scheduled financials pull, gated by account tier.
 *
 * Each run:
 *   1. syncs the schedule with the gate: Strategic/Top accounts (or a curated
 *      top rank, or Track financials) get a profile due now; accounts that left
 *      the gate are paused (nextPullAt = null), so a tier change starts or stops
 *      the job even without the API hook;
 *   2. pulls due accounts (oldest first, capped) from EDGAR or ESEF using the
 *      CIK / LEI set on the account, after checking the filer name;
 *   3. stores annual (and EDGAR quarterly) key lines, computes early-warning
 *      signals and writes the medium/high ones as watchdog events so they feed
 *      the momentum score, the timeline and the initiatives board;
 *   4. schedules the next pull a few days after the next earnings date on the
 *      calendar, else in 30 days.
 */
import { prisma, type Prisma } from '@bidstack/db';
import {
  categoryForKind,
  financialsEligible,
  importanceScore,
  severityFromImportance,
  type FinancialSignal,
  type Implication,
} from '@bidstack/shared';

import { RULE_KIND, detectFinancialSignals, findTextCues, type SignalPeriod } from './signals.js';
import { entityNameMatches, pacer, pullEdgar, pullEsef, SourceError, type FinFetch, type PulledEntity } from './sources.js';
import { buildPeriods, derived } from './xbrl.js';

type Db = Pick<typeof prisma, 'company' | 'accountFinancialProfile' | 'accountFinancialPeriod' | 'accountWatchSubject' | 'accountWatchEvent' | 'accountEarningsDate'>;

const DAY = 86_400_000;
export const REFRESH_DAYS = 30;
export const AFTER_EARNINGS_DAYS = 3;
export const RETRY_DAYS = 1;
export const RECHECK_DAYS = 7;

export interface FinancialsScanDeps {
  db?: Db;
  env?: Record<string, string | undefined>;
  fetchImpl?: FinFetch;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  orgId?: string;
  log?: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
}

export interface FinancialsScanSummary {
  scheduled: number;
  paused: number;
  due: number;
  pulled: Array<{ companyId: string; name: string; status: string; source: string | null; periods: number; signals: number }>;
}

const ELIGIBLE_WHERE: Prisma.CompanyWhereInput = {
  deletedAt: null,
  OR: [{ tier: { in: ['key', 'top'] } }, { topAccountRank: { not: null } }, { trackFinancials: true }],
};

/** Start or stop the schedule to match the tier gate. Exported for the API hook and tests. */
export async function syncFinancialsSchedule(db: Db, now: Date, orgId?: string): Promise<{ scheduled: number; paused: number }> {
  const org = orgId ? { orgId } : {};
  const eligible = await db.company.findMany({ where: { ...org, ...ELIGIBLE_WHERE }, select: { id: true, orgId: true }, take: 5000 });
  const ids = new Set(eligible.map((c) => c.id));
  const profiles = await db.accountFinancialProfile.findMany({ where: org, select: { companyId: true, status: true, nextPullAt: true } });
  const byCompany = new Map(profiles.map((p) => [p.companyId, p]));
  let scheduled = 0;
  for (const c of eligible) {
    const p = byCompany.get(c.id);
    if (!p) {
      await db.accountFinancialProfile.create({ data: { orgId: c.orgId, companyId: c.id, status: 'pending', nextPullAt: now } });
      scheduled++;
    } else if (p.status === 'paused' || !p.nextPullAt) {
      await db.accountFinancialProfile.update({ where: { companyId: c.id }, data: { status: 'pending', nextPullAt: now } });
      scheduled++;
    }
  }
  const stop = profiles.filter((p) => !ids.has(p.companyId) && (p.status !== 'paused' || p.nextPullAt));
  if (stop.length) {
    await db.accountFinancialProfile.updateMany({ where: { companyId: { in: stop.map((p) => p.companyId) } }, data: { status: 'paused', nextPullAt: null } });
  }
  return { scheduled, paused: stop.length };
}

async function nextPullAfter(db: Db, orgId: string, companyId: string, now: Date): Promise<Date> {
  const next = await db.accountEarningsDate.findFirst({ where: { orgId, companyId, expectedAt: { gt: now } }, orderBy: { expectedAt: 'asc' }, select: { expectedAt: true } });
  const refresh = new Date(now.getTime() + REFRESH_DAYS * DAY);
  if (!next) return refresh;
  const after = new Date(next.expectedAt.getTime() + AFTER_EARNINGS_DAYS * DAY);
  return after < refresh ? after : refresh;
}

export async function runFinancialsScan(deps: FinancialsScanDeps = {}): Promise<FinancialsScanSummary> {
  const db = deps.db ?? prisma;
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FinFetch);
  const ua = env.SEC_USER_AGENT?.trim() || env.FINANCIALS_USER_AGENT?.trim() || '';
  const max = Math.max(1, Number(env.FINANCIALS_MAX_ACCOUNTS ?? 20) || 20);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const secPace = pacer(150, sleep); // under the SEC 10 req/s cap
  const xbrlPace = pacer(1_000, sleep);

  const { scheduled, paused } = await syncFinancialsSchedule(db, now, deps.orgId);
  const due = await db.accountFinancialProfile.findMany({
    where: { ...(deps.orgId ? { orgId: deps.orgId } : {}), nextPullAt: { lte: now }, company: ELIGIBLE_WHERE },
    orderBy: [{ lastPulledAt: { sort: 'asc', nulls: 'first' } }],
    select: { orgId: true, companyId: true, company: { select: { name: true, tier: true, topAccountRank: true, trackFinancials: true } } },
    take: max,
  });
  const summary: FinancialsScanSummary = { scheduled, paused, due: due.length, pulled: [] };

  for (const d of due) {
    // Defence in depth: never pull a General account that is not opted in.
    if (!financialsEligible(d.company)) continue;
    const subject = await db.accountWatchSubject.findFirst({ where: { orgId: d.orgId, companyId: d.companyId }, select: { secCik: true, lei: true } });
    const tries: Array<() => Promise<PulledEntity>> = [];
    if (subject?.lei) tries.push(() => pullEsef(subject.lei!, { fetchImpl, userAgent: ua || 'PoloFinancials/1.0', pace: xbrlPace }));
    if (subject?.secCik) tries.push(() => pullEdgar(subject.secCik!, { fetchImpl, userAgent: ua, pace: secPace }));
    const row = { companyId: d.companyId, name: d.company.name, status: 'no_identifier', source: null as string | null, periods: 0, signals: 0 };
    if (!tries.length) {
      await db.accountFinancialProfile.update({ where: { companyId: d.companyId }, data: { status: 'no_identifier', lastPulledAt: now, nextPullAt: new Date(now.getTime() + RECHECK_DAYS * DAY), lastError: null } });
      summary.pulled.push(row);
      continue;
    }
    let status = 'no_source';
    let lastError: string | null = null;
    let used: PulledEntity | null = null;
    let periods: ReturnType<typeof buildPeriods> = [];
    for (const t of tries) {
      try {
        const e = await t();
        if (!entityNameMatches(d.company.name, e.entityName)) {
          status = 'mismatch';
          lastError = `Filer "${e.entityName}" does not match the account name`;
          used = e;
          continue;
        }
        const ps = buildPeriods(e.facts, { quarters: e.quarters });
        if (!ps.length) {
          used ??= e;
          continue;
        }
        used = e;
        periods = ps;
        status = 'ok';
        lastError = null;
        break;
      } catch (err) {
        const s = err instanceof SourceError ? err.status : 0;
        if (s === 404) continue; // not a filer there
        status = 'error';
        lastError = (err as Error).message.slice(0, 200);
        deps.log?.warn({ companyId: d.companyId, status: s }, 'financials pull failed');
      }
    }
    row.status = status;
    row.source = used?.source ?? null;
    if (status !== 'ok' || !used) {
      await db.accountFinancialProfile.update({
        where: { companyId: d.companyId },
        data: {
          status,
          lastError,
          source: used?.source ?? null,
          entityId: used?.entityId ?? null,
          entityName: used?.entityName ?? null,
          lastPulledAt: now,
          nextPullAt: new Date(now.getTime() + (status === 'error' ? RETRY_DAYS : status === 'mismatch' ? RECHECK_DAYS : REFRESH_DAYS) * DAY),
        },
      });
      summary.pulled.push(row);
      continue;
    }
    const keep = [...periods.filter((p) => p.periodType === 'FY').slice(0, 5), ...periods.filter((p) => p.periodType === 'Q').slice(0, 8)];
    const withUrl: SignalPeriod[] = keep.map((p) => ({ ...p, sourceUrl: used!.urlFor(p.periodEnd) }));
    for (const p of withUrl) {
      const data = {
        orgId: d.orgId,
        companyId: d.companyId,
        source: used.source,
        entityId: used.entityId,
        periodType: p.periodType,
        fiscalYear: p.fiscalYear,
        periodStart: p.periodStart ? new Date(`${p.periodStart}T00:00:00Z`) : null,
        periodEnd: new Date(`${p.periodEnd}T00:00:00Z`),
        currency: p.currency,
        sourceUrl: p.sourceUrl,
        filedAt: p.filedAt ? new Date(p.filedAt) : null,
        metrics: { ...p.metrics, _derived: derived(p.metrics) } as unknown as Prisma.InputJsonValue,
      };
      await db.accountFinancialPeriod.upsert({
        where: { companyId_source_periodType_periodEnd: { companyId: d.companyId, source: used.source, periodType: p.periodType, periodEnd: data.periodEnd } },
        create: data,
        update: data,
      });
    }
    const cues = findTextCues(used.textBlocks);
    const signals = detectFinancialSignals(withUrl, cues, used.textUrl ?? undefined);
    await writeSignalEvents(db, d.orgId, d.companyId, d.company.name, signals, withUrl);
    await db.accountFinancialProfile.update({
      where: { companyId: d.companyId },
      data: {
        status: 'ok',
        lastError: null,
        source: used.source,
        entityId: used.entityId,
        entityName: used.entityName,
        lastPulledAt: now,
        nextPullAt: await nextPullAfter(db, d.orgId, d.companyId, now),
        signals: signals as unknown as Prisma.InputJsonValue,
      },
    });
    row.periods = withUrl.length;
    row.signals = signals.length;
    summary.pulled.push(row);
  }
  return summary;
}

/** Medium and high confidence signals become watchdog events (deduped by rule and period). */
export async function writeSignalEvents(db: Db, orgId: string, companyId: string, companyName: string, signals: FinancialSignal[], periods: SignalPeriod[]) {
  for (const s of signals) {
    if (s.confidence === 'low') continue;
    const { kind, implication } = RULE_KIND[s.rule];
    const p = periods.find((x) => x.periodEnd === s.periodEnd);
    const occurredAt = p?.filedAt ? new Date(p.filedAt) : new Date(`${s.periodEnd}T00:00:00Z`);
    const importance = importanceScore({ kind, implication: implication as Implication, source: 'financials' }) - (s.confidence === 'medium' ? 10 : 0);
    const data = {
      orgId,
      companyId,
      source: 'financials',
      externalId: s.id,
      kind: kind as Prisma.AccountWatchEventCreateInput['kind'],
      occurredAt,
      title: `${companyName}: ${s.title}`,
      sourceUrl: s.sourceUrl,
      summary: s.explanation,
      implication: implication as Implication,
      implicationRationale: `From filed financials (${s.confidence} confidence).`,
      severity: severityFromImportance(importance),
      confirmed: true,
      importance,
      sentiment: implication === 'RISK' ? -0.4 : implication === 'OPPORTUNITY' ? 0.4 : 0,
      payload: { rule: s.rule, confidence: s.confidence, category: categoryForKind(kind, implication as Implication), periodEnd: s.periodEnd } as Prisma.InputJsonValue,
    };
    const existing = await db.accountWatchEvent.findFirst({ where: { orgId, source: 'financials', externalId: s.id }, select: { id: true } });
    if (existing) {
      await db.accountWatchEvent.update({ where: { id: existing.id }, data: { title: data.title, summary: data.summary, sourceUrl: data.sourceUrl, importance, severity: data.severity, payload: data.payload } });
    } else {
      await db.accountWatchEvent.create({ data });
    }
  }
}
