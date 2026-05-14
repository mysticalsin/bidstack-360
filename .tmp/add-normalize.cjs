const fs = require('fs');
const path = 'apps/api/src/services/crm/dashboard.service.ts';
let content = fs.readFileSync(path, 'utf8');

const missing = "\n\n" +
"export function normalizeDomain(domain: string | null | undefined) {\n" +
"  if (!domain) return null;\n" +
"  return domain\n" +
"    .replace(/^https?:\\/\\//, '')\n" +
"    .replace(/^www\\./, '')\n" +
"    .replace(/\\/.*$/, '')\n" +
"    .toLowerCase();\n" +
"}\n" +
"\n" +
"export function normalizeRegistryValue(value: string) {\n" +
"  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();\n" +
"}\n" +
"\n" +
"export function normalizeName(value: string) {\n" +
"  return value\n" +
"    .trim()\n" +
"    .toLowerCase()\n" +
"    .replace(/[^a-z0-9]+/g, '-')\n" +
"    .replace(/^-|-$/g, '');\n" +
"}\n";

fs.writeFileSync(path, content + missing);
console.log('Added missing normalize functions');
