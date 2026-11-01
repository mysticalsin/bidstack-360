/**
 * Sample watchdog signals for the demo accounts (v21), so the account pulse,
 * signals timeline, initiatives board and portfolio view look alive before
 * any news source is configured. Every row is sample=true, source 'sample',
 * title prefixed "Sample: " and carries no source URL; the UI shows a Sample
 * badge. Dates are relative to the run, so re-running refreshes them.
 *
 * Idempotent: upserts on (orgId, 'sample', externalId). Matches accounts by
 * name in every org of the target database. Never touches non-sample rows.
 *
 *   DATABASE_URL=... pnpm --filter @bidstack/db seed:signals
 *   DATABASE_URL=... pnpm --filter @bidstack/db seed:signals -- --remove
 */
import { PrismaClient } from '../generated/client/index.js';

import { classifySignalText, importanceScore, oneLine, severityFromImportance, signalDedupeKey } from '@bidstack/shared';

interface SampleSignal {
  slug: string;
  daysAgo: number;
  title: string;
  summary: string;
}

export const SAMPLE_SIGNALS: Record<string, SampleSignal[]> = {
  'CI Financial': [
    { slug: 'ci-q3', daysAgo: 6, title: 'CI Financial third-quarter profit rose 12% on record assets', summary: 'Assets under management reached a record; US wealth drove most of the growth.' },
    { slug: 'ci-advice', daysAgo: 9, title: 'CI Financial launches new digital advice platform for advisors', summary: 'A single workspace for planning, onboarding and portfolio reviews, rolling out to Canadian advisors first.' },
    { slug: 'ci-cdo', daysAgo: 21, title: 'CI Financial appoints new chief data officer', summary: 'The new CDO will lead the data platform and analytics programme across Canada and the US.' },
    { slug: 'ci-ria', daysAgo: 35, title: 'CI Financial to acquire regional US wealth firm', summary: 'Adds about 40 advisors in the Midwest; integration planned over the next two quarters.' },
    { slug: 'ci-cloud', daysAgo: 52, title: 'CI Financial announces cloud modernisation programme', summary: 'Multi-year programme to move core wealth systems to the cloud and retire two data centres.' },
  ],
  'DNB Bank': [
    { slug: 'dnb-q3', daysAgo: 8, title: 'DNB Bank quarterly results beat estimates', summary: 'Net interest income ahead of consensus; cost programme on track.' },
    { slug: 'dnb-ai', daysAgo: 12, title: 'DNB Bank partners with Microsoft on AI for customer service', summary: 'Generative AI assistants for retail customer service, pilot in Norway from Q1.' },
    { slug: 'dnb-aml', daysAgo: 18, title: 'DNB Bank fined by regulator over anti-money laundering controls', summary: 'The supervisor asks for a remediation plan on transaction monitoring within six months.' },
    { slug: 'dnb-hub', daysAgo: 41, title: 'DNB opens new technology hub in Oslo', summary: 'Room for 600 engineers working on payments, data and security.' },
  ],
  'Example Corp': [
    { slug: 'ex-cuts', daysAgo: 10, title: 'Example Corp announces 300 job cuts in restructuring', summary: 'Cuts focus on back-office functions; the company keeps its product investment plans.' },
    { slug: 'ex-cfo', daysAgo: 25, title: 'Example Corp CFO steps down', summary: 'An interim CFO takes over while the board runs a search.' },
    { slug: 'ex-series', daysAgo: 150, title: 'Example Corp raises $40M Series C', summary: 'Funding earmarked for international expansion and the data platform.' },
  ],
  MAHLE: [
    { slug: 'mahle-ev', daysAgo: 14, title: 'MAHLE launches new thermal management system for electric vehicles', summary: 'Series production starts next year with two European OEMs.' },
    { slug: 'mahle-cuts', daysAgo: 60, title: 'MAHLE to cut 1,000 jobs in Germany', summary: 'Restructuring of combustion engine components; electrification teams keep growing.' },
  ],
  MAPFRE: [{ slug: 'mapfre-ai', daysAgo: 16, title: 'MAPFRE invests in data and AI programme for claims', summary: 'Group-wide programme to automate claims triage with machine learning.' }],
  Aritzia: [{ slug: 'aritzia-us', daysAgo: 11, title: 'Aritzia opens new boutiques in the US as expansion accelerates', summary: 'Ten new US boutiques planned this fiscal year; ecommerce up 20%.' }],
  NOS: [{ slug: 'nos-5g', daysAgo: 19, title: 'NOS partners with Ericsson on 5G standalone network', summary: 'Network slicing for enterprise customers from next year.' }],
  'Logistec Corporation': [{ slug: 'logistec-ma', daysAgo: 70, title: 'Logistec Corporation acquired by private equity consortium', summary: 'The new owners plan to invest in terminal automation.' }],
  'Rush University System for Health': [{ slug: 'rush-app', daysAgo: 23, title: 'Rush University System for Health launches new patient app', summary: 'Scheduling, results and virtual visits in one app.' }],
};

