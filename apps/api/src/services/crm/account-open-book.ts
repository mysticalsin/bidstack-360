// Full open book by stage for the All accounts chart. The dashboard deal
// array is take:100, so a sum of that page drops every later deal. Postgres
// returns integer micros text for the accounts currently in the view.
// Closed won, closed lost, and a live won or lost flag stay out, matching
// OPEN_OPPORTUNITY_SQL. A deleted stage row does not erase the enum.
import { Prisma, type PrismaClient } from '@bidstack/db';

import type { AccessScope } from '../../lib/access-scope.js';
import { OPEN_OPPORTUNITY_SQL, opportunityVisibilitySql } from './dashboard.queries.js';
import { isCompanyUuid, mapDealStage, opportunityCustomerKeySql } from './dashboard.utils.js';

const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export interface AccountBookQueryRow {
  stageKey: unknown;
  stageName: unknown;
  count: unknown;
  valueSumMicros: unknown;
}

export interface AccountBookStageTotal {
  stage: string;
  stageName: string | null;
  count: number;
  valueSumMicros: string;
}

function companyMatchSql(companyIds: readonly string[]): Prisma.Sql | null {
  const uuids: string[] = [];
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const raw of companyIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (isCompanyUuid(id)) uuids.push(id);
    else slugs.push(id);
  }
  uuids.sort();
  slugs.sort();
  const parts: Prisma.Sql[] = [];
  if (uuids.length > 0) {
    parts.push(
      Prisma.sql`o.company_id IN (${Prisma.join(uuids.map((id) => Prisma.sql`${id}::uuid`))})`,
    );
  }
  if (slugs.length > 0) {
    // Opportunity-only accounts use normalizeName(customer) as their id.
    // Casting that slug to uuid would throw and drop the account's book.
    parts.push(
      Prisma.sql`${Prisma.raw(opportunityCustomerKeySql('o.customer'))} IN (${Prisma.join(slugs)})`,
    );
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

/**
 * Open deals for the accounts in the current view. No row limit. The caller
 * passes the view's company ids, and the visibility predicate is the same
 * country / territory / owner rule as the dashboard opportunity load.
 */
export function openAccountBookQuery(
  orgId: string,
  companyIds: readonly string[],
  scope: AccessScope,
): Prisma.Sql | null {
  const match = companyMatchSql(companyIds);
  if (!match) return null;
  const visibility = opportunityVisibilitySql(scope);
  return Prisma.sql`
    SELECT
      CASE
        WHEN stage_row.id IS NOT NULL AND stage_row.deleted_at IS NULL THEN stage_row.key
        ELSE o.stage::text
      END AS "stageKey",
      CASE
        WHEN stage_row.id IS NOT NULL AND stage_row.deleted_at IS NULL THEN NULLIF(btrim(stage_row.name), '')
        ELSE NULL
      END AS "stageName",
      COUNT(*)::int AS "count",
      COALESCE(SUM(GREATEST(o.value_micros, 0))::text, '0') AS "valueSumMicros"
    FROM opportunities o
    LEFT JOIN pipeline_stages stage_row ON stage_row.id = o.pipeline_stage_id
    ${visibility.join}
    WHERE o.org_id = ${orgId}::uuid
      AND o.deleted_at IS NULL
      AND (${Prisma.raw(OPEN_OPPORTUNITY_SQL)})
      AND (${match})
      ${visibility.where}
    GROUP BY 1, 2
  `;
}

function microsFromDbText(value: unknown): bigint {
  if (typeof value === 'bigint') return value < 0n ? 0n : value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new Error('account book sum is not integer micros text');
}

function countFromDb(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'bigint' && value >= 0n && value <= SAFE) return Number(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = BigInt(value);
    if (parsed <= SAFE) return Number(parsed);
  }
  throw new Error('account book count is not an integer');
}

function stageNameFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const named = value.trim();
  return named.length > 0 ? named : null;
}

/** Map query groups onto the account stage key and add micros as integers. */
export function accountBookStagesFromRows(rows: readonly AccountBookQueryRow[]): AccountBookStageTotal[] {
  const grouped = new Map<string, { stage: string; stageName: string | null; count: number; amount: bigint }>();
  for (const row of rows) {
    if (typeof row.stageKey !== 'string' || row.stageKey.trim().length === 0) {
      throw new Error('account book stage key is missing');
    }
    const stage = mapDealStage(row.stageKey.trim());
    if (CLOSED_STAGES.has(stage)) continue;
    const stageName = stageNameFrom(row.stageName);
    const key = `${stage}\u0000${stageName ?? ''}`;
    const current = grouped.get(key) ?? { stage, stageName, count: 0, amount: 0n };
    current.count += countFromDb(row.count);
    current.amount += microsFromDbText(row.valueSumMicros);
    grouped.set(key, current);
  }
  return [...grouped.values()].map((row) => ({
    stage: row.stage,
    stageName: row.stageName,
    count: row.count,
    valueSumMicros: row.amount.toString(),
  }));
}

export async function fetchAccountOpenBook(
  db: Pick<PrismaClient, '$queryRaw'>,
  orgId: string,
  companyIds: readonly string[],
  scope: AccessScope,
): Promise<AccountBookStageTotal[]> {
  const query = openAccountBookQuery(orgId, companyIds, scope);
  if (!query) return [];
  const rows = await db.$queryRaw<AccountBookQueryRow[]>(query);
  return accountBookStagesFromRows(rows);
}
