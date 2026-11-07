/**
 * Slice 12 demo fixtures: sample account intelligence for the seeded demo
 * accounts. Every row is source 'fixture' with sample=true, so the UI shows
 * the "Sample" tag and nothing here can be mistaken for fetched data.
 * Idempotent: upserts on the natural keys.
 */
import type { Prisma, PrismaClient } from '../generated/client/index.js';

const DAY = 86_400_000;

interface FixtureYear { fy: number; revenue: number; operatingIncome: number; capex: number; rnd?: number; acquisitions?: number; headcount?: number }
interface FixturePosting { title: string; fn: string; department: string; city: string; country: string; skills: string[]; daysAgo: number }
interface FixturePost { title: string; excerpt: string; kind: string; theme: string | null; daysAgo: number; path: string }
interface FixtureStatement { text: string; stance: 'invest' | 'cut' | 'guidance'; theme: string | null; locator: string }
interface FixtureAccount {
  name: string;
  domain: string;
  currency: string;
  region: string;
  years: FixtureYear[];
  postings: FixturePosting[];
  posts: FixturePost[];
  statements: FixtureStatement[];
  registry: Array<{ label: string; value: string }>;
}

const ACCOUNTS: FixtureAccount[] = [
  {
    name: 'DNB Bank',
    domain: 'dnb.no',
    currency: 'NOK',
    region: 'emea',
    years: [
      { fy: 2023, revenue: 79_500e6, operatingIncome: 48_200e6, capex: 1_150e6, headcount: 10_400 },
      { fy: 2024, revenue: 82_800e6, operatingIncome: 50_100e6, capex: 1_420e6, headcount: 10_700 },
      { fy: 2025, revenue: 85_300e6, operatingIncome: 51_000e6, capex: 1_910e6, headcount: 11_000 },
    ],
    postings: [
      { title: 'Senior Data Engineer, Databricks', fn: 'data', department: 'Technology and Services', city: 'Oslo', country: 'NO', skills: ['Databricks', 'Python'], daysAgo: 4 },
      { title: 'Machine Learning Engineer, Customer Service AI', fn: 'ml_ai', department: 'Technology and Services', city: 'Oslo', country: 'NO', skills: ['Azure OpenAI', 'Python'], daysAgo: 9 },
      { title: 'AML Transaction Monitoring Analyst', fn: 'legal', department: 'Compliance', city: 'Bergen', country: 'NO', skills: [], daysAgo: 12 },
      { title: 'Cloud Platform Engineer, Azure', fn: 'infrastructure', department: 'Technology and Services', city: 'Oslo', country: 'NO', skills: ['Azure', 'Terraform'], daysAgo: 20 },
      { title: 'Security Operations Lead', fn: 'security', department: 'Group Security', city: 'Oslo', country: 'NO', skills: [], daysAgo: 41 },
    ],
    posts: [
      { title: 'DNB launches generative AI assistant for retail customers', excerpt: 'Sample post: an AI assistant answers everyday banking questions in the mobile app.', kind: 'product', theme: 'data_ai', daysAgo: 10, path: '/en/about-us/newsroom' },
      { title: 'DNB completes acquisition of a Nordic investment bank', excerpt: 'Sample post: the acquisition strengthens investment banking in the Nordics.', kind: 'acquisition', theme: 'm_and_a', daysAgo: 40, path: '/en/about-us/newsroom' },
      { title: 'DNB reports results for the third quarter', excerpt: 'Sample post: net interest income up, costs in line with plan.', kind: 'results', theme: null, daysAgo: 8, path: '/en/about-us/investor-relations' },
    ],
    statements: [
      { text: 'We will continue to invest in data platforms and AI to improve customer service and efficiency.', stance: 'invest', theme: 'data_ai', locator: 'Annual report 2025, CEO letter' },
      { text: 'We expect to move most remaining core workloads to the cloud over the next two years.', stance: 'guidance', theme: 'cloud', locator: 'Annual report 2025, Technology' },
    ],
    registry: [
      { label: 'Organisation number', value: '984 851 006' },
      { label: 'Status', value: 'Active' },
    ],
  },
  {
    name: 'MAHLE',
    domain: 'mahle.com',
    currency: 'EUR',
    region: 'emea',
    years: [
      { fy: 2023, revenue: 12_800e6, operatingIncome: 330e6, capex: 610e6, rnd: 780e6, headcount: 72_000 },
      { fy: 2024, revenue: 11_700e6, operatingIncome: 290e6, capex: 520e6, rnd: 760e6, headcount: 68_000 },
      { fy: 2025, revenue: 11_400e6, operatingIncome: 310e6, capex: 480e6, rnd: 790e6, headcount: 66_000 },
    ],
    postings: [
      { title: 'Thermal Management Engineer, EV Battery Systems', fn: 'engineering', department: 'R&D', city: 'Stuttgart', country: 'DE', skills: ['MATLAB'], daysAgo: 6 },
      { title: 'SAP S/4HANA Finance Lead', fn: 'finance', department: 'Corporate IT', city: 'Stuttgart', country: 'DE', skills: ['SAP S/4HANA'], daysAgo: 15 },
      { title: 'OT Security Engineer, Plants', fn: 'security', department: 'Corporate IT', city: 'Stuttgart', country: 'DE', skills: [], daysAgo: 25 },
      { title: 'Data Scientist, Manufacturing Quality', fn: 'data', department: 'Operations', city: 'Neubrandenburg', country: 'DE', skills: ['Python'], daysAgo: 33 },
    ],
    posts: [
      { title: 'MAHLE expands a thermal management plant', excerpt: 'Sample post: new capacity for EV battery cooling modules.', kind: 'expansion', theme: 'expansion', daysAgo: 20, path: '/en/news-and-press' },
      { title: 'MAHLE announces restructuring of combustion engine components', excerpt: 'Sample post: capacity reduced at two sites in Europe.', kind: 'layoffs', theme: 'workforce', daysAgo: 55, path: '/en/news-and-press' },
      { title: 'MAHLE partners with a chipmaker on power electronics', excerpt: 'Sample post: joint development of inverters for electric drives.', kind: 'partnership', theme: 'engineering', daysAgo: 70, path: '/en/news-and-press' },
    ],
    statements: [
      { text: 'We are shifting investment toward thermal management and electrification.', stance: 'invest', theme: 'engineering', locator: 'Annual report 2025, Strategy' },
      { text: 'We are reducing capacity for combustion engine components.', stance: 'cut', theme: 'workforce', locator: 'Annual report 2025, Outlook' },
      { text: 'We plan to complete the SAP S/4HANA rollout across our plants by 2027.', stance: 'guidance', theme: 'erp_finance', locator: 'Annual report 2025, Digitalisation' },
    ],
    registry: [
      { label: 'Legal form', value: 'GmbH' },
      { label: 'Register court', value: 'Stuttgart' },
    ],
  },
  {
    name: 'MAPFRE',
    domain: 'mapfre.com',
    currency: 'EUR',
    region: 'emea',
    years: [
      { fy: 2024, revenue: 28_400e6, operatingIncome: 1_800e6, capex: 230e6, headcount: 31_000 },
      { fy: 2025, revenue: 29_900e6, operatingIncome: 2_000e6, capex: 270e6, headcount: 31_500 },
    ],
    postings: [
      { title: 'Claims Automation Product Owner', fn: 'product', department: 'Digital', city: 'Madrid', country: 'ES', skills: [], daysAgo: 7 },
      { title: 'Cloud Security Architect', fn: 'security', department: 'Technology', city: 'Madrid', country: 'ES', skills: ['AWS'], daysAgo: 18 },
    ],
    posts: [
      { title: 'MAPFRE launches digital claims app in Latin America', excerpt: 'Sample post: customers file and track motor claims online.', kind: 'product', theme: 'digital_cx', daysAgo: 30, path: '/en/press-room' },
    ],
    statements: [{ text: 'We will keep investing in digital channels and claims automation.', stance: 'invest', theme: 'digital_cx', locator: 'Integrated report 2025, Strategy' }],
    registry: [],
  },
];

