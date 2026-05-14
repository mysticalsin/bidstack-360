// Seeds the local Postgres with the prototype's fixtures so the API + web app
// have realistic data on first boot. Idempotent: re-running upserts.
//
// Maps prototype stage names to the canonical enum:
//   qualifying  -> qualified
//   won         -> closed_won
//   lost        -> closed_lost

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
import {
  fixtureProductCategories,
  fixtureProducts,
  fixtureSalesCustomers,
  fixtureSalesOrders,
} from './sales-seed-data.js';

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

  // ─── Sales module — categories, products, orders ──────────────────────
  const categoryIds = new Map<string, string>();
  for (const name of fixtureProductCategories) {
    const cat = await prisma.productCategory.upsert({
      where: { orgId_name: { orgId: org.id, name } },
      create: { orgId: org.id, name },
      update: {},
    });
    categoryIds.set(name, cat.id);
  }
  console.log(`  ✓ product categories: ${fixtureProductCategories.length}`);

  const productIdBySku = new Map<string, string>();
  for (const p of fixtureProducts) {
    const product = await prisma.product.upsert({
      where: { orgId_sku: { orgId: org.id, sku: p.sku } },
      create: {
        orgId: org.id,
        sku: p.sku,
        name: p.name,
        categoryId: categoryIds.get(p.category) ?? null,
        listPriceMicros: BigInt(Math.round(p.listPrice * 1_000_000)),
        currency: p.currency,
      },
      update: {
        name: p.name,
        categoryId: categoryIds.get(p.category) ?? null,
        listPriceMicros: BigInt(Math.round(p.listPrice * 1_000_000)),
        currency: p.currency,
      },
    });
    productIdBySku.set(p.sku, product.id);
  }
  console.log(`  ✓ products: ${fixtureProducts.length}`);

  // Quick lookups for orders
  const userByEmail = new Map<string, string>();
  for (const u of fixtureUsers) {
    const userRow = await prisma.user.findUnique({ where: { email: u.email } });
    if (userRow) userByEmail.set(u.email, userRow.id);
  }
  const customerByName = new Map(fixtureSalesCustomers.map((c) => [c.name, c]));

  for (const so of fixtureSalesOrders) {
    const customer = customerByName.get(so.customerName);
    if (!customer) continue;
    const orderDate = new Date(Date.now() - so.daysAgo * 24 * 60 * 60 * 1000);
    const lines = so.lines
      .filter((l) => productIdBySku.has(l.sku))
      .map((l) => {
        const unitMicros = BigInt(Math.round(l.unitPrice * 1_000_000));
        const subtotal = unitMicros * BigInt(l.qty);
        return {
          orgId: org.id,
          productId: productIdBySku.get(l.sku)!,
          description: fixtureProducts.find((p) => p.sku === l.sku)?.name ?? l.sku,
          quantity: l.qty,
          unitPriceMicros: unitMicros,
          subtotalMicros: subtotal,
        };
      });
    const total = lines.reduce((acc, l) => acc + l.subtotalMicros, BigInt(0));

    await prisma.salesOrder.upsert({
      where: { orgId_number: { orgId: org.id, number: so.number } },
      create: {
        orgId: org.id,
        number: so.number,
        state: so.state,
        customerName: so.customerName,
        salespersonId: userByEmail.get(customer.salespersonEmail) ?? null,
        countryCode: customer.countryCode,
        currency: customer.currency,
        totalMicros: total,
        orderDate,
        confirmedAt: so.state === 'confirmed' || so.state === 'done' ? orderDate : null,
        lines: { create: lines },
      },
      update: {
        state: so.state,
        salespersonId: userByEmail.get(customer.salespersonEmail) ?? null,
        countryCode: customer.countryCode,
        currency: customer.currency,
        totalMicros: total,
        orderDate,
        confirmedAt: so.state === 'confirmed' || so.state === 'done' ? orderDate : null,
        // Replace lines deterministically on re-run so quantities stay aligned with the fixture.
        lines: { deleteMany: {}, create: lines },
      },
    });
  }
  console.log(`  ✓ sales orders: ${fixtureSalesOrders.length}`);

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
