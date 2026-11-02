// Next open task for the accounts in the current view.
// A task counts when task.account_id is that company, or the linked
// opportunity's company_id is that company. A customer string is not a link.
// A task with neither company id does not attach. Done tasks do not count.
// The next task is the earliest due date. A task with no due date comes after
// dated ones. The query has no page limit, so the line can say "this view".
import { Prisma, type PrismaClient } from '@bidstack/db';

import { countryVariantsForScope, type AccessScope } from '../../lib/access-scope.js';
import { opportunityVisibilitySql } from './dashboard.queries.js';
import { isCompanyUuid } from './dashboard.utils.js';

export interface NextOpenTaskCandidate {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  accountId: string | null;
  opportunityCompanyId: string | null;
  /** Ignored. A customer name must not decide the company. */
  customer?: string | null;
}

export interface NextOpenTask {
  id: string;
  title: string;
  dueDate: string | null;
  companyId: string;
}

export interface NextOpenTaskRead {
  task: NextOpenTask | null;
  /** True when every open task for these companies was considered, not one page. */
  complete: boolean;
}

interface NextOpenTaskRow {
  id: unknown;
  title: unknown;
  status: unknown;
  dueDate: unknown;
  accountId: unknown;
  opportunityCompanyId: unknown;
}

const UNDATED = '9999-99-99';

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

/** Calendar day. A timestamp keeps its date prefix. Anything else is undated. */
function dueDateKey(value: string | null | undefined): string | null {
  if (value == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? null;
}

function dueFromDb(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') return dueDateKey(value);
  return null;
}

/**
 * Company this task belongs to inside the view.
 * accountId wins when it is one of the companies. Otherwise the deal's company.
 * A customer name is not read.
 */
function attachedCompanyId(
  task: NextOpenTaskCandidate,
  allowed: ReadonlySet<string>,
): string | null {
  const account = companyUuid(task.accountId);
  if (account && allowed.has(account)) return account;
  const deal = companyUuid(task.opportunityCompanyId);
  if (deal && allowed.has(deal)) return deal;
  return null;
}

/**
 * Earliest open task for these companies.
 * Done tasks drop out. A missing due date sorts after every dated task.
 */
export function pickNextOpenTask(
  companyIds: readonly string[],
  tasks: readonly NextOpenTaskCandidate[],
): NextOpenTask | null {
  const allowed = new Set(
    uniqueAccountIds(companyIds)
      .map((id) => companyUuid(id))
      .filter((id): id is string => id !== null),
  );
  const open: NextOpenTask[] = [];
  for (const task of tasks) {
    if (task.status.trim().toLowerCase() === 'done') continue;
    const companyId = attachedCompanyId(task, allowed);
    if (!companyId) continue;
    const title = task.title.trim();
    const id = task.id.trim();
    if (!title || !id) continue;
    open.push({
      id,
      title,
      dueDate: dueDateKey(task.dueDate),
      companyId,
    });
  }
  open.sort((a, b) => {
    const aDue = a.dueDate ?? UNDATED;
    const bDue = b.dueDate ?? UNDATED;
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return open[0] ?? null;
}

function uuidList(uuids: readonly string[]): Prisma.Sql {
  return Prisma.join(uuids.map((id) => Prisma.sql`${id}::uuid`));
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

/**
 * Every not-done task that attaches by company id.
 * Opportunity-linked tasks use the open book's country / territory / owner rule.
 * Account-only tasks use that same rule on the company, not a wider read.
 * No LIMIT: a page of recent tasks would hide an earlier due date.
 */
export function nextOpenTaskQuery(
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
  return Prisma.sql`
    SELECT
      task.id::text AS "id",
      task.title AS "title",
      task.status::text AS "status",
      task.due_date AS "dueDate",
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
      AND task.status::text <> 'done'
      AND (
        (
          o.id IS NULL
          AND task.account_id IN (${uuidList(uuids)})
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
  `;
}

function taskFromRow(row: NextOpenTaskRow): NextOpenTaskCandidate | null {
  const id = textOrNull(row.id);
  const title = textOrNull(row.title);
  const status = textOrNull(row.status);
  if (!id || title == null || !status) return null;
  return {
    id,
    title,
    status,
    dueDate: dueFromDb(row.dueDate),
    accountId: textOrNull(row.accountId),
    opportunityCompanyId: textOrNull(row.opportunityCompanyId),
  };
}

export async function fetchNextOpenTask(
  db: Pick<PrismaClient, '$queryRaw'>,
  orgId: string,
  companyIds: readonly string[],
  scope: AccessScope,
): Promise<NextOpenTaskRead> {
  const ids = uniqueAccountIds(companyIds);
  const query = nextOpenTaskQuery(orgId, ids, scope);
  if (!query) return { task: null, complete: true };
  const rows = await db.$queryRaw<NextOpenTaskRow[]>(query);
  return {
    task: pickNextOpenTask(
      ids,
      rows.map(taskFromRow).filter((row): row is NextOpenTaskCandidate => row !== null),
    ),
    complete: true,
  };
}
