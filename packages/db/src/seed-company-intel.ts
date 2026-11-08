/**
 * Slice 14 demo fixtures: sample organization data and job postings for every
 * demo company, then the list summary for each. Every row is source 'fixture'
 * (sample=true on postings, provenance source 'fixture' on firmographics), so
 * the UI labels it "Sample data". Organization-level fields only, never people.
 * Idempotent: upserts on the natural keys.
 */
import type { Prisma, PrismaClient } from '../generated/client/index.js';

import { intelConnections, recomputeCompanyIntelSummary } from './company-intel-summary.js';

const DAY = 86_400_000;

interface FixtureOrg {
  name: string;
  revenueUsd: number | null;
  revenueRange: string | null;
  employees: number;
  growth6m: number;
  growth12m: number;
  fundingUsd?: number;
  fundingStage?: string;
  fundingDaysAgo?: number;
  founded: number;
  tech: string[];
  departments: Record<string, number>;
  postings: Array<{ title: string; fn: string; skills: string[]; daysAgo: number }>;
}

const ORGS: FixtureOrg[] = [
  {
    name: 'CI Financial', revenueUsd: 2_900e6, revenueRange: '$1B-$10B', employees: 2_600, growth6m: 0.02, growth12m: 0.05, founded: 1965,
    tech: ['Salesforce', 'Microsoft Azure', 'Snowflake'], departments: { finance: 620, engineering: 410, sales: 380, operations: 300 },
    postings: [
      { title: 'Cloud Security Engineer', fn: 'security', skills: ['Azure', 'Terraform'], daysAgo: 5 },
      { title: 'Senior Data Engineer, Wealth Platform', fn: 'data', skills: ['Snowflake', 'Python'], daysAgo: 11 },
      { title: 'Salesforce Developer', fn: 'engineering', skills: ['Salesforce'], daysAgo: 19 },
      { title: 'Infrastructure Architect', fn: 'infrastructure', skills: ['Azure'], daysAgo: 52 },
    ],
  },
  {
    name: 'Logistec Corporation', revenueUsd: 700e6, revenueRange: '$500M-$1B', employees: 3_300, growth6m: -0.01, growth12m: 0.01, founded: 1952,
    tech: ['SAP', 'Microsoft 365'], departments: { operations: 1_900, engineering: 260, finance: 120 },
    postings: [{ title: 'IT Service Desk Analyst', fn: 'infrastructure', skills: [], daysAgo: 24 }],
  },
  {
    name: 'Rush University System for Health', revenueUsd: 3_900e6, revenueRange: '$1B-$10B', employees: 13_500, growth6m: 0.04, growth12m: 0.06, founded: 1837,
    tech: ['Epic', 'ServiceNow', 'Microsoft Azure'], departments: { healthcare: 8_200, operations: 1_600, engineering: 540 },
    postings: [
      { title: 'Epic Integration Analyst', fn: 'engineering', skills: ['Epic'], daysAgo: 3 },
      { title: 'Clinical Data Analyst', fn: 'data', skills: ['SQL', 'Python'], daysAgo: 8 },
      { title: 'Cloud Engineer, Azure', fn: 'infrastructure', skills: ['Azure'], daysAgo: 13 },
      { title: 'Security Analyst, HIPAA', fn: 'security', skills: [], daysAgo: 21 },
      { title: 'ServiceNow Developer', fn: 'engineering', skills: ['ServiceNow'], daysAgo: 38 },
    ],
  },
  {
    name: 'MAPFRE', revenueUsd: null, revenueRange: '$10B+', employees: 31_500, growth6m: 0.01, growth12m: 0.02, founded: 1933,
    tech: ['AWS', 'Salesforce', 'Guidewire'], departments: { sales: 9_000, operations: 8_400, engineering: 2_900 }, postings: [],
  },
  {
    name: 'MAHLE', revenueUsd: null, revenueRange: '$10B+', employees: 66_000, growth6m: -0.04, growth12m: -0.06, founded: 1920,
    tech: ['SAP S/4HANA', 'Siemens Teamcenter'], departments: { engineering: 14_000, operations: 38_000, finance: 2_100 }, postings: [],
  },
  {
    name: 'Aritzia', revenueUsd: 2_300e6, revenueRange: '$1B-$10B', employees: 9_500, growth6m: 0.07, growth12m: 0.12, founded: 1984,
    tech: ['Shopify Plus', 'Snowflake', 'Google Cloud'], departments: { retail: 7_200, engineering: 380, marketing: 260 },
    postings: [
      { title: 'Senior Software Engineer, eCommerce', fn: 'engineering', skills: ['TypeScript', 'React'], daysAgo: 2 },
      { title: 'Data Scientist, Demand Forecasting', fn: 'data', skills: ['Python'], daysAgo: 6 },
      { title: 'Product Manager, Mobile App', fn: 'product', skills: [], daysAgo: 9 },
      { title: 'Cloud Platform Engineer', fn: 'infrastructure', skills: ['Google Cloud', 'Kubernetes'], daysAgo: 14 },
      { title: 'Security Engineer', fn: 'security', skills: [], daysAgo: 17 },
      { title: 'Analytics Engineer', fn: 'data', skills: ['Snowflake', 'dbt'], daysAgo: 26 },
      { title: 'Retail Systems Analyst', fn: 'engineering', skills: [], daysAgo: 44 },
    ],
  },
  {
    name: 'NOS', revenueUsd: 1_700e6, revenueRange: '$1B-$10B', employees: 4_300, growth6m: 0, growth12m: 0.01, founded: 2014,
    tech: ['Oracle', 'Microsoft Azure'], departments: { engineering: 1_400, sales: 1_100, operations: 900 },
    postings: [
      { title: 'Network Automation Engineer', fn: 'infrastructure', skills: ['Python', 'Ansible'], daysAgo: 12 },
      { title: 'SOC Analyst', fn: 'security', skills: [], daysAgo: 47 },
    ],
  },
  {
    name: 'DNB Bank', revenueUsd: null, revenueRange: '$1B-$10B', employees: 11_000, growth6m: 0.03, growth12m: 0.04, founded: 1822,
    tech: ['Microsoft Azure', 'Databricks'], departments: { finance: 4_100, engineering: 2_300, operations: 1_800 }, postings: [],
  },
  {
    name: 'Mantu', revenueUsd: 700e6, revenueRange: '$500M-$1B', employees: 12_500, growth6m: 0.05, growth12m: 0.08, founded: 2007,
    tech: ['Microsoft 365', 'Salesforce'], departments: { consulting: 9_800, sales: 900, operations: 600 },
    postings: [
      { title: 'AI Engineer, GenAI Practice', fn: 'ml_ai', skills: ['Python', 'Azure OpenAI'], daysAgo: 4 },
      { title: 'Cloud Architect', fn: 'infrastructure', skills: ['Azure', 'AWS'], daysAgo: 7 },
      { title: 'Data Consultant', fn: 'data', skills: ['Databricks'], daysAgo: 15 },
      { title: 'Cybersecurity Consultant', fn: 'security', skills: [], daysAgo: 22 },
      { title: 'Business Developer, IT Services', fn: 'sales', skills: [], daysAgo: 28 },
    ],
  },
  {
    name: 'Northwind Pharma', revenueUsd: 640e6, revenueRange: '$500M-$1B', employees: 4_200, growth6m: 0.09, growth12m: 0.15,
    fundingUsd: 180e6, fundingStage: 'Series C', fundingDaysAgo: 120, founded: 2011,
    tech: ['Veeva', 'AWS'], departments: { research: 1_700, operations: 1_100, sales: 600 },
    postings: [
      { title: 'Clinical Data Manager', fn: 'data', skills: ['SAS'], daysAgo: 3 },
      { title: 'Validation Engineer, GxP', fn: 'engineering', skills: [], daysAgo: 10 },
      { title: 'Cloud Engineer, Regulated Workloads', fn: 'infrastructure', skills: ['AWS'], daysAgo: 18 },
    ],
  },
];

