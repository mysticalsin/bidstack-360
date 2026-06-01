/**
 * seed-demo.ts — CLI to create a fresh demo org and populate it with the curated
 * dataset (see seed-org-data.ts). Run with `pnpm db:seed:demo`.
 *
 * Each run creates a NEW org so you can eyeball the exact data a demo visitor
 * lands in. Safe to run repeatedly — orgs are namespaced by a timestamp slug.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenvFlow from 'dotenv-flow';

import { PrismaClient } from '../generated/client/index.js';
import { seedOrgData } from './seed-org-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

const prisma = new PrismaClient();

async function main() {
  const stamp = Date.now().toString(36);
  const clerkOrg = `demo_org_${stamp}`;

  console.log('🌱 Seeding a fresh BidStack demo workspace…');
  const org = await prisma.org.create({
    data: { clerkOrg, name: 'BidStack Demo Workspace' },
  });

  await seedOrgData(prisma, org.id, {
    ownerEmail: `demo+${stamp}@bidstack-demo.dev`,
    ownerName: 'Demo User',
    namespace: stamp,
  });

  const [opps, proposals, leads, contacts, tasks, users] = await Promise.all([
    prisma.opportunity.count({ where: { orgId: org.id } }),
    prisma.proposal.count({ where: { orgId: org.id } }),
    prisma.lead.count({ where: { orgId: org.id } }),
    prisma.contact.count({ where: { orgId: org.id } }),
    prisma.task.count({ where: { orgId: org.id } }),
    prisma.user.count({ where: { orgId: org.id } }),
  ]);

  console.log(`✅ Demo org seeded: ${org.id} (clerkOrg=${clerkOrg})`);
  console.log(
    `   users=${users} opps=${opps} proposals=${proposals} leads=${leads} contacts=${contacts} tasks=${tasks}`,
  );
}

main()
  .catch((err) => {
    console.error('❌ Demo seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
