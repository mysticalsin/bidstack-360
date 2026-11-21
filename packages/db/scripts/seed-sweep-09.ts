/**
 * Dev-only generator for sweep 09: empty, huge, and mixed-currency orgs.
 *
 * Refuses NODE_ENV=production and POLO_DATA_MODE=real. No new dependencies:
 * Prisma for the tenant shell, psql COPY for the bulk rows.
 *
 *   pnpm db:seed:sweep09
 *
 * Prints one line, SWEEP09_MANIFEST {json}, with the counts and the figures
 * the dashboard, revenue, margin, and open-jobs reads should match.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import dotenvFlow from 'dotenv-flow';

import { PrismaClient } from '../generated/client/index.js';
import { seedRolesAndPermissions } from '../src/seed.rbac.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

const EMPTY_CLERK = 'org_sweep09_empty';
const HUGE_CLERK = 'org_sweep09_huge';
const FX_CLERK = 'org_sweep09_fx';

const ACCOUNT_COUNT = 20_000;
const OPP_COUNT = 50_000;
const TASK_COUNT = 100_000;

const STAGES = [
  's1_lead',
  's1_ongoing',
  's2_sent',
  's3_technical_iteration',
  's4_negotiation',
  'closed_won',
  'closed_lost',
] as const;

const OPEN_STAGES = new Set<string>(STAGES.slice(0, 5));

const LONG_NAME = `${'Northwind International '.repeat(12)}Holdings`.slice(0, 220);

function refuseProduction(): void {
  if (process.env.NODE_ENV === 'production' || process.env.POLO_DATA_MODE === 'real') {
    console.error(
      'Refusing sweep 09 seed: this generator writes synthetic tenants and is dev-only.',
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
}

function amountMicros(i: number): bigint {
  const band = i % 1000;
  if (band === 0) return 0n;
  if (band === 1) return -1_500_000n;
  if (band === 2) return -9_000_000_000_000n;
  if (band === 3) return 9_007_199_254_740_991n;
  if (band === 4) return 50_000_000_000_000_000n;
  if (band === 5) return 1n;
  return BigInt((i % 97) + 1) * 1_000_000n;
}

function dueDate(i: number): string | null {
  const band = i % 100;
  if (band === 7) return null;
  if (band === 8) return '9999-12-31';
  if (band === 9) return '0001-01-01';
  if (band < 30) return '2020-01-15';
  if (band < 40) return '2026-11-21';
  return '2027-06-15';
}

function accountName(i: number): string {
  if (i === 0) return 'Sweep Sentinel';
  const kind = i % 20;
  if (kind === 1) return `🚀 ${LONG_NAME} ${i}`;
  if (kind === 2) return `شركة الأفق ${i} للتجارة`;
  if (kind === 3) return `北京远景科技有限公司 ${i}`;
  if (kind === 4) return `ООО «Северсталь-Трейд» ${i}`;
  if (kind === 5) return `חברת אופק ${i}`;
  if (kind === 6) return `株式会社東京エッジ ${i}`;
  if (kind === 7) return `Société Générale Présales ${i}`;
  return `Account ${String(i).padStart(5, '0')}`;
}

function oppName(i: number): string {
  if (i === 0) return 'Sentinel renewal';
  const kind = i % 20;
  if (kind === 1) return `🚢 ${LONG_NAME} bid ${i}`;
  if (kind === 2) return `فرصة ${i} للمناقصة`;
  if (kind === 3) return `投标项目 ${i}`;
  if (kind === 5) return `הזדמנות ${i}`;
  return `Opportunity ${String(i).padStart(6, '0')}`;
}

function taskTitle(i: number): string {
  const kind = i % 20;
  if (kind === 1) return `📌 ${LONG_NAME} follow-up ${i}`;
  if (kind === 2) return `مهمة متابعة ${i}`;
  if (kind === 3) return `跟进任务 ${i}`;
  if (kind === 5) return `משימה ${i}`;
  return `Task ${String(i).padStart(6, '0')}`;
}

function taskStatus(i: number): string {
  return ['open', 'in_progress', 'done', 'blocked'][i % 4]!;
}

/** Postgres COPY text format. Null is \\N. */
function copyField(value: string | number | boolean | null): string {
  if (value === null) return '\\N';
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
}

