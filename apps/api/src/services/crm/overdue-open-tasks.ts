// How many accounts in the current view already have an overdue open task.
// The company set is the next-open-task query: country, territory, and owner.
// A task counts when task.account_id is that company UUID, or the linked
// opportunity's company_id is that company UUID. A customer string is not a
// link. A task with neither company id does not attach. Done tasks do not
// count. Overdue means the due date's UTC calendar day is before today's UTC
// calendar day. A task with no due date is not overdue. A task due today is
// not overdue. The number is accounts, not tasks. No page limit.
import type { Prisma, PrismaClient } from '@bidstack/db';

import type { AccessScope } from '../../lib/access-scope.js';
import { isCompanyUuid } from './dashboard.utils.js';
import { nextOpenTaskQuery } from './next-open-task.js';

export interface OverdueOpenTaskCandidate {
  status: string;
  dueDate: string | null;
  accountId: string | null;
  opportunityCompanyId: string | null;
  /** Ignored. A customer name must not decide the company. */
  customer?: string | null;
}

export interface OverdueOpenTaskAccounts {
  /** Accounts in the set with at least one overdue open task. */
  accounts: number;
  /** True when every open task for these companies was considered, not one page. */
  complete: boolean;
}

interface OverdueTaskRow {
  status: unknown;
  dueDate: unknown;
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

/**
 * UTC calendar day (YYYY-MM-DD).
 * A date-only value keeps that day. A timestamp uses its UTC day.
 */
export function utcCalendarDay(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Company this task belongs to inside the view.
 * accountId wins when it is one of the companies. Otherwise the deal's company.
 * A customer name is not read.
 */
function attachedCompanyId(
  task: OverdueOpenTaskCandidate,
  allowed: ReadonlySet<string>,
): string | null {
  const account = companyUuid(task.accountId);
  if (account && allowed.has(account)) return account;
  const deal = companyUuid(task.opportunityCompanyId);
  if (deal && allowed.has(deal)) return deal;
  return null;
}

/**
 * Accounts in the set with at least one open task whose due day is before
 * today's UTC day. Done, undated, and due-today tasks add nothing.
 */
export function countAccountsWithOverdueOpenTask(
  companyIds: readonly string[],
  tasks: readonly OverdueOpenTaskCandidate[],
  now: Date,
): number {
  const today = utcCalendarDay(now.toISOString());
  if (!today) return 0;
  const allowed = new Set(
    uniqueAccountIds(companyIds)
      .map((id) => companyUuid(id))
      .filter((id): id is string => id !== null),
  );
  const overdue = new Set<string>();
  for (const task of tasks) {
    if (task.status.trim().toLowerCase() === 'done') continue;
    const companyId = attachedCompanyId(task, allowed);
    if (!companyId) continue;
    const due = utcCalendarDay(task.dueDate);
    if (!due || due >= today) continue;
    overdue.add(companyId);
  }
  return overdue.size;
}

/** Same company ids and the same country / territory / owner rule as the next open task. */
export function overdueOpenTaskQuery(
  orgId: string,
  companyIds: readonly string[],
  scope: AccessScope,
): Prisma.Sql | null {
  return nextOpenTaskQuery(orgId, companyIds, scope);
}

function dueFromDb(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') return value;
  return null;
}

function taskFromRow(row: OverdueTaskRow): OverdueOpenTaskCandidate | null {
  const status = textOrNull(row.status);
  if (!status) return null;
  return {
    status,
    dueDate: dueFromDb(row.dueDate),
    accountId: textOrNull(row.accountId),
    opportunityCompanyId: textOrNull(row.opportunityCompanyId),
  };
}

export async function fetchOverdueOpenTaskAccounts(
  db: Pick<PrismaClient, '$queryRaw'>,
  orgId: string,
  companyIds: readonly string[],
  scope: AccessScope,
  now: Date = new Date(),
): Promise<OverdueOpenTaskAccounts> {
  const ids = uniqueAccountIds(companyIds);
  const query = overdueOpenTaskQuery(orgId, ids, scope);
  if (!query) return { accounts: 0, complete: true };
  const rows = await db.$queryRaw<OverdueTaskRow[]>(query);
  return {
    accounts: countAccountsWithOverdueOpenTask(
      ids,
      rows.map(taskFromRow).filter((row): row is OverdueOpenTaskCandidate => row !== null),
      now,
    ),
    complete: true,
  };
}
