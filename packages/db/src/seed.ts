// Seeds the local Postgres with the prototype's fixtures so the API + web app
// have realistic data on first boot. Idempotent: re-running upserts.
//
// Maps prototype stage names to the canonical enum:
//   qualifying  -> qualified
//   won         -> closed_won
//   lost        -> closed_lost

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenvFlow from 'dotenv-flow';

import { type Prisma, PrismaClient } from '../generated/client/index.js';
import {
  fixtureCompanies,
  fixtureCompanyEnrichments,
  fixtureContacts,
  fixtureLeads,
  fixtureOpps,
  fixtureTasks,
  fixtureUsers,
  intelFor,
} from './seed-data.js';
import { seedRolesAndPermissions } from './seed.rbac.js';

// PERMISSION_SEEDS, ROLE_SEEDS, LEGACY_ROLE_ASSIGNMENTS, helper functions,
// and seedRolesAndPermissions() extracted to ./seed.rbac.ts (BS-R1)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

const prisma = new PrismaClient();

/** Mirrors the app's company normalization (worker + crm routes + shared
 *  normalizeName) so customer→Company and the cockpit enrichment join target
 *  the same key. Kept inline to avoid a cross-package import in the seed. */
function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const SEED_ORG_CLERK = 'org_seed_mantu';
const SEED_ORG_NAME = 'Mantu (seed)';

