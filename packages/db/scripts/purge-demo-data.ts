/**
 * purge-demo-data.ts — remove dev/demo/test data so a database can hold real
 * production data. DRY-RUN by default; nothing is deleted without --apply.
 *
 * What it can remove:
 *   --seed-org      the fixture org created by `pnpm db:seed`
 *                   (clerkOrg=org_seed_mantu: Jane Smith & co, prototype
 *                   companies/opportunities/leads/tasks)
 *   --demo-orgs     every org created by `pnpm db:seed:demo`
 *                   (clerkOrg LIKE 'demo_org_%')
 *   --test-orgs     leftover isolated integration-test orgs
 *                   (clerkOrg 'org_<label>_t<12-hex>' from
 *                   apps/api/src/test-support/isolated-org.ts — teardown is
 *                   best-effort, so aborted runs accumulate)
 *   --synthetic <clerkOrg|orgId>
 *                   synthetic E2E/fixture COMPANIES that leaked into the given
 *                   org (SCOPE-*, E2E *, Audit Company, KAMDraft-*,
 *                   ConvertCorp-*, approve-gate/proposal*, "* account QQ/ZZ",
 *                   Test *, lowercase-slug *-test). Mirrors
 *                   apps/web/src/pages/accountsPage/testDataFilter.ts — keep in
 *                   sync. Real Title-Case names ("Acme Test Corp") never match.
 *
 * Usage:
 *   pnpm db:purge:demo -- --seed-org --demo-orgs             # dry-run report
 *   pnpm db:purge:demo -- --seed-org --demo-orgs --apply     # delete
 *   pnpm db:purge:demo -- --synthetic org_2abc... --apply
 *
 * Org removal relies on the schema's onDelete: Cascade relations. Any table
 * that blocks the cascade (P2003) is reported loudly — nothing is silently
 * skipped. Take a backup before --apply on anything you care about.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import dotenvFlow from 'dotenv-flow';

import { PrismaClient } from '../generated/client/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

const prisma = new PrismaClient();

// Mirror of apps/web/src/pages/accountsPage/testDataFilter.ts SYNTHETIC_PATTERNS.
const SYNTHETIC_PATTERNS: RegExp[] = [
  /^SCOPE-/i,
  /^E2E\b/i,
  /^Audit Company\b/i,
  /^KAMDraft-/i,
  /^ConvertCorp-/i,
  /^(AP)?approve-(gate|proposal)/i,
  /\baccount (QQ|ZZ)$/i,
  /^Test /i,
  /^[a-z0-9-]+-test$/,
];

interface OrgSummary {
  id: string;
  clerkOrg: string;
  name: string;
  users: number;
  companies: number;
  contacts: number;
  opportunities: number;
  leads: number;
  tasks: number;
}

async function summarizeOrg(id: string, clerkOrg: string, name: string): Promise<OrgSummary> {
  const [users, companies, contacts, opportunities, leads, tasks] = await Promise.all([
    prisma.user.count({ where: { orgId: id } }),
    prisma.company.count({ where: { orgId: id } }),
    prisma.contact.count({ where: { orgId: id } }),
    prisma.opportunity.count({ where: { orgId: id } }),
    prisma.lead.count({ where: { orgId: id } }),
    prisma.task.count({ where: { orgId: id } }),
  ]);
  return { id, clerkOrg, name, users, companies, contacts, opportunities, leads, tasks };
}

function printSummary(s: OrgSummary): void {
  console.log(
    `  - ${s.name} (clerkOrg=${s.clerkOrg}, id=${s.id}): ` +
      `${s.users} users, ${s.companies} companies, ${s.contacts} contacts, ` +
      `${s.opportunities} opportunities, ${s.leads} leads, ${s.tasks} tasks`,
  );
}

async function deleteOrg(id: string): Promise<void> {
  try {
    await prisma.org.delete({ where: { id } });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'P2003') {
      console.error(
        `  ✗ org ${id}: a relation without onDelete: Cascade blocked the delete. ` +
          'Nothing was removed for this org. Inspect the constraint in the error below and ' +
          'delete that table for this org first.',
      );
    }
    throw err;
  }
}

async function purgeOrgs(where: { clerkOrg: string } | { clerkOrg: { startsWith: string } },
  label: string,
  apply: boolean,
): Promise<number> {
  const orgs = await prisma.org.findMany({
    where,
    select: { id: true, clerkOrg: true, name: true },
  });
  if (orgs.length === 0) {
    console.log(`${label}: none found.`);
    return 0;
  }
  console.log(`${label}: ${orgs.length} org(s)`);
  for (const org of orgs) {
    printSummary(await summarizeOrg(org.id, org.clerkOrg, org.name));
    if (apply) {
      await deleteOrg(org.id);
      console.log('    ✓ deleted');
    }
  }
  return orgs.length;
}

// Isolated-test orgs can't be matched with a single startsWith (label varies),
// so fetch org_* candidates and filter on the full t<hex> namespace shape.
const TEST_ORG_PATTERN = /^org_[a-z0-9-]+_t[0-9a-f]{12}$/i;

async function purgeTestOrgs(apply: boolean): Promise<void> {
  const candidates = await prisma.org.findMany({
    where: { clerkOrg: { startsWith: 'org_' } },
    select: { id: true, clerkOrg: true, name: true },
  });
  const testOrgs = candidates.filter((o) => TEST_ORG_PATTERN.test(o.clerkOrg));
  if (testOrgs.length === 0) {
    console.log('Leftover test orgs: none found.');
    return;
  }
  console.log(`Leftover test orgs: ${testOrgs.length} org(s)`);
  for (const org of testOrgs) {
    printSummary(await summarizeOrg(org.id, org.clerkOrg, org.name));
    if (apply) {
      await deleteOrg(org.id);
      console.log('    ✓ deleted');
    }
  }
}

async function purgeSynthetic(orgRef: string, apply: boolean): Promise<void> {
  const org = await prisma.org.findFirst({
    where: { OR: [{ id: orgRef }, { clerkOrg: orgRef }] },
    select: { id: true, clerkOrg: true, name: true },
  });
  if (!org) {
    console.error(`--synthetic: org "${orgRef}" not found (tried id and clerkOrg).`);
    process.exitCode = 1;
    return;
  }
  const companies = await prisma.company.findMany({
    where: { orgId: org.id },
    select: { id: true, name: true },
  });
  const synthetic = companies.filter((c) => SYNTHETIC_PATTERNS.some((re) => re.test(c.name.trim())));
  console.log(
    `Synthetic companies in ${org.name} (${org.clerkOrg}): ${synthetic.length} of ${companies.length}`,
  );
  for (const c of synthetic) {
    console.log(`  - ${c.name} (${c.id})`);
    if (apply) {
      try {
        await prisma.company.delete({ where: { id: c.id } });
        console.log('    ✓ deleted');
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === 'P2003') {
          console.error(
            '    ✗ blocked by a non-cascading relation — delete its dependents first (left in place)',
          );
        } else {
          throw err;
        }
      }
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      'seed-org': { type: 'boolean', default: false },
      'demo-orgs': { type: 'boolean', default: false },
      'test-orgs': { type: 'boolean', default: false },
      synthetic: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });

  const apply = values.apply === true;
  const anyTarget =
    values['seed-org'] || values['demo-orgs'] || values['test-orgs'] || values.synthetic;
  if (!anyTarget) {
    console.error(
      'Nothing selected. Pass at least one of: --seed-org, --demo-orgs, --test-orgs, ' +
        '--synthetic <clerkOrg|orgId>. Add --apply to actually delete (dry-run otherwise).',
    );
    process.exitCode = 1;
    return;
  }

  console.log(apply ? '⚠️  APPLY MODE — rows will be deleted.' : '🔎 DRY RUN — nothing will be deleted.');

  if (values['seed-org']) {
    await purgeOrgs({ clerkOrg: 'org_seed_mantu' }, 'Fixture seed org', apply);
  }
  if (values['demo-orgs']) {
    await purgeOrgs({ clerkOrg: { startsWith: 'demo_org_' } }, 'Demo orgs', apply);
  }
  if (values['test-orgs']) {
    await purgeTestOrgs(apply);
  }
  if (values.synthetic) {
    await purgeSynthetic(values.synthetic, apply);
  }

  if (!apply) {
    console.log('');
    console.log('Re-run with --apply to delete the rows listed above. Back up first.');
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
