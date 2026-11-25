export interface RecentFollowUp {
  status: string;
}

/**
 * Recent keeps the loaded order, then moves a finished follow-up behind
 * the rows that are still open. The demo route lists the Stellantis
 * handover first because its due day is earlier. That row is already
 * done, so it must not lead the default list.
 * A blocked row stays with the open rows. Relative order inside each
 * group stays as loaded. This is not a due-day sort.
 */
export function orderRecentFollowUps<T extends RecentFollowUp>(rows: readonly T[]): T[] {
  const open: T[] = [];
  const finished: T[] = [];
  for (const row of rows) {
    if (row.status === 'done') finished.push(row);
    else open.push(row);
  }
  return open.concat(finished);
}