async function main() {
  console.log('🌱 Seeding BidStack 360°…');

  const org = await prisma.org.upsert({
    where: { clerkOrg: SEED_ORG_CLERK },
    create: { clerkOrg: SEED_ORG_CLERK, name: SEED_ORG_NAME },
    update: { name: SEED_ORG_NAME },
  });
  console.log(`  ✓ org:   ${org.name} (${org.id})`);

  // Users
  const usersByInitials = new Map<string, string>();
  for (const u of fixtureUsers) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        orgId: org.id,
        clerkUser: `seed_${u.initials.toLowerCase()}`,
        email: u.email,
        name: u.name,
        role: u.role,
      },
      update: { name: u.name, role: u.role },
    });
    usersByInitials.set(u.initials, user.id);
  }
  // First seeded user — stable author for org-level seed records below.
  const seedUserId = usersByInitials.values().next().value as string;
  console.log(`  ✓ users: ${fixtureUsers.length}`);

  const bookingOwnerId = usersByInitials.get('JS');
  if (bookingOwnerId) {
    const availabilityRules = [
      { dayOfWeek: 0, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 3, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 4, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 5, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 6, startTime: '09:00', endTime: '17:00' },
    ];

    await prisma.bookingPage.upsert({
      where: { orgId_slug: { orgId: org.id, slug: 'test-slug' } },
      create: {
        orgId: org.id,
        userId: bookingOwnerId,
        slug: 'test-slug',
        name: 'BidStack discovery call',
        description:
          'A public scheduling page used to verify booking availability and slot creation.',
        durationMinutes: 30,
        minNoticeHours: 0,
        maxAdvanceDays: 14,
        availabilityRules,
      },
      update: {
        userId: bookingOwnerId,
        name: 'BidStack discovery call',
        description:
          'A public scheduling page used to verify booking availability and slot creation.',
        durationMinutes: 30,
        minNoticeHours: 0,
        maxAdvanceDays: 14,
        availabilityRules,
        isActive: true,
        deletedAt: null,
      },
    });
  }
  console.log('  ✓ booking page: test-slug');

  await seedRolesAndPermissions(prisma, org.id, usersByInitials);

  // Opportunities
  for (const o of fixtureOpps) {
    const ownerId = usersByInitials.get(o.ownerInitials) ?? null;
    await prisma.opportunity.upsert({
      where: { orgId_code: { orgId: org.id, code: o.code } },
      create: {
        orgId: org.id,
        code: o.code,
        customer: o.customer,
        name: o.name,
        stage: o.stage,
        valueMicros: Math.round(o.value * 1_000_000),
        probability: o.probability,
        dueDate: o.dueDate ? new Date(o.dueDate) : null,
        ownerId,
        industry: o.industry,
        logoUrl: o.logoUrl,
        country: o.country,
        intel: intelFor(o.code) as Prisma.InputJsonValue,
      },
      update: {
        stage: o.stage,
        valueMicros: Math.round(o.value * 1_000_000),
        probability: o.probability,
        dueDate: o.dueDate ? new Date(o.dueDate) : null,
        ownerId,
        country: o.country,
        intel: intelFor(o.code) as Prisma.InputJsonValue,
      },
    });
  }
  console.log(`  ✓ opps:  ${fixtureOpps.length}`);

  for (const company of fixtureCompanyEnrichments) {
    await prisma.companyEnrichment.upsert({
      where: {
        orgId_normalizedName: {
          orgId: org.id,
          normalizedName: company.normalizedName,
        },
      },
      create: {
        orgId: org.id,
        normalizedName: company.normalizedName,
        legalName: company.legalName,
        tradeName: company.tradeName,
        domain: company.domain,
        website: company.website,
        logoUrl: company.logoUrl,
        logoSource: company.logoSource,
        registryIds: {},
        formerNames: [],
        industryCodes: [],
        status: company.status,
        employeeCount: company.employeeCount,
        annualRevenueMicros: company.annualRevenueMicros,
        confidenceBps: company.confidenceBps,
        sourceAttribution: company.sourceAttribution as Prisma.InputJsonValue,
        providerMetadata: company.providerMetadata as Prisma.InputJsonValue,
        cacheExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: {
        legalName: company.legalName,
        tradeName: company.tradeName,
        domain: company.domain,
        website: company.website,
        logoUrl: company.logoUrl,
        logoSource: company.logoSource,
        status: company.status,
        employeeCount: company.employeeCount,
        annualRevenueMicros: company.annualRevenueMicros,
        confidenceBps: company.confidenceBps,
        sourceAttribution: company.sourceAttribution as Prisma.InputJsonValue,
        providerMetadata: company.providerMetadata as Prisma.InputJsonValue,
        cacheExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }
  console.log(`  ✓ company enrichments: ${fixtureCompanyEnrichments.length}`);

  // Contacts
  for (const c of fixtureContacts) {
    await prisma.contact.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        orgId: org.id,
        customer: c.customer,
        name: c.name,
        role: c.role,
        email: c.email,
        phone: c.phone,
        influence: c.influence,
        sentiment: c.sentiment,
      },
      update: {
        role: c.role,
        email: c.email,
        phone: c.phone,
        influence: c.influence,
        sentiment: c.sentiment,
      },
    });
  }
  console.log(`  ✓ contacts: ${fixtureContacts.length}`);

  // Leads
  for (const l of fixtureLeads) {
    const ownerId = usersByInitials.get(l.ownerInitials) ?? null;
    await prisma.lead.upsert({
      where: { id: l.id },
      create: {
        id: l.id,
        orgId: org.id,
        firstName: l.firstName,
        lastName: l.lastName,
        email: l.email,
        phone: l.phone,
        companyName: l.companyName,
        title: l.title,
        source: l.source,
        status: l.status,
        score: l.score,
        priority: l.priority,
        ownerId,
      },
      update: {
        firstName: l.firstName,
        lastName: l.lastName,
        email: l.email,
        phone: l.phone,
        companyName: l.companyName,
        title: l.title,
        source: l.source,
        status: l.status,
        score: l.score,
        priority: l.priority,
        ownerId,
      },
    });
  }
  console.log(`  ✓ leads: ${fixtureLeads.length}`);

  // Tasks (linked to opportunities by code)
  const oppByCode = new Map(
    (
      await prisma.opportunity.findMany({
        where: { orgId: org.id },
        select: { id: true, code: true },
      })
    ).map((o) => [o.code, o.id]),
  );

  for (const t of fixtureTasks) {
    const oppId = oppByCode.get(t.oppCode) ?? null;
    const assigneeId = usersByInitials.get(t.assigneeInitials) ?? null;
    await prisma.task.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        orgId: org.id,
        oppId,
        title: t.title,
        dueDate: t.dueDate ? new Date(t.dueDate) : null,
        status: t.status,
        assigneeId,
      },
      update: {
        title: t.title,
        status: t.status,
        dueDate: t.dueDate ? new Date(t.dueDate) : null,
        assigneeId,
      },
    });
  }
  console.log(`  ✓ tasks: ${fixtureTasks.length}`);

  // Seed a document and signature request for E2E tests
  const testOpp = await prisma.opportunity.findFirst({ where: { orgId: org.id } });
  if (testOpp) {
    const testDoc = await prisma.document.upsert({
      where: { id: 'd0c00000-0000-0000-0000-000000000000' },
      create: {
        id: 'd0c00000-0000-0000-0000-000000000000',
        orgId: org.id,
        oppId: testOpp.id,
        name: 'Test Contract.pdf',
        kind: 'proposal',
        storageUrl: 'https://example.com/test-contract.pdf',
      },
      update: {
        oppId: testOpp.id,
        name: 'Test Contract.pdf',
        kind: 'proposal',
        storageUrl: 'https://example.com/test-contract.pdf',
      },
    });

    await prisma.signatureRequest.upsert({
      where: { id: 'e5160000-0000-0000-0000-000000000000' },
      create: {
        id: 'e5160000-0000-0000-0000-000000000000',
        orgId: org.id,
        documentId: testDoc.id,
        provider: 'INTERNAL',
        providerRequestId: 'test-sign-token',
        status: 'SENT',
        recipients: [{ email: 'recipient@example.com', name: 'John Doe', role: 'signer' }],
      },
      update: {
        documentId: testDoc.id,
        provider: 'INTERNAL',
        providerRequestId: 'test-sign-token',
        status: 'SENT',
        recipients: [{ email: 'recipient@example.com', name: 'John Doe', role: 'signer' }],
      },
    });
    console.log('  ✓ seeded signature request for test-sign-token');
  }

  // ─── Historical closed deals — power the account revenue + win/loss views ──
  // Spread won/lost deals across the last ~10 months for the enrichment-backed
  // accounts (ci-financial, rush, mantu) so the cockpit revenue-evolution chart
  // and win/loss block render real, dated data on first boot.
  const HISTORY: Array<{
    code: string;
    customer: string;
    name: string;
    stage: 'closed_won' | 'closed_lost';
    value: number;
    monthsAgo: number;
    country: string;
  }> = [
    { code: 'OP-H01', customer: 'CI Financial', name: 'CI Financial — Cloud migration phase 1', stage: 'closed_won', value: 880_000, monthsAgo: 9, country: 'CA' },
    { code: 'OP-H02', customer: 'CI Financial', name: 'CI Financial — Data platform pilot', stage: 'closed_won', value: 540_000, monthsAgo: 7, country: 'CA' },
    { code: 'OP-H03', customer: 'CI Financial', name: 'CI Financial — Managed SOC RFP', stage: 'closed_lost', value: 1_200_000, monthsAgo: 6, country: 'CA' },
    { code: 'OP-H04', customer: 'CI Financial', name: 'CI Financial — Endpoint security rollout', stage: 'closed_won', value: 720_000, monthsAgo: 4, country: 'CA' },
    { code: 'OP-H05', customer: 'CI Financial', name: 'CI Financial — Zero Trust expansion', stage: 'closed_won', value: 1_350_000, monthsAgo: 2, country: 'CA' },
    { code: 'OP-H06', customer: 'CI Financial', name: 'CI Financial — Legacy app retirement', stage: 'closed_lost', value: 300_000, monthsAgo: 1, country: 'CA' },
    { code: 'OP-H07', customer: 'Rush University System for Health', name: 'Rush — EHR integration', stage: 'closed_won', value: 2_100_000, monthsAgo: 8, country: 'US' },
    { code: 'OP-H08', customer: 'Rush University System for Health', name: 'Rush — Clinical analytics', stage: 'closed_won', value: 1_450_000, monthsAgo: 3, country: 'US' },
    { code: 'OP-H09', customer: 'Mantu', name: 'Mantu — Internal tooling refresh', stage: 'closed_won', value: 410_000, monthsAgo: 5, country: 'FR' },
    { code: 'OP-H10', customer: 'Mantu', name: 'Mantu — Workspace consolidation', stage: 'closed_lost', value: 260_000, monthsAgo: 2, country: 'FR' },
  ];
  for (const h of HISTORY) {
    const closedAt = new Date(Date.now() - h.monthsAgo * 30 * 86_400_000);
    await prisma.opportunity.upsert({
      where: { orgId_code: { orgId: org.id, code: h.code } },
      create: {
        orgId: org.id,
        code: h.code,
        customer: h.customer,
        name: h.name,
        stage: h.stage,
        valueMicros: BigInt(h.value) * 1_000_000n,
        probability: h.stage === 'closed_won' ? 100 : 0,
        dueDate: closedAt,
        country: h.country,
      },
      update: {
        stage: h.stage,
        valueMicros: BigInt(h.value) * 1_000_000n,
        dueDate: closedAt,
        country: h.country,
      },
    });
  }
  console.log(`  ✓ historical closed deals: ${HISTORY.length}`);

  // ─── Real Company rows + opp/contact linkage (F2) ──────────────────────────
  // Account rollups (/accounts/top, /accounts/key, sector-view) read the Company
  // table and LEFT JOIN opportunities on company_id. Without real Company rows —
  // and without opportunity.companyId set — every account reads totalValue=0.
  // Materialize one canonical Company per DISTINCT opportunity customer from the
  // curated spec (never one-per-free-text-string), then link by normalized name.
  const companyIdByNorm = new Map<string, string>();
  for (const c of fixtureCompanies) {
    const isKey = c.tier === 'key';
    await prisma.company.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        orgId: org.id,
        name: c.name,
        legalName: c.name,
        domain: c.domain,
        industry: c.industry,
        employeeCount: c.employeeCount,
        countryCode: c.countryCode,
        website: `https://${c.domain}/`,
        // Logos resolve via the same-origin /api/v1/logo?domain= proxy.
        logoUrl: null,
        tier: isKey ? 'key' : 'standard',
        keyAccountSince: isKey ? new Date() : null,
        keyAccountOwnerId: isKey ? seedUserId : null,
        keyAccountNotes: c.keyAccountNotes,
        source: 'verified_data',
        confidence: 0.72,
        enrichedAt: new Date(),
      },
      update: {
        name: c.name,
        legalName: c.name,
        domain: c.domain,
        industry: c.industry,
        employeeCount: c.employeeCount,
        countryCode: c.countryCode,
        website: `https://${c.domain}/`,
        tier: isKey ? 'key' : 'standard',
        keyAccountNotes: c.keyAccountNotes,
        source: 'verified_data',
        confidence: 0.72,
        enrichedAt: new Date(),
      },
    });
    companyIdByNorm.set(normalizeName(c.name), c.id);
  }
  console.log(`  ✓ companies: ${fixtureCompanies.length}`);

  // Backfill: link every opportunity (fixtures, history, and any pre-existing)
  // to its Company by normalized customer name. Idempotent — writes only when the
  // link changes. Customers with no curated Company stay null (no dup pollution).
  const allOpps = await prisma.opportunity.findMany({
    where: { orgId: org.id },
    select: { id: true, customer: true, companyId: true },
  });
  let linkedOpps = 0;
  for (const o of allOpps) {
    const target = companyIdByNorm.get(normalizeName(o.customer)) ?? null;
    if (target && o.companyId !== target) {
      await prisma.opportunity.update({ where: { id: o.id }, data: { companyId: target } });
      linkedOpps += 1;
    }
  }
  console.log(`  ✓ linked opportunities → companies: ${linkedOpps}`);

  // Same linkage for contacts so the account cockpit's contactCount populates.
  const allContacts = await prisma.contact.findMany({
    where: { orgId: org.id },
    select: { id: true, customer: true, companyId: true },
  });
  let linkedContacts = 0;
  for (const ct of allContacts) {
    const target = companyIdByNorm.get(normalizeName(ct.customer)) ?? null;
    if (target && ct.companyId !== target) {
      await prisma.contact.update({ where: { id: ct.id }, data: { companyId: target } });
      linkedContacts += 1;
    }
  }
  console.log(`  ✓ linked contacts → companies: ${linkedContacts}`);

  // Rank the top 3 companies by total pipeline+won value so /accounts/top curated
  // mode highlights the marquee accounts. Clear stale ranks first (idempotent).
  const valueByCompany = await prisma.opportunity.groupBy({
    by: ['companyId'],
    where: { orgId: org.id, companyId: { not: null }, deletedAt: null },
    _sum: { valueMicros: true },
  });
  const topThree = valueByCompany
    .filter((r) => r.companyId)
    .sort((a, b) => Number(b._sum.valueMicros ?? 0n) - Number(a._sum.valueMicros ?? 0n))
    .slice(0, 3);
  await prisma.company.updateMany({
    where: { orgId: org.id, topAccountRank: { not: null } },
    data: { topAccountRank: null },
  });
  for (let i = 0; i < topThree.length; i += 1) {
    await prisma.company.update({
      where: { id: topThree[i]!.companyId! },
      data: { topAccountRank: i + 1 },
    });
  }
  console.log(`  ✓ top-account ranks: ${topThree.length}`);

  // ─── Access group (M7) — demonstrate scoped visibility ─────────────────────
  const emeaGroup = await prisma.userGroup.upsert({
    where: { orgId_name: { orgId: org.id, name: 'EMEA Pre-sales' } },
    create: {
      orgId: org.id,
      name: 'EMEA Pre-sales',
      description: 'Sees EMEA opportunities (FR, ES, PT, DE) plus owned deals.',
      scopeCountries: ['FR', 'ES', 'PT', 'DE'],
      scopeAll: false,
    },
    update: { scopeCountries: ['FR', 'ES', 'PT', 'DE'], scopeAll: false },
  });
  // Seed user stays unrestricted (no membership) so the demo login still sees
  // everything; the group exists to show the editor + scoping mechanism.
  console.log(`  ✓ access group: ${emeaGroup.name}`);

  // ─── Wave A — pre-sales governance surfaces (account: ci-financial) ─────────
  const ACCOUNT_KEY = 'ci-financial';
  await prisma.crossSellAction.deleteMany({ where: { orgId: org.id, accountKey: ACCOUNT_KEY } });
  await prisma.crossSellAction.createMany({
    data: [
      {
        orgId: org.id,
        accountKey: ACCOUNT_KEY,
        description: 'Introduce the UK cybersecurity practice to the CI Financial CISO.',
        requestingUnit: 'Canada — Pre-sales',
        assignedUnit: 'UK — Cyber',
        status: 'in_progress',
        dueDate: new Date(Date.now() + 14 * 86_400_000),
        createdById: seedUserId,
      },
      {
        orgId: org.id,
        accountKey: ACCOUNT_KEY,
        description: 'Share the Montreal data-platform reference deck with the France team.',
        requestingUnit: 'France — Data',
        assignedUnit: 'Canada — Pre-sales',
        status: 'open',
        createdById: seedUserId,
      },
      {
        orgId: org.id,
        accountKey: ACCOUNT_KEY,
        description: 'Joint QBR prep with the Managed Services unit.',
        requestingUnit: 'Canada — Pre-sales',
        assignedUnit: 'Global — MSP',
        status: 'done',
        createdById: seedUserId,
      },
    ],
  });

  await prisma.governanceMeeting.deleteMany({ where: { orgId: org.id, accountKey: ACCOUNT_KEY } });
  await prisma.governanceMeeting.create({
    data: {
      orgId: org.id,
      accountKey: ACCOUNT_KEY,
      meetingType: 'monthly_committee',
      date: new Date(Date.now() - 10 * 86_400_000),
      participants: ['Account Director', 'Pre-sales Lead', 'Delivery Manager'],
      outcomes: 'Agreed to fast-track the MSP expansion proposal; flagged a staffing risk in Q3.',
      createdById: seedUserId,
      actions: {
        create: [
          {
            orgId: org.id,
            description: 'Draft the MSP expansion SOW.',
            status: 'in_progress',
            dueDate: new Date(Date.now() + 7 * 86_400_000),
          },
          { orgId: org.id, description: 'Confirm Q3 staffing plan with resourcing.', status: 'open' },
        ],
      },
    },
  });
  await prisma.governanceMeeting.create({
    data: {
      orgId: org.id,
      accountKey: ACCOUNT_KEY,
      meetingType: 'quarterly_c_level',
      date: new Date(Date.now() - 45 * 86_400_000),
      participants: ['CIO (client)', 'VP Sales', 'Account Director'],
      outcomes: 'Renewed executive sponsorship; cybersecurity named the top FY priority.',
      createdById: seedUserId,
    },
  });

  await prisma.projectReference.deleteMany({ where: { orgId: org.id, accountKey: ACCOUNT_KEY } });
  await prisma.projectReference.createMany({
    data: [
      {
        orgId: org.id,
        accountKey: ACCOUNT_KEY,
        title: 'Core banking platform modernization',
        technicalSummary:
          'Migrated a legacy monolith to a cloud-native microservices estate on AWS.',
        businessSummary: 'Cut release lead time from weeks to days; 99.95% uptime in year one.',
        status: 'validated',
        sourceSystem: 'spotlight_ref',
        validatedById: seedUserId,
      },
      {
        orgId: org.id,
        accountKey: ACCOUNT_KEY,
        title: 'Zero Trust security rollout',
        technicalSummary: 'Identity-first segmentation across 12,000 endpoints.',
        businessSummary: 'Reduced incident response time by 60%.',
        status: 'manager_review',
        sourceSystem: 'spotlight_ref',
      },
    ],
  });
  console.log('  ✓ pre-sales governance: cross-sell, comitology, references');

  // ─── KAM: designate one key account (F9) ───────────────────────────────────
  // GET /api/v1/kam/accounts lists companies whose kamStatus != 'identified'.
  // The company seed leaves every row on the default 'identified', so the KAM
  // door opens empty. Promote the marquee account (CI Financial — already the
  // anchor for the governance/cross-sell demo data) to an active, pre-sales-
  // driven KAM. Idempotent: keyed on the stable company id.
  const ciFinancialId = companyIdByNorm.get('ci-financial');
  if (ciFinancialId) {
    await prisma.company.updateMany({
      where: { id: ciFinancialId, orgId: org.id, deletedAt: null },
      data: { kamStatus: 'active', kamOwnerModel: 'presales_driven' },
    });
    console.log('  ✓ KAM: CI Financial designated key account');
  }

  // ─── References Library (F9) ───────────────────────────────────────────────
  // The /references door (the reusable customer-reference library, distinct from
  // projectReference) reads the `reference` table org-scoped, and is empty until
  // seeded. Seed three case studies tied to seeded companies so it is alive on
  // first open. Idempotent: upsert by stable id.
  const fixtureReferences: Array<{
    id: string;
    companyNorm: string;
    title: string;
    description: string;
    industry: string;
    valueMicros: bigint;
    contactName: string | null;
    contactEmail: string | null;
    tags: string[];
    usageCount: number;
    daysSinceUsed: number | null;
  }> = [
    {
      id: '4ef00000-0000-4000-8000-000000000001',
      companyNorm: 'ci-financial',
      title: 'CI Financial — Core banking platform modernization',
      description:
        'Migrated a legacy core-banking monolith to a cloud-native microservices estate on AWS — release lead time fell from weeks to days with 99.95% uptime in year one.',
      industry: 'financial_services',
      valueMicros: BigInt(880_000) * 1_000_000n,
      contactName: 'Michael Johnson',
      contactEmail: 'mjohnson@ci.com',
      tags: ['cloud-migration', 'aws', 'financial-services', 'modernization'],
      usageCount: 3,
      daysSinceUsed: 12,
    },
    {
      id: '4ef00000-0000-4000-8000-000000000002',
      companyNorm: 'rush-university-system-for-health',
      title: 'Rush University — EHR cloud migration',
      description:
        'Moved electronic health records to a HIPAA-compliant cloud platform for 14,000 staff, cutting clinician access times by 40% with a zero-downtime cutover.',
      industry: 'healthcare',
      valueMicros: BigInt(2_100_000) * 1_000_000n,
      contactName: 'Anil Rajan',
      contactEmail: 'arajan@rush.edu',
      tags: ['healthcare', 'ehr', 'cloud-migration', 'compliance'],
      usageCount: 1,
      daysSinceUsed: 30,
    },
    {
      id: '4ef00000-0000-4000-8000-000000000003',
      companyNorm: 'dnb-bank',
      title: 'DNB Bank — Multi-region cloud landing zone',
      description:
        'Designed and rolled out a multi-region cloud landing zone with policy-as-code guardrails, enabling compliant workload onboarding across the Nordics.',
      industry: 'financial_services',
      valueMicros: BigInt(2_700_000) * 1_000_000n,
      contactName: null,
      contactEmail: null,
      tags: ['cloud', 'landing-zone', 'governance', 'nordics'],
      usageCount: 0,
      daysSinceUsed: null,
    },
  ];
  for (const r of fixtureReferences) {
    const companyId = companyIdByNorm.get(r.companyNorm) ?? null;
    const lastUsedAt =
      r.daysSinceUsed !== null ? new Date(Date.now() - r.daysSinceUsed * 86_400_000) : null;
    await prisma.reference.upsert({
      where: { id: r.id },
      create: {
        id: r.id,
        orgId: org.id,
        companyId,
        title: r.title,
        description: r.description,
        industry: r.industry,
        valueMicros: r.valueMicros,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        tags: r.tags,
        usageCount: r.usageCount,
        lastUsedAt,
      },
      update: {
        companyId,
        title: r.title,
        description: r.description,
        industry: r.industry,
        valueMicros: r.valueMicros,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        tags: r.tags,
        usageCount: r.usageCount,
        lastUsedAt,
      },
    });
  }
  console.log(`  ✓ references: ${fixtureReferences.length}`);

  // ─── Analytics dashboard (F9) ──────────────────────────────────────────────
  // GET /api/v1/dashboards is org-scoped and (for non-admins) filtered to shared
  // or owned dashboards. No dashboard is seeded, so the /analytics door opens
  // empty. Seed one shared dashboard with two widgets so it is alive on first
  // open. Widget `type` values match the AnalyticsWidgetType enum the strict GET
  // response schema validates. Idempotent: upsert by stable id.
  const dashboardId = 'da5b0000-0000-4000-8000-000000000001';
  await prisma.analyticsDashboard.upsert({
    where: { id: dashboardId },
    create: {
      id: dashboardId,
      orgId: org.id,
      ownerId: seedUserId,
      name: 'Pre-sales Command Center',
      description: 'Pipeline health, win rate, and bid coverage at a glance.',
      isShared: true,
    },
    update: {
      name: 'Pre-sales Command Center',
      description: 'Pipeline health, win rate, and bid coverage at a glance.',
      isShared: true,
    },
  });
  const dashboardWidgets: Array<{
    id: string;
    title: string;
    type: string;
    config: Prisma.InputJsonValue;
    position: Prisma.InputJsonValue;
  }> = [
    {
      id: 'da5b0000-0000-4000-8000-000000000011',
      title: 'Weighted Pipeline',
      type: 'kpi',
      config: { format: 'currency', subtitle: 'Open opportunities, probability-weighted' },
      position: { x: 0, y: 0, w: 3, h: 2 },
    },
    {
      id: 'da5b0000-0000-4000-8000-000000000012',
      title: 'Pipeline by Stage',
      type: 'bar',
      config: { subtitle: 'Open opportunity value grouped by sales stage' },
      position: { x: 3, y: 0, w: 6, h: 4 },
    },
  ];
  for (const w of dashboardWidgets) {
    await prisma.analyticsDashboardWidget.upsert({
      where: { id: w.id },
      create: {
        id: w.id,
        orgId: org.id,
        dashboardId,
        title: w.title,
        type: w.type,
        config: w.config,
        position: w.position,
      },
      update: { title: w.title, type: w.type, config: w.config, position: w.position },
    });
  }
  console.log(`  ✓ analytics dashboard: 1 (+${dashboardWidgets.length} widgets)`);

  console.log('✅ Seed complete.');
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
