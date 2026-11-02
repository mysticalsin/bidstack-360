// How many accounts in the current view have gone quiet.
// The company set is the view's ids. Activity is a task or a note linked by
// company UUID: task.account_id, the linked opportunity's company_id, or
// note.company_id. note.account_id counts only when it is itself a company
// UUID. A customer string is not a link. An account with no linked activity
// is quiet.
// Quiet uses the KAM KPI cutoff staleBefore(14): an activity strictly before
// UTC midnight (days-1) days ago. That is 2026-11-02T00:00:00Z when now is
// 2026-11-15T15:00:00Z. The number is accounts, not events. No page limit.
import { Prisma, type PrismaClient } from '@bidstack/db';

import { countryVariantsForScope, type AccessScope } from '../../lib/access-scope.js';
import { opportunityVisibilitySql } from './dashboard.queries.js';
import { isCompanyUuid } from './dashboard.utils.js';

const DAY_MS = 86_400_000;
/** Same window as kam staleBefore(14). */
const QUIET_DAYS = 14;
/** note.account_id is free text. Only a company UUID in that column is a link. */
const NOTE_ACCOUNT_UUID =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export interface QuietAccountActivity {
  occurredAt: string | Date;
  accountId: string | null;
  opportunityCompanyId: string | null;
  /** Ignored. A customer name must not decide the company. */
  customer?: string | null;
}

export interface QuietAccounts {
  /** Accounts in the set whose latest linked activity is before the cutoff, or who have none. */
  accounts: number;
  /** True when every linked task and note for these companies was considered, not one page. */
  complete: boolean;
}

interface QuietActivityRow {
  occurredAt: unknown;
  accountId: unknown;
  opportunityCompanyId: unknown;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueAccountIds(accountIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of accountIds) {
    const id = raw.trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

function companyUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!isCompanyUuid(trimmed)) return null;
  return trimmed.toLowerCase();
}

function uuidList(uuids: readonly string[]): Prisma.Sql {
  return Prisma.join(uuids.map((id) => Prisma.sql`${id}::uuid`));
}

/**
 * UTC midnight (QUIET_DAYS-1) days ago.
 * Same instant as mcp staleBefore(14): activity strictly before this is quiet.
 */
export function quietBefore(now: Date): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - (QUIET_DAYS - 1) * DAY_MS);
}

function occurredMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Company this activity belongs to inside the view.
 * accountId wins when it is one of the companies. Otherwise the deal's company.
 * A customer name is not read. A non-UUID account id is not a link.
 */
function attachedCompanyId(
  activity: QuietAccountActivity,
  allowed: ReadonlySet<string>,
): string | null {
  const account = companyUuid(activity.accountId);
  if (account && allowed.has(account)) return account;
  const deal = companyUuid(activity.opportunityCompanyId);
  if (deal && allowed.has(deal)) return deal;
  return null;
}

/**
 * Accounts in the set with no linked activity, or whose latest one is
 * strictly before quietBefore(now). A later activity on the same account
 * keeps it. A customer string does not.
 */
export function countQuietAccounts(
  companyIds: readonly string[],
  activities: readonly QuietAccountActivity[],
  now: Date,
): number {
  const ids = uniqueAccountIds(companyIds);
  const allowed = new Set(
    ids.map((id) => companyUuid(id)).filter((id): id is string => id !== null),
  );
  const cutoff = quietBefore(now).getTime();
  const latest = new Map<string, number>();
  for (const activity of activities) {
    const companyId = attachedCompanyId(activity, allowed);
    if (!companyId) continue;
    const at = occurredMs(activity.occurredAt);
    if (at == null) continue;
    const prev = latest.get(companyId);
    if (prev == null || at > prev) latest.set(companyId, at);
  }
  let quiet = 0;
  for (const id of ids) {
    const key = id.toLowerCase();
    const at = latest.get(key);
    if (at == null || at < cutoff) quiet += 1;
  }
  return quiet;
}

/** Account-only tasks still have to sit on a company the caller can read. */
function accountOnlyVisibleSql(scope: AccessScope): Prisma.Sql {
  if (scope.unrestricted) return Prisma.sql`TRUE`;
  const variants = countryVariantsForScope(scope);
  const companyCountry =
    variants.length > 0
      ? Prisma.sql`co.country_code = ANY(ARRAY[${Prisma.join(variants)}]::text[]) OR`
      : Prisma.empty;
  const dealCountry =
    variants.length > 0
      ? Prisma.sql`vo.country = ANY(ARRAY[${Prisma.join(variants)}]::text[])
          OR vt.country_codes && ARRAY[${Prisma.join(variants)}]::text[]
          OR`
      : Prisma.empty;
  return Prisma.sql`(
    ${companyCountry}
    co.key_account_owner_id = ${scope.userId}::uuid
    OR EXISTS (
      SELECT 1
      FROM opportunities vo
      LEFT JOIN territories vt ON vt.id = vo.territory_id
      WHERE vo.company_id = task.account_id
        AND vo.org_id = task.org_id
        AND vo.deleted_at IS NULL
        AND (
          ${dealCountry}
          vo.owner_id = ${scope.userId}::uuid
        )
    )
  )`;
}

