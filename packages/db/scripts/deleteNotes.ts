import { prisma } from '../src/index.js';

async function main() {
  const result = await prisma.note.deleteMany({
    where: {
      title: {
        startsWith: 'Meeting Import',
      },
    },
  });

  console.warn(`Deleted ${result.count} notes starting with 'Meeting Import'.`);

  // Also check if any notes *contain* "Meeting Import" just to be sure.
  const resultContains = await prisma.note.deleteMany({
    where: {
      title: {
        contains: 'Meeting Import',
      },
    },
  });
  console.warn(`Deleted ${resultContains.count} additional notes containing 'Meeting Import'.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