function metrics(y: FixtureYear): Prisma.InputJsonValue {
  const m: Record<string, { value: number; concept: string }> = {
    revenue: { value: y.revenue, concept: 'sample:Revenue' },
    operatingIncome: { value: y.operatingIncome, concept: 'sample:OperatingIncome' },
    capex: { value: y.capex, concept: 'sample:Capex' },
  };
  if (y.rnd != null) m.rnd = { value: y.rnd, concept: 'sample:ResearchAndDevelopment' };
  if (y.acquisitions != null) m.acquisitions = { value: y.acquisitions, concept: 'sample:Acquisitions' };
  if (y.headcount != null) m.headcount = { value: y.headcount, concept: 'sample:Headcount' };
  return m;
}

/** Seed sample account intelligence for the demo accounts. Returns rows written. */
export async function seedAccountIntel(prisma: PrismaClient, orgId: string, now: Date = new Date()): Promise<number> {
  let written = 0;
  for (const a of ACCOUNTS) {
    const company = await prisma.company.findFirst({ where: { orgId, name: a.name, deletedAt: null }, select: { id: true } });
    if (!company) continue;
    const companyId = company.id;
    const site = `https://www.${a.domain}`;
    const fetchedAt = new Date(now.getTime() - DAY);

    for (const y of a.years) {
      const periodEnd = new Date(`${y.fy}-12-31`);
      await prisma.accountFinancialPeriod.upsert({
        where: { companyId_source_periodType_periodEnd: { companyId, source: 'fixture', periodType: 'FY', periodEnd } },
        create: { orgId, companyId, source: 'fixture', entityId: 'sample', periodType: 'FY', fiscalYear: y.fy, periodEnd, currency: a.currency, sourceUrl: `${site}/`, metrics: metrics(y) },
        update: { metrics: metrics(y), currency: a.currency },
      });
      written++;
    }

    for (const [i, p] of a.postings.entries()) {
      const postedAt = new Date(now.getTime() - p.daysAgo * DAY);
      const data = {
        title: p.title, url: `${site}/careers`, city: p.city, country: p.country, region: a.region, function: p.fn, seniority: 'senior',
        skills: p.skills, department: p.department, postedAt, lastSeenAt: fetchedAt, fetchedAt, sample: true,
      };
      await prisma.companyJobPosting.upsert({
        where: { orgId_companyId_source_externalId: { orgId, companyId, source: 'fixture', externalId: `sample-${i}` } },
        create: { orgId, companyId, source: 'fixture', externalId: `sample-${i}`, ...data },
        update: data,
      });
      written++;
    }

    for (const [i, p] of a.posts.entries()) {
      const data = { url: `${site}${p.path}`, title: p.title, excerpt: p.excerpt, kind: p.kind, theme: p.theme, publishedAt: new Date(now.getTime() - p.daysAgo * DAY), fetchedAt, sample: true };
      await prisma.companyPost.upsert({
        where: { orgId_companyId_source_externalId: { orgId, companyId, source: 'fixture', externalId: `sample-${i}` } },
        create: { orgId, companyId, source: 'fixture', externalId: `sample-${i}`, ...data },
        update: data,
      });
      written++;
    }

    const ledger = [
      ...a.statements.map((s, i) => ({ key: `stmt:sample:${i}`, kind: 'statement', label: null, excerpt: s.text, locator: s.locator, stance: s.stance, theme: s.theme })),
      ...a.registry.map((r, i) => ({ key: `registry:sample:${i}`, kind: 'registry', label: r.label, excerpt: `${r.label}: ${r.value}`, locator: null, stance: null, theme: null })),
    ];
    for (const e of ledger) {
      const data = { kind: e.kind, label: e.label, url: `${site}/`, excerpt: e.excerpt, locator: e.locator, stance: e.stance, theme: e.theme, fetchedAt, sample: true };
      await prisma.intelEvidence.upsert({
        where: { orgId_companyId_source_key: { orgId, companyId, source: 'fixture', key: e.key } },
        create: { orgId, companyId, source: 'fixture', key: e.key, ...data },
        update: data,
      });
      written++;
    }
  }
  return written;
}
