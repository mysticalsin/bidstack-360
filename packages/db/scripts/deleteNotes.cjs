async function main() {
  const { PrismaClient } = await import('../generated/client/index.js');
  const prisma = new PrismaClient();

  const result = await prisma.note.deleteMany({
    where: {
      title: {
        contains: 'Meeting Import'
      }
    }
  });

  console.warn(`Deleted ${result.count} notes containing 'Meeting Import'.`);
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
