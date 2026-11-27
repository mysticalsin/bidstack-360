import { Prisma } from '@bidstack/db';
import { FIXTURE_TASK_DUE_DATES, fixtureTaskShiftDays } from '@bidstack/shared';

/**
 * Due date a task summary should read.
 * Real mode, and a demo whose seeded dates are still ahead, keep `due_date`.
 * Demo slides only an open fixture row that still holds its seeded date.
 */
export function projectedTaskDueSql(now: Date, mode: string | undefined): Prisma.Sql {
  const shift = mode === 'demo' ? fixtureTaskShiftDays(now) : 0;
  if (shift === 0) return Prisma.sql`due_date`;
  const branches = Object.entries(FIXTURE_TASK_DUE_DATES).map(
    ([id, date]) =>
      Prisma.sql`WHEN id = ${id}::uuid AND due_date = ${date}::date AND status <> 'done' THEN (due_date + ${shift})::date`,
  );
  return Prisma.sql`(CASE ${Prisma.join(branches, ' ')} ELSE due_date END)`;
}
