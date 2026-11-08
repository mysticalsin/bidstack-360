/**
 * Slice 16 demo fixtures: sample open data technology stacks for the seeded
 * accounts. Every snapshot is sample=true with open_data:* sources, so the UI
 * shows the "Sample" tag and the first real refresh replaces it. Records say
 * "Sample" and carry no links, so nothing here reads as fetched evidence.
 * Accounts that are not in the org (Pfizer on most seeds) are skipped.
 * Idempotent: writes one providerMetadata key per account.
 */
import { OpenTechStackSnapshot, type OpenTechLane } from '@bidstack/shared';

import type { PrismaClient } from '../generated/client/index.js';
import { normalizeEnrichmentName } from './open-tech-refresh.js';

type Row = [lane: OpenTechLane, name: string, category: string, confidence: number, record: string];

interface SampleStack {
  name: string;
  domain: string;
  rows: Row[];
  /** Lanes that ran and found nothing, so the coverage line shows honest gaps. */
  empty?: OpenTechLane[];
}

const M365: Row[] = [
  ['dns', 'Microsoft 365', 'Collaboration', 0.95, 'Sample: MX points to Microsoft 365'],
  ['dns', 'Microsoft Entra ID', 'Identity', 0.85, 'Sample: SPF and autodiscover point to Microsoft'],
];

const STACKS: SampleStack[] = [
  {
    name: 'Pfizer',
    domain: 'pfizer.com',
    rows: [
      ...M365,
      ['dns', 'Proofpoint', 'Security', 0.95, 'Sample: MX points to Proofpoint'],
      ['ct', 'ServiceNow', 'ITSM', 0.8, 'Sample: certificate for a ServiceNow tenant host'],
      ['web', 'Adobe Experience Manager', 'Web', 0.75, 'Sample: homepage markup marker'],
      ['web', 'Akamai', 'Cloud', 0.9, 'Sample: response header marker'],
      ['jobs', 'Veeva', 'CRM', 0.71, 'Sample: named in 3 of 40 public job postings'],
      ['jobs', 'Snowflake', 'Data', 0.63, 'Sample: named in 1 of 40 public job postings'],
    ],
  },
  {
    name: 'DNB Bank',
    domain: 'dnb.no',
    rows: [
      ...M365,
      ['dns', 'Cloudflare', 'Cloud', 0.9, 'Sample: name servers at Cloudflare'],
      ['ct', 'Atlassian Jira', 'DevOps', 0.65, 'Sample: certificate for a jira subdomain'],
      ['web', 'Adobe Analytics', 'Analytics', 0.9, 'Sample: homepage script marker'],
      ['jobs', 'Microsoft Azure', 'Cloud', 0.79, 'Sample: named in 2 of 5 public job postings'],
      ['jobs', 'Databricks', 'Data', 0.63, 'Sample: named in 1 of 5 public job postings'],
      ['jobs', 'Terraform', 'DevOps', 0.63, 'Sample: named in 1 of 5 public job postings'],
    ],
    empty: ['github'],
  },
  {
    name: 'MAHLE',
    domain: 'mahle.com',
    rows: [
      ...M365,
      ['ct', 'SAP SuccessFactors', 'HR', 0.8, 'Sample: certificate for a SuccessFactors tenant host'],
      ['web', 'Google Tag Manager', 'Analytics', 0.9, 'Sample: homepage script marker'],
      ['web', 'Usercentrics', 'Web', 0.9, 'Sample: consent banner script'],
      ['jobs', 'SAP S/4HANA', 'ERP', 0.71, 'Sample: named in 2 of 6 public job postings'],
      ['jobs', 'Siemens Teamcenter', 'Data', 0.63, 'Sample: named in 1 of 6 public job postings'],
    ],
    empty: ['github'],
  },
  {
    name: 'CI Financial',
    domain: 'ci.com',
    rows: [
      ...M365,
      ['dns', 'Mimecast', 'Security', 0.95, 'Sample: MX points to Mimecast'],
      ['dns', 'DocuSign', 'Collaboration', 0.8, 'Sample: TXT verification record'],
      ['web', 'Salesforce', 'CRM', 0.75, 'Sample: homepage form marker'],
      ['jobs', 'Microsoft Azure', 'Cloud', 0.71, 'Sample: named in 2 of 9 public job postings'],
    ],
    empty: ['ct', 'github'],
  },
  {
    name: 'Rush University System for Health',
    domain: 'rush.edu',
    rows: [
      ...M365,
      ['ct', 'Epic', 'ERP', 0.8, 'Sample: certificate for a MyChart host'],
      ['web', 'Google Analytics', 'Analytics', 0.9, 'Sample: homepage script marker'],
      ['jobs', 'ServiceNow', 'ITSM', 0.63, 'Sample: named in 1 of 7 public job postings'],
    ],
    empty: ['github'],
  },
  {
    name: 'Logistec Corporation',
    domain: 'logistec.com',
    rows: [
      ...M365,
      ['web', 'WordPress', 'Web', 0.75, 'Sample: homepage markup marker'],
    ],
    empty: ['ct', 'jobs', 'github'],
  },
  {
    name: 'MAPFRE',
    domain: 'mapfre.com',
    rows: [
      ['dns', 'Google Workspace', 'Collaboration', 0.95, 'Sample: MX points to Google'],
      ['dns', 'Proofpoint', 'Security', 0.85, 'Sample: SPF includes Proofpoint'],
      ['ct', 'Okta', 'Identity', 0.8, 'Sample: certificate for an Okta tenant host'],
      ['web', 'Adobe Experience Manager', 'Web', 0.75, 'Sample: homepage markup marker'],
      ['jobs', 'Guidewire', 'ERP', 0.63, 'Sample: named in 1 of 4 public job postings'],
    ],
    empty: ['github'],
  },
  {
    name: 'Aritzia',
    domain: 'aritzia.com',
    rows: [
      ['dns', 'Google Workspace', 'Collaboration', 0.95, 'Sample: MX points to Google'],
      ['web', 'Salesforce Commerce Cloud', 'Commerce', 0.9, 'Sample: storefront script marker'],
      ['web', 'Klaviyo', 'Marketing', 0.9, 'Sample: homepage script marker'],
      ['jobs', 'Workday', 'HR', 0.63, 'Sample: named in 1 of 5 public job postings'],
    ],
    empty: ['ct', 'github'],
  },
  {
    name: 'NOS',
    domain: 'nos.pt',
    rows: [
      ...M365,
      ['ct', 'ServiceNow', 'ITSM', 0.8, 'Sample: certificate for a ServiceNow tenant host'],
      ['web', 'Google Tag Manager', 'Analytics', 0.9, 'Sample: homepage script marker'],
    ],
    empty: ['jobs', 'github'],
  },
  {
    name: 'Mantu',
    domain: 'mantu.com',
    rows: [
      ...M365,
      ['dns', 'HubSpot', 'Marketing', 0.8, 'Sample: TXT verification record'],
      ['web', 'Webflow', 'Web', 0.75, 'Sample: homepage markup marker'],
      ['jobs', 'Microsoft Azure', 'Cloud', 0.63, 'Sample: named in 1 of 8 public job postings'],
    ],
    empty: ['ct', 'github'],
  },
  {
    name: 'Northwind Pharma',
    domain: 'northwind-pharma.example',
    rows: [['dns', 'Google Workspace', 'Collaboration', 0.95, 'Sample: MX points to Google']],
    empty: ['ct', 'web', 'jobs', 'github'],
  },
];

