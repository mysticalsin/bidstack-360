/**
 * One financials pass outside BullMQ (v23). Used by the Cloudflare preview
 * loop. Only Strategic/Top accounts (or opted-in ones) are pulled.
 *
 *   DATABASE_URL=... SEC_USER_AGENT="App/1.0 (contact@example.com)" \
 *     tsx src/scripts/financials-scan-once.ts
 *
 * Prints counts and statuses only.
 */
import { prisma } from '@bidstack/db';

import { runFinancialsScan } from '../lib/financials/scan.js';

const out = (o: object) => process.stdout.write(`${JSON.stringify(o)}\n`);

async function main() {
  const started = new Date();
  const s = await runFinancialsScan({
    log: { info: (o, m) => out({ level: 'info', msg: m, ...o }), warn: (o, m) => out({ level: 'warn', msg: m, ...o }) },
  });
  out({
    at: started.toISOString(),
    scheduled: s.scheduled,
    paused: s.paused,
    due: s.due,
    pulled: s.pulled.map((p) => ({ name: p.name, status: p.status, source: p.source, periods: p.periods, signals: p.signals })),
  });
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(JSON.stringify({ level: 'error', msg: err instanceof Error ? err.message : String(err) }));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
