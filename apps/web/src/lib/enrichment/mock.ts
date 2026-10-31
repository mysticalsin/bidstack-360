// Mock enrichment, used until the enrichment API lands. Deterministic per
// company so screenshots and tests are stable. Always flagged sample: true.
import type { CompanyEnrichment, OpenRole, RoleFunction, RoleSeniority } from './types';

const AS_OF = '2026-10-30';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let x = seed || 1;
  return () => ((x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909)) >>> 0) / 4294967296;
}

type Tpl = { title: string; fn: RoleFunction; sen: RoleSeniority; tag: string };
const TEMPLATES: Tpl[] = [
  { title: 'Cloud Platform Engineer', fn: 'Engineering', sen: 'Senior', tag: 'cloud' },
  { title: 'Mainframe Migration Lead', fn: 'Engineering', sen: 'Lead', tag: 'cloud' },
  { title: 'Site Reliability Engineer', fn: 'Engineering', sen: 'Mid', tag: 'cloud' },
  { title: 'Head of Cloud Transformation', fn: 'Engineering', sen: 'Director+', tag: 'cloud' },
  { title: 'Data Engineer (Snowflake)', fn: 'Data & AI', sen: 'Mid', tag: 'data' },
  { title: 'Machine Learning Engineer', fn: 'Data & AI', sen: 'Senior', tag: 'data' },
  { title: 'Data Governance Manager', fn: 'Data & AI', sen: 'Lead', tag: 'data' },
  { title: 'Analytics Engineer', fn: 'Data & AI', sen: 'Entry', tag: 'data' },
  { title: 'Product Manager, Advisor Portal', fn: 'Product', sen: 'Senior', tag: 'portal' },
  { title: 'UX Designer, Client Experience', fn: 'Product', sen: 'Mid', tag: 'portal' },
  { title: 'Frontend Engineer (React)', fn: 'Engineering', sen: 'Mid', tag: 'portal' },
  { title: 'KYC Operations Analyst', fn: 'Risk & Compliance', sen: 'Entry', tag: 'kyc' },
  { title: 'Regulatory Reporting Lead', fn: 'Risk & Compliance', sen: 'Lead', tag: 'kyc' },
  { title: 'Financial Crime Technology Manager', fn: 'Risk & Compliance', sen: 'Senior', tag: 'kyc' },
  { title: 'Finance Business Partner', fn: 'Finance', sen: 'Mid', tag: 'other' },
  { title: 'Enterprise Account Executive', fn: 'Sales', sen: 'Senior', tag: 'other' },
  { title: 'Operations Analyst', fn: 'Operations', sen: 'Entry', tag: 'other' },
  { title: 'Talent Acquisition Partner', fn: 'HR', sen: 'Mid', tag: 'other' },
];
const REGIONS: Array<{ region: string; location: string }> = [
  { region: 'North America', location: 'Toronto, CA' },
  { region: 'North America', location: 'New York, US' },
  { region: 'Europe', location: 'London, UK' },
  { region: 'Europe', location: 'Dublin, IE' },
  { region: 'APAC', location: 'Singapore, SG' },
];

export function mockEnrichment(companyId: string): CompanyEnrichment {
  const r = rng(hash(companyId));
  const roles: OpenRole[] = [];
  const n = 22 + Math.floor(r() * 10);
  for (let i = 0; i < n; i++) {
    const t = TEMPLATES[(i * 7 + Math.floor(r() * TEMPLATES.length)) % TEMPLATES.length]!;
    const loc = REGIONS[Math.floor(r() * REGIONS.length)]!;
    const daysAgo = Math.floor(r() * 75);
    roles.push({
      id: `role-${i + 1}`,
      title: t.title,
      function: t.fn,
      seniority: t.sen,
      region: loc.region,
      location: loc.location,
      postedAt: new Date(new Date(AS_OF).getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10),
      source: i % 3 === 0 ? 'Company careers site' : 'LinkedIn Jobs',
    });
  }
  const tagged = (tag: string) => roles.filter((x) => TEMPLATES.find((t) => t.title === x.title)?.tag === tag).map((x) => x.id);
  const base = 9000 + Math.floor(r() * 4000);
  const trend = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(2025, 10 + i, 1);
    return { month: d.toISOString().slice(0, 7), value: Math.round(base * (1 + i * 0.006 + (r() - 0.5) * 0.004)) };
  });
  const projects = [
    { id: 'cloud', title: 'Core platform move to cloud', summary: 'Cloud platform and mainframe migration roles are open at the same time, which usually means a core-system migration.', ev: tagged('cloud') },
    { id: 'data', title: 'Enterprise data platform build-out', summary: 'Data engineering, ML and governance roles suggest a new central data platform.', ev: tagged('data') },
    { id: 'portal', title: 'Advisor portal replatforming', summary: 'Product, UX and frontend roles named for the advisor portal point to a rebuild.', ev: tagged('portal') },
    { id: 'kyc', title: 'KYC and regulatory reporting uplift', summary: 'KYC operations and regulatory reporting roles suggest a compliance remediation programme.', ev: tagged('kyc') },
  ]
    .filter((p) => p.ev.length > 0)
    .map((p) => {
      const score = Math.min(0.92, 0.35 + p.ev.length * 0.11);
      return {
        id: p.id,
        title: p.title,
        summary: p.summary,
        confidence: (score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        score,
        inferredAt: AS_OF,
        source: 'Hiring signal model',
        evidence: p.ev,
      };
    })
    .sort((a, b) => b.score - a.score);
  return {
    companyId,
    sample: true,
    firmographics: {
      revenue: { value: { amount: Math.round((1.8 + r() * 2.4) * 1e9), currency: 'CAD', fiscalYear: 'FY2025' }, source: 'Annual report', asOf: '2026-03-14' },
      headcount: { value: { current: trend.at(-1)!.value, trend }, source: 'LinkedIn company page', asOf: AS_OF },
      industry: { value: 'Asset & wealth management', source: 'Companies registry (SIC)', asOf: '2026-01-09' },
      locations: {
        value: [
          { city: 'Toronto', country: 'Canada', hq: true },
          { city: 'New York', country: 'United States' },
          { city: 'London', country: 'United Kingdom' },
          { city: 'Dublin', country: 'Ireland' },
          { city: 'Singapore', country: 'Singapore' },
        ],
        source: 'Company website',
        asOf: '2026-09-02',
      },
    },
    hiring: { source: 'LinkedIn Jobs + careers site', asOf: AS_OF, roles },
    projects,
  };
}
