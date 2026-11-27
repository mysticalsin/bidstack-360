/**
 * Open follow-ups that belong on a calendar day.
 *
 * Demo seed files the pricing annex and the security questionnaire inside
 * the current week, and a finished handover on Monday of that week. Bid and
 * proposal due dates sit 30 and 45 days out, so the week lane only reads
 * those and Saturday and Sunday paint empty. A finished row is not a chip.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_STATUS = new Set(['open', 'in_progress', 'blocked']);

export interface FollowUpRow {
  id: string;
  title: string;
  status: string;
  dueDate: Date | null;
}

export interface FollowUpDeadline {
  kind: 'follow_up';
  id: string;
  name: string;
  customer: null;
  code: null;
  dueDate: string;
}

function utcDay(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

function nameOf(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : 'Follow-up';
}

/** Open follow-ups whose due day is inside [from, to). Done rows stay off. */
export function followUpsInWindow(
  rows: FollowUpRow[],
  range: { from: string; to: string },
): FollowUpDeadline[] {
  const items: FollowUpDeadline[] = [];
  for (const row of rows) {
    if (!OPEN_STATUS.has(row.status)) continue;
    if (!UUID.test(row.id)) continue;
    if (!row.dueDate) continue;
    const dueDate = utcDay(row.dueDate);
    if (!dueDate || dueDate < range.from || dueDate >= range.to) continue;
    items.push({
      kind: 'follow_up',
      id: row.id,
      name: nameOf(row.title),
      customer: null,
      code: null,
      dueDate,
    });
  }
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  return items;
}
