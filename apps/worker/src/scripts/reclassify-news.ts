/**
 * Re-run the headline classifier over stored news rows (v22.1), e.g. after the
 * Market / analyst category landed. Touches only live news sources, keeps
 * status, mentions and dedupe keys, and prints counts only.
 *
 *   DATABASE_URL=... tsx src/scripts/reclassify-news.ts
 */
import { prisma, type Prisma } from '@bidstack/db';
import { classifySignalText, importanceScore, severityFromImportance } from '@bidstack/shared';

import { RATIONALE } from '../lib/watchdog/news.js';

const out = (o: object) => process.stdout.write(`${JSON.stringify(o)}\n`);

async function main() {
  const rows = await prisma.accountWatchEvent.findMany({
    where: { sample: false, source: { in: ['gdelt', 'google_news', 'company_rss'] } },
    select: { id: true, title: true, summary: true, kind: true, source: true, mentions: true, payload: true },
    take: 5000,
  });
  let changed = 0;
  const byKind: Record<string, number> = {};
  for (const r of rows) {
    const c = classifySignalText(r.title, r.summary === r.title ? '' : (r.summary ?? ''));
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    if (c.kind === r.kind) continue;
    const importance = importanceScore({ kind: c.kind, implication: c.implication, source: r.source, mentions: r.mentions });
    const payload = { ...((r.payload as Record<string, unknown>) ?? {}), rule: c.rule, category: c.category };
    await prisma.accountWatchEvent.update({
      where: { id: r.id },
      data: {
        kind: c.kind,
        implication: c.implication,
        implicationRationale: RATIONALE[c.kind] ?? `Classified by ${c.rule}.`,
        sentiment: c.sentiment,
        importance,
        severity: severityFromImportance(importance),
        payload: payload as Prisma.InputJsonValue,
      },
    });
    changed++;
  }
  out({ scanned: rows.length, changed, byKind });
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(JSON.stringify({ level: 'error', msg: err instanceof Error ? err.message : String(err) }));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