function copyLine(fields: Array<string | number | boolean | null>): string {
  return fields.map(copyField).join('\t');
}

function writeChunk(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
  if (stream.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => stream.once('drain', resolve));
}

async function copyRows(
  databaseUrl: string,
  statement: string,
  rows: AsyncIterable<string> | Iterable<string>,
): Promise<void> {
  const child = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-q'], {
    stdio: ['pipe', 'inherit', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (buf: Buffer) => {
    stderr += buf.toString();
  });
  child.stdin.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') stderr += err.message;
  });
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exited ${code}: ${stderr}`));
    });
  });
  const stdin = child.stdin;
  if (!stdin) throw new Error('psql stdin missing');
  await writeChunk(stdin, statement.trimEnd().endsWith(';') ? `${statement}\n` : `${statement};\n`);
  let batch = '';
  let n = 0;
  for await (const row of rows) {
    batch += `${row}\n`;
    n += 1;
    if (n % 5000 === 0) {
      await writeChunk(stdin, batch);
      batch = '';
    }
  }
  if (batch) await writeChunk(stdin, batch);
  await writeChunk(stdin, '\\.\n');
  stdin.end();
  await done;
}

function* count(n: number): Generator<number> {
  for (let i = 0; i < n; i += 1) yield i;
}

interface MoneyTotals {
  openMicros: bigint;
  openCount: number;
  wonMicros: bigint;
  wonCount: number;
  lostCount: number;
  zeroCount: number;
  negativeCount: number;
  nullDueCount: number;
  farFutureCount: number;
}

function emptyTotals(): MoneyTotals {
  return {
    openMicros: 0n,
    openCount: 0,
    wonMicros: 0n,
    wonCount: 0,
    lostCount: 0,
    zeroCount: 0,
    negativeCount: 0,
    nullDueCount: 0,
    farFutureCount: 0,
  };
}

function noteOpp(totals: MoneyTotals, stage: string, micros: bigint, due: string | null): void {
  if (micros === 0n) totals.zeroCount += 1;
  if (micros < 0n) totals.negativeCount += 1;
  if (due === null) totals.nullDueCount += 1;
  if (due === '9999-12-31') totals.farFutureCount += 1;
  if (OPEN_STAGES.has(stage)) {
    totals.openCount += 1;
    totals.openMicros += micros;
  } else if (stage === 'closed_won') {
    totals.wonCount += 1;
    totals.wonMicros += micros;
  } else if (stage === 'closed_lost') {
    totals.lostCount += 1;
  }
}

interface Filing {
  fiscalYear: number;
  periodEnd: string;
  currency: string;
  revenue: number;
  operatingIncome: number;
  /** Stored on the row. Null when revenue is not positive, matching derived(). */
  operatingMargin: number | null;
}

function marginOf(revenue: number, operatingIncome: number): number | null {
  if (!(revenue > 0) || operatingIncome === undefined) return null;
  return Math.round((operatingIncome / revenue) * 1000) / 10;
}

function metricsJson(filing: Filing): string {
  return JSON.stringify({
    revenue: { value: filing.revenue, concept: 'ifrs-full:Revenue' },
    operatingIncome: { value: filing.operatingIncome, concept: 'ifrs-full:OperatingIncome' },
    _derived: {
      operatingMargin: filing.operatingMargin,
      netMargin: null,
      freeCashFlow: null,
    },
  });
}

async function main(): Promise<void> {
  refuseProduction();
  const databaseUrl = process.env.DATABASE_URL!;
  const prisma = new PrismaClient();
  const now = new Date().toISOString();

  if (LONG_NAME.length < 200) throw new Error(`long name is ${LONG_NAME.length} chars`);

  console.log('Sweep 09 seed: replacing synthetic orgs…');
  await prisma.org.deleteMany({
    where: { clerkOrg: { in: [EMPTY_CLERK, HUGE_CLERK, FX_CLERK] } },
  });

  const empty = await prisma.org.create({
    data: { clerkOrg: EMPTY_CLERK, name: 'Sweep 09 Empty' },
  });
  const huge = await prisma.org.create({
    data: { clerkOrg: HUGE_CLERK, name: 'Sweep 09 Huge' },
  });
  const fx = await prisma.org.create({
    data: { clerkOrg: FX_CLERK, name: 'Sweep 09 Mixed currencies' },
  });

  async function admin(orgId: string, slug: string, name: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        orgId,
        clerkUser: `sweep09_${slug}`,
        email: `sweep09-${slug}@bidstack.test`,
        name,
        role: 'admin',
      },
    });
    await seedRolesAndPermissions(prisma, orgId, new Map([['JS', user.id]]));
    return user.id;
  }

  await admin(empty.id, 'empty', 'Empty Org Admin');
  await admin(huge.id, 'huge', 'Huge Org Admin');
  await admin(fx.id, 'fx', 'Mixed Currency Admin');

  await prisma.orgSettings.createMany({
    data: [
      { orgId: empty.id, defaultCurrency: 'USD', timezone: 'America/Toronto' },
      { orgId: huge.id, defaultCurrency: 'EUR', timezone: 'America/Toronto' },
      { orgId: fx.id, defaultCurrency: 'CAD', timezone: 'America/Toronto' },
    ],
  });

  const companyIds = Array.from({ length: ACCOUNT_COUNT }, () => randomUUID());
  const oppIds = Array.from({ length: OPP_COUNT }, () => randomUUID());
  const sentinelId = companyIds[0]!;
  const hugeTotals = emptyTotals();

  console.log(`  copying ${ACCOUNT_COUNT} accounts…`);
  await copyRows(
    databaseUrl,
    'COPY companies (id, org_id, name, industry, country_code, tier, track_financials, employee_count, source, updated_at) FROM STDIN',
    (function* () {
      for (const i of count(ACCOUNT_COUNT)) {
        const tier = i === 0 ? 'key' : i % 50 === 0 ? 'top' : 'standard';
        yield copyLine([
          companyIds[i]!,
          huge.id,
          accountName(i),
          i % 3 === 0 ? 'Software' : i % 3 === 1 ? 'Energy' : 'Healthcare',
          i % 2 === 0 ? 'FR' : 'JP',
          tier,
          i === 0,
          i === 0 ? 4200 : null,
          'manual',
          now,
        ]);
      }
    })(),
  );

  console.log(`  copying ${OPP_COUNT} opportunities…`);
  await copyRows(
    databaseUrl,
    'COPY opportunities (id, org_id, code, customer, company_id, name, stage, value_micros, probability, due_date, industry, country, updated_at) FROM STDIN',
    (function* () {
      for (const i of count(OPP_COUNT)) {
        const companyIndex = i % ACCOUNT_COUNT;
        let stage: string = STAGES[i % STAGES.length]!;
        let micros = amountMicros(i);
        let due = dueDate(i);
        let name = oppName(i);
        if (i === 0) {
          stage = 'closed_won';
          micros = 2_500_000_000_000n;
          due = '2026-03-31';
          name = 'Sentinel renewal';
        } else if (i === 20_000) {
          stage = 's2_sent';
          micros = 1_000_000_000_000n;
          due = '9999-12-31';
          name = 'Sentinel far-future bid';
        } else if (i === 40_000) {
          stage = 'closed_won';
          micros = -500_000_000n;
          due = '2026-06-30';
          name = 'Sentinel credit';
        }
        noteOpp(hugeTotals, stage, micros, due);
        yield copyLine([
          oppIds[i]!,
          huge.id,
          `SW-${String(i).padStart(6, '0')}`,
          accountName(companyIndex),
          companyIds[companyIndex]!,
          name,
          stage,
          micros.toString(),
          i % 101,
          due,
          'Software',
          'FR',
          now,
        ]);
      }
    })(),
  );

  let nullTaskDates = 0;
  let farFutureTasks = 0;
  let openTasks = 0;
  let overdueTasks = 0;
  console.log(`  copying ${TASK_COUNT} tasks…`);
  await copyRows(
    databaseUrl,
    'COPY tasks (id, org_id, opp_id, account_id, title, due_date, status) FROM STDIN',
    (function* () {
      for (const i of count(TASK_COUNT)) {
        const due = dueDate(i);
        const status = taskStatus(i);
        if (due === null) nullTaskDates += 1;
        if (due === '9999-12-31') farFutureTasks += 1;
        if (status !== 'done') openTasks += 1;
        if (status !== 'done' && due !== null && due < '2026-11-21') overdueTasks += 1;
        const oppIndex = i % OPP_COUNT;
        yield copyLine([
          randomUUID(),
          huge.id,
          i % 5 === 0 ? null : oppIds[oppIndex]!,
          companyIds[oppIndex % ACCOUNT_COUNT]!,
          taskTitle(i),
          due,
          status,
        ]);
      }
    })(),
  );

  const filing = (partial: Omit<Filing, 'operatingMargin'>): Filing => ({
    ...partial,
    operatingMargin: marginOf(partial.revenue, partial.operatingIncome),
  });
  const sentinelFilings = [
    filing({
      fiscalYear: 2023,
      periodEnd: '2023-12-31',
      currency: 'EUR',
      revenue: 1_500_000_000,
      operatingIncome: 286_500_000,
    }),
    filing({
      fiscalYear: 2024,
      periodEnd: '2024-12-31',
      currency: 'EUR',
      revenue: 1_700_000_000,
      operatingIncome: 306_000_000,
    }),
  ];

  await copyRows(
    databaseUrl,
    'COPY account_financial_profiles (id, org_id, company_id, source, entity_id, entity_name, status, last_pulled_at, updated_at) FROM STDIN',
    [
      copyLine([
        randomUUID(),
        huge.id,
        sentinelId,
        'esef',
        'LEI-SWEEP-SENTINEL',
        'Sweep Sentinel',
        'ok',
        now,
        now,
      ]),
    ],
  );
  await copyRows(
    databaseUrl,
    'COPY account_financial_periods (id, org_id, company_id, source, entity_id, period_type, fiscal_year, period_end, currency, source_url, metrics, updated_at) FROM STDIN',
    sentinelFilings.map((row) =>
      copyLine([
        randomUUID(),
        huge.id,
        sentinelId,
        'esef',
        'LEI-SWEEP-SENTINEL',
        'FY',
        row.fiscalYear,
        row.periodEnd,
        row.currency,
        'https://example.test/sweep09/sentinel',
        metricsJson(row),
        now,
      ]),
    ),
  );
  await copyRows(
    databaseUrl,
    'COPY company_firmographics (id, org_id, company_id, status, annual_revenue_usd, employee_count, industry, fetched_at, updated_at) FROM STDIN',
    [
      copyLine([
        randomUUID(),
        huge.id,
        sentinelId,
        'ok',
        '125000000000',
        4200,
        'Software',
        now,
        now,
      ]),
    ],
  );

  const seen = new Date().toISOString();
  const stale = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  const ancient = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const jobRows: string[] = [];
  for (let n = 0; n < 4; n += 1) {
    jobRows.push(
      copyLine([
        randomUUID(),
        huge.id,
        sentinelId,
        'greenhouse',
        `open-${n}`,
        `Open role ${n}`,
        'emea',
        'engineering',
        'mid',
        seen,
        seen,
        seen,
      ]),
    );
  }
  for (let n = 0; n < 2; n += 1) {
    jobRows.push(
      copyLine([
        randomUUID(),
        huge.id,
        sentinelId,
        'greenhouse',
        `stale-${n}`,
        `Stale role ${n}`,
        'emea',
        'engineering',
        'mid',
        stale,
        stale,
        seen,
      ]),
    );
  }
  jobRows.push(
    copyLine([
      randomUUID(),
      huge.id,
      sentinelId,
      'greenhouse',
      'ancient-0',
      'Ancient role',
      'emea',
      'engineering',
      'mid',
      ancient,
      ancient,
      seen,
    ]),
  );
  await copyRows(
    databaseUrl,
    'COPY company_job_postings (id, org_id, company_id, source, external_id, title, region, function, seniority, posted_at, last_seen_at, fetched_at) FROM STDIN',
    jobRows,
  );

  // Mixed currencies: filings keep their own currency. Deals have no currency column.
  const fxCompanies = [
    { name: 'Helvetia Mixed', currencyHint: 'USD+EUR' },
    { name: 'Zero Books Ltd', currencyHint: 'GBP' },
    { name: 'Negative Ledger SA', currencyHint: 'CHF' },
    { name: '円巨大商事', currencyHint: 'JPY' },
    { name: 'Exact Dollar Holdings', currencyHint: 'USD' },
    { name: 'Provider Only USD', currencyHint: 'USD' },
    { name: 'شركة الميزان', currencyHint: 'CAD' },
    { name: `🚀 ${LONG_NAME} FX`, currencyHint: 'EUR' },
  ];
  const fxCompanyIds = fxCompanies.map(() => randomUUID());
  await copyRows(
    databaseUrl,
    'COPY companies (id, org_id, name, industry, country_code, tier, track_financials, source, updated_at) FROM STDIN',
    fxCompanies.map((company, i) =>
      copyLine([
        fxCompanyIds[i]!,
        fx.id,
        company.name,
        'Software',
        'CA',
        'key',
        true,
        'manual',
        now,
      ]),
    ),
  );

  const fxFilings: Array<{ companyIndex: number; filing: Filing }> = [
    {
      companyIndex: 0,
      filing: filing({
        fiscalYear: 2023,
        periodEnd: '2023-12-31',
        currency: 'USD',
        revenue: 10_000_000,
        operatingIncome: 1_200_000,
      }),
    },
    {
      companyIndex: 0,
      filing: filing({
        fiscalYear: 2024,
        periodEnd: '2024-12-31',
        currency: 'EUR',
        revenue: 8_000_000,
        operatingIncome: 800_000,
      }),
    },
    {
      companyIndex: 1,
      filing: filing({
        fiscalYear: 2024,
        periodEnd: '2024-12-31',
        currency: 'GBP',
        revenue: 0,
        operatingIncome: 0,
      }),
    },
    {
      companyIndex: 2,
      filing: filing({
        fiscalYear: 2024,
        periodEnd: '2024-12-31',
        currency: 'CHF',
        revenue: -1000,
        operatingIncome: 100,
      }),
    },
    {
      companyIndex: 3,
      filing: filing({
        fiscalYear: 2024,
        periodEnd: '2024-12-31',
        currency: 'JPY',
        revenue: 1_250_000_000_000,
        operatingIncome: 62_500_000_000,
      }),
    },
    {
      companyIndex: 4,
      filing: filing({
        fiscalYear: 2024,
        periodEnd: '2024-12-31',
        currency: 'USD',
        revenue: 9_007_199_254_740_991,
        operatingIncome: 900_719_925_474_099,
      }),
    },
    {
      companyIndex: 6,
      filing: filing({
        fiscalYear: 2024,
        periodEnd: '2024-12-31',
        currency: 'CAD',
        revenue: 4_200_000,
        operatingIncome: 420_000,
      }),
    },
    {
      companyIndex: 7,
      filing: filing({
        fiscalYear: 2024,
        periodEnd: '2024-12-31',
        currency: 'EUR',
        revenue: 6_500_000,
        operatingIncome: 975_000,
      }),
    },
  ];

  await copyRows(
    databaseUrl,
    'COPY account_financial_profiles (id, org_id, company_id, source, entity_id, entity_name, status, last_pulled_at, updated_at) FROM STDIN',
    fxCompanies.map((company, i) =>
      copyLine([
        randomUUID(),
        fx.id,
        fxCompanyIds[i]!,
        'esef',
        `LEI-FX-${i}`,
        company.name,
        'ok',
        now,
        now,
      ]),
    ),
  );
  await copyRows(
    databaseUrl,
    'COPY account_financial_periods (id, org_id, company_id, source, entity_id, period_type, fiscal_year, period_end, currency, source_url, metrics, updated_at) FROM STDIN',
    fxFilings.map((row) =>
      copyLine([
        randomUUID(),
        fx.id,
        fxCompanyIds[row.companyIndex]!,
        'esef',
        `LEI-FX-${row.companyIndex}`,
        'FY',
        row.filing.fiscalYear,
        row.filing.periodEnd,
        row.filing.currency,
        'https://example.test/sweep09/fx',
        metricsJson(row.filing),
        now,
      ]),
    ),
  );
  await copyRows(
    databaseUrl,
    'COPY company_firmographics (id, org_id, company_id, status, annual_revenue_usd, fetched_at, updated_at) FROM STDIN',
    [
      copyLine([
        randomUUID(),
        fx.id,
        fxCompanyIds[5]!,
        'ok',
        '42000000',
        now,
        now,
      ]),
    ],
  );
  await copyRows(
    databaseUrl,
    'COPY company_job_postings (id, org_id, company_id, source, external_id, title, region, function, seniority, posted_at, last_seen_at, fetched_at) FROM STDIN',
    [0, 1, 2].map((n) =>
      copyLine([
        randomUUID(),
        fx.id,
        fxCompanyIds[7]!,
        'lever',
        `fx-open-${n}`,
        `FX open role ${n}`,
        'amer',
        'sales',
        'senior',
        seen,
        seen,
        seen,
      ]),
    ),
  );

  const fxTotals = emptyTotals();
  const fxOppCount = 40;
  await copyRows(
    databaseUrl,
    'COPY opportunities (id, org_id, code, customer, company_id, name, stage, value_micros, probability, due_date, updated_at) FROM STDIN',
    (function* () {
      for (let i = 0; i < fxOppCount; i += 1) {
        const stage = STAGES[i % STAGES.length]!;
        const micros = i === 0 ? 0n : i === 1 ? -2_500_000n : i === 2 ? 9_007_199_254_740_991n : BigInt(i + 1) * 1_000_000n;
        const due = i === 3 ? null : i === 4 ? '9999-12-31' : '2026-12-01';
        noteOpp(fxTotals, stage, micros, due);
        yield copyLine([
          randomUUID(),
          fx.id,
          `FX-${String(i).padStart(3, '0')}`,
          fxCompanies[i % fxCompanies.length]!.name,
          fxCompanyIds[i % fxCompanies.length]!,
          `Mixed deal ${i}`,
          stage,
          micros.toString(),
          50,
          due,
          now,
        ]);
      }
    })(),
  );

  const manifest = {
    orgs: {
      empty: {
        clerkOrg: EMPTY_CLERK,
        orgId: empty.id,
        currency: 'USD',
        accounts: 0,
        opportunities: 0,
        tasks: 0,
        openPipelineMicros: '0',
        openDeals: 0,
        revenue: null,
        margin: null,
        openJobs: null,
      },
      huge: {
        clerkOrg: HUGE_CLERK,
        orgId: huge.id,
        currency: 'EUR',
        accounts: ACCOUNT_COUNT,
        opportunities: OPP_COUNT,
        tasks: TASK_COUNT,
        openPipelineMicros: hugeTotals.openMicros.toString(),
        openDeals: hugeTotals.openCount,
        wonMicros: hugeTotals.wonMicros.toString(),
        wonCount: hugeTotals.wonCount,
        lostCount: hugeTotals.lostCount,
        zeroAmounts: hugeTotals.zeroCount,
        negativeAmounts: hugeTotals.negativeCount,
        nullDueDates: hugeTotals.nullDueCount,
        farFutureDates: hugeTotals.farFutureCount,
        nullTaskDates,
        farFutureTasks,
        openTasks,
        overdueTasks,
        longNameChars: LONG_NAME.length,
        sentinel: {
          companyId: sentinelId,
          name: 'Sweep Sentinel',
          revenue: 1_700_000_000,
          revenueCurrency: 'EUR',
          priorRevenue: 1_500_000_000,
          marginLabel: 'Operating margin',
          margin: sentinelFilings[1]!.operatingMargin,
          priorMargin: sentinelFilings[0]!.operatingMargin,
          openJobsSeenIn45Days: 4,
          postingsInLast365Days: 6,
          firmographicsAnnualRevenueUsd: 125_000_000_000,
        },
      },
      fx: {
        clerkOrg: FX_CLERK,
        orgId: fx.id,
        currency: 'CAD',
        accounts: fxCompanies.length,
        opportunities: fxOppCount,
        openPipelineMicros: fxTotals.openMicros.toString(),
        openDeals: fxTotals.openCount,
        filings: fxFilings.map((row) => ({
          company: fxCompanies[row.companyIndex]!.name,
          companyId: fxCompanyIds[row.companyIndex]!,
          fiscalYear: row.filing.fiscalYear,
          currency: row.filing.currency,
          revenue: row.filing.revenue,
          operatingMargin: row.filing.operatingMargin,
        })),
        providerOnly: {
          company: 'Provider Only USD',
          companyId: fxCompanyIds[5]!,
          annualRevenueUsd: 42_000_000,
        },
        openJobsOnLongName: 3,
      },
    },
  };

  console.log(`SWEEP09_MANIFEST ${JSON.stringify(manifest)}`);
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