/** Notes sit on the company. Same country / owner / visible-deal rule. */
function companyVisibleSql(scope: AccessScope): Prisma.Sql {
  if (scope.unrestricted) return Prisma.sql`TRUE`;
  const variants = countryVariantsForScope(scope);
  const companyCountry =
    variants.length > 0
      ? Prisma.sql`co.country_code = ANY(ARRAY[${Prisma.join(variants)}]::text[]) OR`
      : Prisma.empty;
  const dealCountry =
    variants.length > 0
      ? Prisma.sql`vo.country = ANY(ARRAY[${Prisma.join(variants)}]::text[])
          OR vt.country_codes && ARRAY[${Prisma.join(variants)}]::text[]
          OR`
      : Prisma.empty;
  return Prisma.sql`(
    ${companyCountry}
    co.key_account_owner_id = ${scope.userId}::uuid
    OR EXISTS (
      SELECT 1
      FROM opportunities vo
      LEFT JOIN territories vt ON vt.id = vo.territory_id
      WHERE vo.company_id = co.id
        AND vo.org_id = co.org_id
        AND vo.deleted_at IS NULL
        AND (
          ${dealCountry}
          vo.owner_id = ${scope.userId}::uuid
        )
    )
  )`;
}

/** note.account_id cast only after the UUID check. A name must not be cast. */
function noteAccountUuid(): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN note.account_id ~* ${NOTE_ACCOUNT_UUID} THEN note.account_id::uuid
    ELSE NULL
  END`;
}

/**
 * Every task and note that attaches by company UUID.
 * Tasks use the next-open-task country / territory / owner rule, including done tasks.
 * Notes use that rule on the company. No LIMIT.
 */
export function quietAccountQuery(
  orgId: string,
  companyIds: readonly string[],
  scope: AccessScope,
): Prisma.Sql | null {
  const uuids = uniqueAccountIds(companyIds).filter((id) => isCompanyUuid(id));
  if (uuids.length === 0) return null;
  const visibility = opportunityVisibilitySql(scope);
  const companyJoin = scope.unrestricted
    ? Prisma.empty
    : Prisma.sql`LEFT JOIN companies co
      ON co.id = task.account_id
     AND co.org_id = task.org_id
     AND co.deleted_at IS NULL`;
  const noteCompanyJoin = scope.unrestricted
    ? Prisma.empty
    : Prisma.sql`LEFT JOIN companies co
      ON co.id = linked.company_uuid
     AND co.org_id = linked.org_id
     AND co.deleted_at IS NULL`;
  const ids = uuidList(uuids);
  return Prisma.sql`
    SELECT
      task.created_at AS "occurredAt",
      task.account_id::text AS "accountId",
      o.company_id::text AS "opportunityCompanyId"
    FROM tasks task
    LEFT JOIN opportunities o
      ON o.id = task.opp_id
     AND o.org_id = task.org_id
     AND o.deleted_at IS NULL
    ${companyJoin}
    ${visibility.join}
    WHERE task.org_id = ${orgId}::uuid
      AND task.deleted_at IS NULL
      AND (
        (
          o.id IS NULL
          AND task.account_id IN (${ids})
          AND ${accountOnlyVisibleSql(scope)}
        )
        OR (
          o.id IS NOT NULL
          AND (
            task.account_id IN (${uuidList(uuids)})
            OR o.company_id IN (${uuidList(uuids)})
          )
          ${visibility.where}
        )
      )
    UNION ALL
    SELECT
      linked.occurred_at AS "occurredAt",
      linked.company_uuid::text AS "accountId",
      NULL::text AS "opportunityCompanyId"
    FROM (
      SELECT
        note.updated_at AS occurred_at,
        note.org_id,
        COALESCE(
          CASE WHEN note.company_id IN (${uuidList(uuids)}) THEN note.company_id ELSE NULL END,
          ${noteAccountUuid()}
        ) AS company_uuid
      FROM notes note
      WHERE note.org_id = ${orgId}::uuid
        AND note.deleted_at IS NULL
        AND (
          note.company_id IN (${uuidList(uuids)})
          OR ${noteAccountUuid()} IN (${uuidList(uuids)})
        )
    ) linked
    ${noteCompanyJoin}
    WHERE linked.company_uuid IS NOT NULL
      AND ${companyVisibleSql(scope)}
  `;
}

function activityFromRow(row: QuietActivityRow): QuietAccountActivity | null {
  const at = occurredMs(
    row.occurredAt instanceof Date || typeof row.occurredAt === 'string' ? row.occurredAt : null,
  );
  if (at == null) return null;
  return {
    occurredAt: new Date(at),
    accountId: textOrNull(row.accountId),
    opportunityCompanyId: textOrNull(row.opportunityCompanyId),
  };
}

export async function fetchQuietAccounts(
  db: Pick<PrismaClient, '$queryRaw'>,
  orgId: string,
  companyIds: readonly string[],
  scope: AccessScope,
  now: Date = new Date(),
): Promise<QuietAccounts> {
  const ids = uniqueAccountIds(companyIds);
  const query = quietAccountQuery(orgId, ids, scope);
  if (!query) return { accounts: countQuietAccounts(ids, [], now), complete: true };
  const rows = await db.$queryRaw<QuietActivityRow[]>(query);
  return {
    accounts: countQuietAccounts(
      ids,
      rows
        .map(activityFromRow)
        .filter((row): row is QuietAccountActivity => row !== null),
      now,
    ),
    complete: true,
  };
}
