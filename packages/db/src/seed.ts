// Seeds the local Postgres with the prototype's fixtures so the API + web app
// have realistic data on first boot. Idempotent: re-running upserts.
//
// Maps prototype stage names to the canonical enum:
//   qualifying  -> qualified
//   won         -> closed_won
//   lost        -> closed_lost

import { type Prisma, PrismaClient } from '../generated/client/index.js';
import { fixtureContacts, fixtureOpps, fixtureTasks, fixtureUsers, intelFor } from './seed-data.js';

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
        valueEur: o.value,
        probability: o.probability,
        dueDate: o.dueDate ? new Date(o.dueDate) : null,
        ownerId,
        industry: o.industry,
        logoUrl: o.logoUrl,
        intel: intelFor(o.code) as Prisma.InputJsonValue,
      },
      update: {
        stage: o.stage,
        valueEur: o.value,
        probability: o.probability,
        dueDate: o.dueDate ? new Date(o.dueDate) : null,
        ownerId,
        intel: intelFor(o.code) as Prisma.InputJsonValue,
      },
    });
  }
  console.log(`  ✓ opps:  ${fixtureOpps.length}`);

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
