/**
 * One watchdog news pass outside BullMQ (v22). Used by the Cloudflare preview
 * loop so the preview gets live news without running the whole worker.
 *
 *   DATABASE_URL=... REDIS_URL=... WATCHDOG_NEWS_SOURCES=gdelt,google_news,company_rss \
 *     tsx src/scripts/news-scan-once.ts
 *
 * Responses are cached in Redis (6 h by default) under watchdog:news:*, so a
 * restart does not re-hit the sources. Prints counts only, never URLs with
 * credentials or env values.
 */
import { prisma } from '@bidstack/db';
import { Redis } from 'ioredis';

import { memoryNewsCache, redisNewsCache, type NewsCache } from '../lib/watchdog/news.js';
import { runNewsScan } from '../lib/watchdog/news-scan.js';

const out = (o: object) => process.stdout.write(`${JSON.stringify(o)}\n`);

async function main() {
  let redis: Redis | null = null;
  let cache: NewsCache = memoryNewsCache();
  if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    try {
      await redis.connect();
      cache = redisNewsCache(redis);
    } catch {
      redis = null; // memory cache for this pass
    }
  }
  const log = {
    info: (o: object, m?: string) => out({ level: 'info', msg: m, ...o }),
    warn: (o: object, m?: string) => out({ level: 'warn', msg: m, ...o }),
  };
  const started = new Date();
  const s = await runNewsScan({ cache, log });
  out(
    {
      at: started.toISOString(),
      enabled: s.enabled,
      accounts: s.accounts,
      inserted: s.inserted,
      merged: s.merged,
      dropped: s.dropped,
      skippedNoIdentifiers: s.skippedNoIdentifiers,
      errored: s.errored,
      gdelt: s.gdelt,
      perAccount: s.perAccount,
    },
  );
  await redis?.quit().catch(() => undefined);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(JSON.stringify({ level: 'error', msg: err instanceof Error ? err.message : String(err) }));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
