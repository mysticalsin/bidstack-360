import { Prisma } from '@bidstack/db';
import { FIXTURE_OPEN_DUE_DATES, fixtureOpenShiftDays } from '@bidstack/shared';

/**
 * Due date a forecast or workload aggregate should read.
 * Real mode, and a demo whose seeded dates are still ahead, keep `o.due_date`.
 * Demo slides only an open fixture row that still holds its seeded date.
 */
export function projectedOpportunityDueSql(now: Date, mode: string | undefined): Prisma.Sql {
  const shift = mode === 'demo' ? fixtureOpenShiftDays(now) : 0;
  if (shift === 0) return Prisma.sql`o.due_date`;
  const branches = Object.entries(FIXTURE_OPEN_DUE_DATES).map(
    ([code, date]) =>
      Prisma.sql`WHEN o.code = ${code} AND o.due_date = ${date}::date AND o.stage::text NOT IN ('closed_won', 'closed_lost') THEN (o.due_date + ${shift})::date`,
  );
  return Prisma.sql`(CASE ${Prisma.join(branches, ' ')} ELSE o.due_date END)`;
}
