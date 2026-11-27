/**
 * Sample company info for a visitor demo org.
 *
 * seedOrgData creates the accounts a public demo actually opens. It does not
 * run seed.ts, so those accounts have a CRM headcount and no firmographics,
 * postings, or posts. The company strip then says the intel was not refreshed
 * until a live source is connected. These rows are synthetic, tagged sample,
 * and dated from the seed clock. No registry, filing, or provider is called.
 * Financial periods are left alone.
 */
import type { IntelSummaryInput } from '@bidstack/shared';

import type { Prisma, PrismaClient } from '../generated/client/index.js';

import { intelConnections, recomputeCompanyIntelSummary } from './company-intel-summary.js';

const DAY = 86_400_000;

export interface VisitorDemoAccount {
  name: string;
  domain: string;
  country: string;
  industry: string;
  employeeCount: number;
  revenueBillions: number;
}

type SeedClient = Prisma.TransactionClient | PrismaClient;

const GROWTH_6M: Record<string, number> = {
  Siemens: 0.04,
  IKEA: 0.03,
  Sanofi: 0.05,
  HSBC: 0.06,
  Stellantis: 0.03,
  Spotify: 0.04,
  'Northwind Pharma': 0.08,
};

const ROLES = [
  { title: 'Sample: Cloud platform engineer', fn: 'infrastructure', skills: ['Microsoft Azure'], daysAgo: 4 },
  { title: 'Sample: Data engineer', fn: 'data', skills: ['Snowflake'], daysAgo: 11 },
  { title: 'Sample: Security engineer', fn: 'security', skills: [] as string[], daysAgo: 16 },
] as const;

function techFor(industry: string): string[] {
  if (industry === 'Healthcare') return ['Veeva', 'AWS'];
  if (industry === 'Financial Services') return ['Salesforce', 'Microsoft Azure'];
  if (industry === 'Retail' || industry === 'Media') return ['Google Cloud', 'Snowflake'];
  return ['SAP', 'Microsoft Azure'];
}

function revenueRange(billions: number): string {
  if (billions >= 10) return '$10B+';
  if (billions >= 1) return '$1B-$10B';
  return '$500M-$1B';
}

function regionFor(country: string): string {
  return country === 'US' || country === 'CA' ? 'AMER' : 'EMEA';
}

/** Company ids whose stored summary should be rebuilt. Sorted so the set is stable. */
export function companyIdsToSummarise(
  written: readonly string[],
  fixturePostingCompanies: readonly string[],
): string[] {
  return [...new Set([...written, ...fixturePostingCompanies])].sort((a, b) => a.localeCompare(b));
}

/**
 * Summary input for one visitor account with live sources off and no filings.
 * Revenue is the account's own public approximation, not a deal value.
 */
export function hostedIntelSummaryInput(
  account: VisitorDemoAccount,
  now: Date,
  companyId: string,
): IntelSummaryInput {
  const fetchedAt = new Date(now.getTime() - DAY).toISOString();
  const provenance = Object.fromEntries(
    ['annualRevenueUsd', 'revenueRange', 'employeeCount', 'headcountGrowth6m', 'techStack'].map((field) => [
      field,
      { source: 'fixture', fetchedAt },
    ]),
  );
  return {
    companyId,
    now,
    years: [],
    postingsTruncated: false,
    connections: { publicSources: false, apollo: false },
    runs: {},
    crm: { employeeCount: account.employeeCount, industry: account.industry, updatedAt: fetchedAt },
    firmographics: {
      // Same public approximation already stored on the account. The intel
      // field is USD. It is a sample estimate, not a filing and not a deal value.
      annualRevenueUsd: account.revenueBillions * 1_000_000_000,
      revenueRange: revenueRange(account.revenueBillions),
      employeeCount: account.employeeCount,
      headcountGrowth6m: GROWTH_6M[account.name] ?? 0.04,
      headcountGrowth12m: null,
      totalFundingUsd: null,
      latestFundingStage: null,
      latestFundingAt: null,
      foundedYear: null,
      industry: account.industry,
      techStack: techFor(account.industry),
      departmentHeadcount: null,
      provenance,
      fetchedAt,
    },
    postings: ROLES.map((role, i) => ({
      id: `visitor-demo-${i}`,
      title: role.title,
      function: role.fn,
      department: null,
      skills: [...role.skills],
      postedAt: new Date(now.getTime() - role.daysAgo * DAY).toISOString(),
      lastSeenAt: fetchedAt,
      source: 'fixture',
      url: `https://${account.domain}/`,
      sample: true,
      // Distinct fetch times. Whitespace orders by fetchedAt and hashes that
      // order; a tie makes a dismissal fail to hide the line.
      fetchedAt: new Date(now.getTime() - DAY - i * 60_000).toISOString(),
    })),
    posts: [
      {
        kind: 'expansion',
        title: `Sample: ${account.name} expands a cloud programme`,
        url: `https://${account.domain}/`,
        publishedAt: new Date(now.getTime() - 12 * DAY).toISOString(),
        sourceLabel: 'Sample data',
        sample: true,
      },
    ],
  };
}

