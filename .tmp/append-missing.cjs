const fs = require('fs');
const CRM_PATH = 'apps/api/src/routes/crm.ts';
let content = fs.readFileSync(CRM_PATH, 'utf8');

// Remove trailing whitespace/newlines to avoid double blank lines
content = content.replace(/\n+$/, '');

const append = "\n\n" +
"async function tableExists(tableName: string): Promise<boolean> {\n" +
"  const rows = await prisma.$queryRaw<Array<{ tableName: string | null }>>`\n" +
"    SELECT to_regclass(${`public.${tableName}`})::text AS \"tableName\"\n" +
"  `;\n" +
"  return Boolean(rows[0]?.tableName);\n" +
"}\n" +
"\n" +
"function normalizeCountry(country: string | null | undefined) {\n" +
"  if (!country) return null;\n" +
"  const normalized = country.trim().toUpperCase();\n" +
"  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;\n" +
"}\n" +
"\n" +
"function safeErrorMessage(err: unknown): string {\n" +
"  if (!(err instanceof Error)) return 'Unknown error';\n" +
"  return err.message.replace(/Bearer\\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');\n" +
"}\n";

fs.writeFileSync(CRM_PATH, content + append);
console.log('Appended missing functions to', CRM_PATH);
