import { prisma } from '../src/index';

async function main() {
  process.stdout.write('Dropping index...\n');
  try {
    await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "crew_agents_org_key_key";');
    process.stdout.write('Index dropped successfully!\n');
  } catch (err) {
    console.error('Error dropping index:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
