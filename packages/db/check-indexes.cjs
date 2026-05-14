const { PrismaClient } = require('./generated/client');
const prisma = new PrismaClient();
prisma.$queryRawUnsafe(
  "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('opps_org_customer_idx','contacts_org_customer_idx','tasks_org_assignee_idx')"
).then(rows => {
  console.log(JSON.stringify(rows, null, 2));
  return prisma.$disconnect();
}).catch(e => {
  console.error(e);
  prisma.$disconnect();
});