export function sampleTechSnapshot(stack: SampleStack, checkedAt: string): OpenTechStackSnapshot {
  const items = stack.rows.map(([lane, name, category, confidence, record]) => ({
    name,
    category,
    lane,
    source: `open_data:${lane}`,
    confidence,
    evidence: { url: null, record, observedAt: checkedAt },
  }));
  const lanes = (['dns', 'ct', 'web', 'jobs', 'github'] as const).map((lane) => {
    const count = items.filter((i) => i.lane === lane).length;
    const ran = count > 0 || stack.empty?.includes(lane);
    return {
      lane,
      status: count > 0 ? ('found' as const) : ran ? ('empty' as const) : ('skipped' as const),
      count,
      detail: ran ? null : 'Sample data: lane not run',
      checkedAt: ran ? checkedAt : null,
    };
  });
  const distinct = new Set(items.map((i) => i.name.toLowerCase())).size;
  return OpenTechStackSnapshot.parse({
    version: 1,
    checkedAt,
    sample: true,
    items,
    lanes,
    apolloFallback: distinct < 5 ? 'not_configured' : 'not_needed',
  });
}

export const SAMPLE_TECH_STACK_ACCOUNTS = STACKS.map((s) => s.name);

export async function seedTechStacks(prisma: PrismaClient, orgId: string, now: Date = new Date()): Promise<number> {
  const checkedAt = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  let written = 0;
  for (const stack of STACKS) {
    const company = await prisma.company.findFirst({
      where: { orgId, deletedAt: null, name: { equals: stack.name, mode: 'insensitive' } },
      select: { name: true, domain: true, website: true },
    });
    if (!company) continue;
    const normalizedName = normalizeEnrichmentName(company.name);
    const domain = company.domain ?? stack.domain;
    await prisma.companyEnrichment.createMany({
      data: [{ orgId, normalizedName, legalName: company.name, domain, website: company.website ?? `https://www.${domain}/` }],
      skipDuplicates: true,
    });
    const existing = await prisma.companyEnrichment.findFirst({
      where: { orgId, normalizedName, deletedAt: null },
      select: { providerMetadata: true },
    });
    const current = ((existing?.providerMetadata ?? {}) as Record<string, unknown>).openTechStack as { sample?: boolean } | undefined;
    // Never overwrite a real (non-sample) refresh with sample data.
    if (current && current.sample === false) continue;
    const value = JSON.stringify(sampleTechSnapshot(stack, checkedAt));
    await prisma.$executeRaw`
      UPDATE company_enrichments
      SET provider_metadata = jsonb_set(COALESCE(provider_metadata, '{}'::jsonb), '{openTechStack}', ${value}::jsonb, true)
      WHERE org_id = ${orgId}::uuid AND normalized_name = ${normalizedName} AND deleted_at IS NULL`;
    written++;
  }
  return written;
}
