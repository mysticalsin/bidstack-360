/**
 * Analyze slow queries from PostgreSQL pg_stat_statements.
 *
 * Requirements:
 * - pg_stat_statements extension must be enabled in Postgres
 * - Connects via DATABASE_URL env var
 *
 * Outputs:
 * - Top 20 slowest queries by total_exec_time
 * - Queries with high calls but low avg_time (N+1 candidates)
 * - Missing index heuristics based on seq_scan ratios
 */

import { PrismaClient } from '../generated/client/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

async function main() {
  try {
    // Ensure pg_stat_statements is available
    const extCheck = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`
    );
    if (!Array.isArray(extCheck) || extCheck.length === 0) {
          // eslint-disable-next-line no-console
      console.warn('pg_stat_statements extension is not installed.');
      // eslint-disable-next-line no-console
      console.warn('Enable it with: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;');
      return;
    }

    // eslint-disable-next-line no-console
    console.warn('\n=== TOP 20 SLOWEST QUERIES (by total time) ===\n');
    const slow = await prisma.$queryRawUnsafe(`
      SELECT
        queryid,
        LEFT(query, 120) AS query_preview,
        calls,
        ROUND(total_exec_time::numeric, 2) AS total_ms,
        ROUND(mean_exec_time::numeric, 2) AS avg_ms,
        ROUND(stddev_exec_time::numeric, 2) AS stddev_ms,
        rows
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY total_exec_time DESC
      LIMIT 20
    `);
    // eslint-disable-next-line no-console
    console.table(slow);

    // eslint-disable-next-line no-console
    console.warn('\n=== HIGH-CALL COUNT QUERIES (N+1 candidates) ===\n');
    const highCall = await prisma.$queryRawUnsafe(`
      SELECT
        queryid,
        LEFT(query, 120) AS query_preview,
        calls,
        ROUND(mean_exec_time::numeric, 2) AS avg_ms,
        rows
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND calls > 1000
        AND mean_exec_time < 10
      ORDER BY calls DESC
      LIMIT 20
    `);
    // eslint-disable-next-line no-console
    console.table(highCall);

    // eslint-disable-next-line no-console
    console.warn('\n=== TABLE SCAN ANALYSIS (potential missing indexes) ===\n');
    const scans = await prisma.$queryRawUnsafe(`
      SELECT
        schemaname,
        relname AS table_name,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_live_tup AS estimated_rows,
        CASE
          WHEN seq_scan > 0 AND (idx_scan IS NULL OR idx_scan = 0) THEN 'LIKELY MISSING INDEX'
          WHEN seq_scan > idx_scan THEN 'HEAVY SEQ_SCAN'
          ELSE 'OK'
        END AS recommendation
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
        AND n_live_tup > 1000
      ORDER BY seq_tup_read DESC
      LIMIT 20
    `);
    // eslint-disable-next-line no-console
    console.table(scans);

    // eslint-disable-next-line no-console
    console.warn('\n=== INDEX USAGE FOR TOP TABLES ===\n');
    const indexes = await prisma.$queryRawUnsafe(`
      SELECT
        schemaname,
        relname AS table_name,
        indexrelname AS index_name,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
      ORDER BY idx_scan DESC
      LIMIT 20
    `);
    // eslint-disable-next-line no-console
    console.table(indexes);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