const DAY = 86_400_000;

/**
 * Public identifiers for the demo accounts that are real companies (v22), so
 * the live news watchdog can verify stories by website or ticker. Fills empty
 * fields only and never overwrites what a person entered. Private or delisted
 * companies (MAHLE, Logistec since 2024, Mantu) get the website only.
 */
export const PUBLIC_IDENTIFIERS: Record<string, { domain: string; ticker?: string; exchange?: string }> = {
  Aritzia: { domain: 'aritzia.com', ticker: 'ATZ', exchange: 'TSX' },
  'CI Financial': { domain: 'ci.com', ticker: 'CIX', exchange: 'TSX' },
  'DNB Bank': { domain: 'dnb.no', ticker: 'DNB', exchange: 'OSE' },
  MAPFRE: { domain: 'mapfre.com', ticker: 'MAP', exchange: 'BME' },
  NOS: { domain: 'nos.pt', ticker: 'NOS', exchange: 'ELI' },
  MAHLE: { domain: 'mahle.com' },
  'Logistec Corporation': { domain: 'logistec.com' },
  'Rush University System for Health': { domain: 'rush.edu' },
};

export async function seedPublicIdentifiers(prisma: PrismaClient, now: Date = new Date()): Promise<{ domains: number; tickers: number }> {
  let domains = 0;
  let tickers = 0;
  for (const [name, ids] of Object.entries(PUBLIC_IDENTIFIERS)) {
    const companies = await prisma.company.findMany({ where: { name, deletedAt: null }, select: { id: true, orgId: true, domain: true } });
    for (const c of companies) {
      if (!c.domain) {
        await prisma.company.update({ where: { id: c.id }, data: { domain: ids.domain } });
        domains++;
      }
      if (!ids.ticker) continue;
      const sub = await prisma.accountWatchSubject.findUnique({ where: { orgId_companyId: { orgId: c.orgId, companyId: c.id } } });
      if (!sub) {
        await prisma.accountWatchSubject.create({ data: { orgId: c.orgId, companyId: c.id, ticker: ids.ticker, exchange: ids.exchange ?? null, identifiersConfirmedAt: now } });
        tickers++;
      } else if (!sub.ticker) {
        await prisma.accountWatchSubject.update({ where: { id: sub.id }, data: { ticker: ids.ticker, exchange: sub.exchange ?? ids.exchange ?? null, identifiersConfirmedAt: sub.identifiersConfirmedAt ?? now } });
        tickers++;
      }
    }
  }
  return { domains, tickers };
}

/**
 * v23: filer identifiers for the financials pull (LEI for ESEF, CIK for SEC
 * EDGAR), checked against the filer name on filings.xbrl.org and EDGAR. Pulls
 * only ever use these ids, never a name search, so namesakes (MAPFRE MALTA,
 * RUSH ENTERPRISES) cannot leak in. Fills empty fields only.
 * Aritzia has no XBRL filings (its ADR CIK only files F-6), Rush is a private
 * health system, MAHLE, Logistec and Mantu do not file XBRL.
 */
export const FILER_IDENTIFIERS: Record<string, { lei?: string; secCik?: string }> = {
  'DNB Bank': { lei: '549300GKFG0RYRRQ1414' },
  MAPFRE: { lei: '95980020140005693107' },
  NOS: { lei: '5493004DM8FGIY6QKF37' },
  'CI Financial': { secCik: '0001829948' },
};

/**
 * v23 demo tiers: the financials pull runs for Strategic (key) and Top
 * accounts. Applied only while the account has no financials profile yet, so a
 * re-seed never undoes an Admin's tier edit.
 */
