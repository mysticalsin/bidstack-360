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
  seedSampleSignals(prisma, { remove: process.argv.includes('--remove') })
    .then((r) => {
      process.stdout.write(`sample signals: ${r.upserted} upserted, ${r.removed} removed\n`);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