/** Write the hosted rows and rebuild summaries, including fixture postings already stored. */
export async function seedVisitorDemoCompanyIntel(
  prisma: SeedClient,
  orgId: string,
  accounts: readonly VisitorDemoAccount[],
  now: Date = new Date(),
): Promise<number> {
  const connections = intelConnections(process.env);
  const written: string[] = [];
  for (const account of accounts) {
    const company = await prisma.company.findFirst({
      where: { orgId, name: account.name, deletedAt: null },
      select: { id: true, countryCode: true },
    });
    if (!company) continue;
    const input = hostedIntelSummaryInput(account, now, company.id);
    const firm = input.firmographics;
    if (!firm?.fetchedAt || firm.annualRevenueUsd == null || firm.employeeCount == null) {
      throw new Error(`visitor demo intel for ${account.name} is missing firmographics`);
    }
    const fetchedAt = new Date(firm.fetchedAt);
    const data = {
      status: 'ok',
      annualRevenueUsd: BigInt(Math.round(firm.annualRevenueUsd!)),
      revenueRange: firm.revenueRange,
      employeeCount: firm.employeeCount,
      headcountGrowth6m: firm.headcountGrowth6m,
      headcountGrowth12m: firm.headcountGrowth12m,
      industry: firm.industry,
      techStack: firm.techStack,
      departmentHeadcount: firm.departmentHeadcount ?? undefined,
      provenance: firm.provenance as Prisma.InputJsonValue,
      fetchedAt,
    };
    await prisma.companyFirmographics.upsert({
      where: { companyId: company.id },
      create: { orgId, companyId: company.id, ...data },
      update: data,
    });
    const region = regionFor(company.countryCode ?? account.country);
    for (const [i, posting] of input.postings.entries()) {
      if (typeof posting.postedAt !== 'string' || typeof posting.lastSeenAt !== 'string' || typeof posting.fetchedAt !== 'string') {
        throw new Error(`visitor demo posting for ${account.name} is missing a clock`);
      }
      const row = {
        title: posting.title,
        url: posting.url,
        region,
        function: posting.function,
        seniority: 'senior',
        skills: posting.skills,
        postedAt: new Date(posting.postedAt),
        lastSeenAt: new Date(posting.lastSeenAt),
        fetchedAt: new Date(posting.fetchedAt),
        sample: true,
      };
      await prisma.companyJobPosting.upsert({
        where: {
          orgId_companyId_source_externalId: {
            orgId,
            companyId: company.id,
            source: 'fixture',
            externalId: `visitor-demo-${i}`,
          },
        },
        create: { orgId, companyId: company.id, source: 'fixture', externalId: `visitor-demo-${i}`, ...row },
        update: row,
      });
    }
    const post = input.posts[0];
    if (!post?.publishedAt) throw new Error(`visitor demo intel for ${account.name} is missing its sample post`);
    const postRow = {
      url: post.url,
      title: post.title,
      excerpt: 'Sample post. Synthetic demo data, not a fetched article.',
      kind: post.kind,
      theme: null,
      publishedAt: new Date(post.publishedAt!),
      fetchedAt,
      sample: true,
    };
    await prisma.companyPost.upsert({
      where: {
        orgId_companyId_source_externalId: {
          orgId,
          companyId: company.id,
          source: 'fixture',
          externalId: 'visitor-demo-post-0',
        },
      },
      create: { orgId, companyId: company.id, source: 'fixture', externalId: 'visitor-demo-post-0', ...postRow },
      update: postRow,
    });
    written.push(company.id);
  }

  const fixturePostings = await prisma.companyJobPosting.findMany({
    where: { orgId, source: 'fixture' },
    select: { companyId: true },
    distinct: ['companyId'],
  });
  for (const companyId of companyIdsToSummarise(
    written,
    fixturePostings.map((row) => row.companyId),
  )) {
    await recomputeCompanyIntelSummary(prisma, orgId, companyId, { now, connections });
  }
  return written.length;
}
