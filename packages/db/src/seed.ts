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
