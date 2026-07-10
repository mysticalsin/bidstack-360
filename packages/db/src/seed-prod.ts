/**
 * seed-prod.ts — production bootstrap: system rows ONLY, zero fixture data.
 *
 * Creates (idempotently):
 *  - the Org row for your Clerk organization (auth 404s "Organization not
 *    registered" until this exists — there is no runtime org auto-provisioning)
 *  - the org's system roles + global permission manifest (seedRolesAndPermissions);
 *    without the seeded `Admin` role the JIT admin grant at first sign-in is
 *    skipped and every permission gate returns 403.
 *
 * It creates NO users: users are JIT-provisioned from Clerk on first sign-in
 * (apps/api/src/plugins/auth.ts), and Clerk org-admins receive the Admin role
 * automatically. Real data then enters via the UI, CSV import, or integrations.
 *
 * Usage:
 *   pnpm db:seed:prod -- --clerk-org org_2abc... --name "Mantu"
 *
 * Safe to re-run: org is upserted by clerkOrg, RBAC rows are upserted in place.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import dotenvFlow from 'dotenv-flow';

import { PrismaClient } from '../generated/client/index.js';
import { seedRolesAndPermissions } from './seed.rbac.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

const prisma = new PrismaClient();

async function main() {
  const { values } = parseArgs({
    // pnpm forwards the `--` separator itself, which makes parseArgs treat
    // everything after it as positionals — strip the separator tokens.
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      'clerk-org': { type: 'string' },
      name: { type: 'string' },
    },
  });
  const clerkOrg = values['clerk-org'];
  const name = values.name;

  if (!clerkOrg || !name) {
    console.error(
      'Usage: pnpm db:seed:prod -- --clerk-org <clerk org id, e.g. org_2abc...> --name "<Organization name>"',
    );
    process.exitCode = 1;
    return;
  }
  if (clerkOrg === 'org_seed_mantu' || clerkOrg.startsWith('demo_org_')) {
    console.error(
      `Refusing to bootstrap "${clerkOrg}": that identifier is reserved for dev/demo seeds. ` +
        'Use the real Clerk organization id (Clerk Dashboard -> Organizations).',
    );
    process.exitCode = 1;
    return;
  }

  const org = await prisma.org.upsert({
    where: { clerkOrg },
    create: { clerkOrg, name },
    update: { name },
  });

  await seedRolesAndPermissions(prisma, org.id, new Map());

  const roleCount = await prisma.role.count({
    where: { orgId: org.id, isSystem: true, deletedAt: null },
  });

  console.log(`✅ Production org ready: ${org.name} (id=${org.id}, clerkOrg=${clerkOrg})`);
  console.log(`   System roles seeded: ${roleCount} (permission manifest synced)`);
  console.log('   Zero fixture/demo data was created.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Sign in through the app with a Clerk member of this organization.');
  console.log('     Org admins are granted the Admin role automatically on first sign-in.');
  console.log('  2. Load real data: Settings -> Import (CSV) or connect integrations.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