export const DEMO_TIERS: Record<string, 'key' | 'top'> = {
  Aritzia: 'top',
  MAPFRE: 'top',
  NOS: 'top',
};

export async function seedFinancialsSetup(prisma: PrismaClient, now: Date = new Date()): Promise<{ identifiers: number; tiers: number }> {
  let identifiers = 0;
  let tiers = 0;
  for (const [name, ids] of Object.entries(FILER_IDENTIFIERS)) {
    const companies = await prisma.company.findMany({ where: { name, deletedAt: null }, select: { id: true, orgId: true } });
    for (const c of companies) {
      const sub = await prisma.accountWatchSubject.findUnique({ where: { orgId_companyId: { orgId: c.orgId, companyId: c.id } } });
      if (!sub) {
        await prisma.accountWatchSubject.create({ data: { orgId: c.orgId, companyId: c.id, lei: ids.lei ?? null, secCik: ids.secCik ?? null, identifiersConfirmedAt: now } });
        identifiers++;
        continue;
      }
      const data: { lei?: string; secCik?: string } = {};
      if (ids.lei && !sub.lei) data.lei = ids.lei;
      if (ids.secCik && !sub.secCik) data.secCik = ids.secCik;
      if (Object.keys(data).length) {
        await prisma.accountWatchSubject.update({ where: { id: sub.id }, data });
        identifiers++;
      }
    }
  }
  for (const [name, tier] of Object.entries(DEMO_TIERS)) {
    const companies = await prisma.company.findMany({ where: { name, deletedAt: null, financialProfile: null, tier: 'standard' }, select: { id: true } });
    for (const c of companies) {
      await prisma.company.update({ where: { id: c.id }, data: { tier } });
      tiers++;
    }
  }
  return { identifiers, tiers };
}

export async function seedSampleSignals(prisma: PrismaClient, opts: { now?: Date; remove?: boolean } = {}): Promise<{ upserted: number; removed: number }> {
  const now = opts.now ?? new Date();
  if (opts.remove) {
    const r = await prisma.accountWatchEvent.deleteMany({ where: { source: 'sample', sample: true } });
    return { upserted: 0, removed: r.count };
  }
  let upserted = 0;
  for (const [name, signals] of Object.entries(SAMPLE_SIGNALS)) {
    const companies = await prisma.company.findMany({ where: { name, deletedAt: null }, select: { id: true, orgId: true } });
    for (const c of companies) {
      for (const s of signals) {
        const cls = classifySignalText(s.title, s.summary);
        const importance = importanceScore({ kind: cls.kind, implication: cls.implication, source: 'sample' });
        const data = {
          kind: cls.kind,
          occurredAt: new Date(now.getTime() - s.daysAgo * DAY),
          title: `Sample: ${s.title}`,
          sourceUrl: '',
          summary: oneLine(s.summary),
          implication: cls.implication,
          implicationRationale: `Sample data. Classified by ${cls.rule}.`,
          severity: severityFromImportance(importance),
          importance,
          sentiment: cls.sentiment,
          dedupeKey: signalDedupeKey(cls.kind, s.title, name),
          sample: true,
          confirmed: false,
          payload: { sample: true, category: cls.category },
        };
        await prisma.accountWatchEvent.upsert({
          where: { orgId_source_externalId: { orgId: c.orgId, source: 'sample', externalId: `sample:${s.slug}:${c.id}` } },
          create: { orgId: c.orgId, companyId: c.id, source: 'sample', externalId: `sample:${s.slug}:${c.id}`, ...data },
          update: data,
        });
        upserted++;
      }
    }
  }
  return { upserted, removed: 0 };
}

const isMain = process.argv[1] && /seed-signals\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  const prisma = new PrismaClient();
  const remove = process.argv.includes('--remove');
  seedSampleSignals(prisma, { remove })
    .then(async (r) => {
      process.stdout.write(`sample signals: ${r.upserted} upserted, ${r.removed} removed\n`);
      if (!remove) {
        const ids = await seedPublicIdentifiers(prisma);
        process.stdout.write(`public identifiers: ${ids.domains} domains, ${ids.tickers} tickers set\n`);
        const fin = await seedFinancialsSetup(prisma);
        process.stdout.write(`financials: ${fin.identifiers} filer ids set, ${fin.tiers} demo tiers set\n`);
      }
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