/** Seed sample organization data and summaries for the demo companies. Returns companies summarised. */
export async function seedCompanyIntel(prisma: PrismaClient, orgId: string, now: Date = new Date()): Promise<number> {
  const fetchedAt = new Date(now.getTime() - DAY);
  const connections = intelConnections(process.env);
  let done = 0;
  for (const o of ORGS) {
    const company = await prisma.company.findFirst({ where: { orgId, name: o.name, deletedAt: null }, select: { id: true, domain: true, countryCode: true } });
    if (!company) continue;
    const companyId = company.id;
    const at = fetchedAt.toISOString();
    const prov = Object.fromEntries(
      ['annualRevenueUsd', 'revenueRange', 'employeeCount', 'headcountGrowth6m', 'headcountGrowth12m', 'totalFundingUsd', 'foundedYear', 'techStack', 'departmentHeadcount'].map((k) => [k, { source: 'fixture', fetchedAt: at }]),
    );
    const data = {
      status: 'ok',
      annualRevenueUsd: o.revenueUsd != null ? BigInt(Math.round(o.revenueUsd)) : null,
      revenueRange: o.revenueRange,
      employeeCount: o.employees,
      headcountGrowth6m: o.growth6m,
      headcountGrowth12m: o.growth12m,
      totalFundingUsd: o.fundingUsd != null ? BigInt(Math.round(o.fundingUsd)) : null,
      latestFundingStage: o.fundingStage ?? null,
      latestFundingAt: o.fundingDaysAgo != null ? new Date(now.getTime() - o.fundingDaysAgo * DAY) : null,
      foundedYear: o.founded,
      techStack: o.tech,
      departmentHeadcount: o.departments as Prisma.InputJsonValue,
      provenance: prov as Prisma.InputJsonValue,
      fetchedAt,
    };
    await prisma.companyFirmographics.upsert({ where: { companyId }, create: { orgId, companyId, ...data }, update: data });

    const site = `https://www.${company.domain ?? 'example.com'}`;
    for (const [i, p] of o.postings.entries()) {
      const posting = {
        title: p.title, url: `${site}/careers`, region: ['CA', 'US'].includes(company.countryCode ?? '') ? 'AMER' : 'EMEA', function: p.fn, seniority: 'senior', skills: p.skills,
        postedAt: new Date(now.getTime() - p.daysAgo * DAY), lastSeenAt: fetchedAt, fetchedAt, sample: true,
      };
      await prisma.companyJobPosting.upsert({
        where: { orgId_companyId_source_externalId: { orgId, companyId, source: 'fixture', externalId: `org-sample-${i}` } },
        create: { orgId, companyId, source: 'fixture', externalId: `org-sample-${i}`, ...posting },
        update: posting,
      });
    }
    await recomputeCompanyIntelSummary(prisma, orgId, companyId, { now, connections });
    done++;
  }
  return done;
}
