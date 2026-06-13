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
