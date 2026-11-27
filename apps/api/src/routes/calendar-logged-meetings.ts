/**
 * Logged meetings that belong on the calendar.
 *
 * Demo seed writes workshops as activities (occurredAt on a UTC day), not as
 * calendar rows. The week view only reads calendar rows, so the day of
 * "Landing zone scoping workshop" paints empty. These rows fill that day.
 * They are not all-day bars and they are not a Google or Microsoft event.
 */
export const LOGGED_MEETING_PROVIDER = 'logged_meeting';

const HOUR_MS = 60 * 60 * 1000;
const DEDUPE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LoggedMeetingRow {
  id: string;
  type: string;
  subject: string | null;
  occurredAt: Date;
  startTime: Date | null;
  endTime: Date | null;
  entityType: string;
  entityId: string;
  createdAt: Date;
}

export interface CalendarEventStamp {
  subject: string;
  startAt: Date;
}

export interface LoggedMeetingEvent {
  id: string;
  subject: string;
  startAt: string;
  endAt: string;
  location: null;
  isAllDay: false;
  syncState: 'SYNCED';
  provider: typeof LOGGED_MEETING_PROVIDER;
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  localOnly: true;
  createdAt: string;
}

function uuidOrNull(value: string): string | null {
  return UUID.test(value) ? value : null;
}

function subjectOf(raw: string | null): string {
  const trimmed = raw?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : 'Meeting';
}

function span(row: LoggedMeetingRow): { start: Date; end: Date } | null {
  const start = row.startTime ?? row.occurredAt;
  if (Number.isNaN(start.getTime())) return null;
  const end = row.endTime && row.endTime.getTime() > start.getTime() ? row.endTime : new Date(start.getTime() + HOUR_MS);
  if (Number.isNaN(end.getTime())) return null;
  return { start, end };
}

function overlaps(start: Date, end: Date, from: Date, to: Date): boolean {
  return start.getTime() < to.getTime() && end.getTime() > from.getTime();
}

function alreadyOnCalendar(subject: string, start: Date, calendarEvents: CalendarEventStamp[]): boolean {
  const key = subject.toLowerCase();
  return calendarEvents.some(
    (event) =>
      event.subject.trim().toLowerCase() === key &&
      Math.abs(event.startAt.getTime() - start.getTime()) <= DEDUPE_MS,
  );
}

/** Meetings whose interval overlaps [from, to), minus copies already stored as calendar events. */
export function loggedMeetingsInRange(
  rows: LoggedMeetingRow[],
  range: { from: Date; to: Date },
  calendarEvents: CalendarEventStamp[],
): LoggedMeetingEvent[] {
  const events: LoggedMeetingEvent[] = [];
  for (const row of rows) {
    if (row.type !== 'meeting') continue;
    if (!UUID.test(row.id)) continue;
    const times = span(row);
    if (!times || !overlaps(times.start, times.end, range.from, range.to)) continue;
    const subject = subjectOf(row.subject);
    if (alreadyOnCalendar(subject, times.start, calendarEvents)) continue;
    const entityId = uuidOrNull(row.entityId);
    events.push({
      id: row.id,
      subject,
      startAt: times.start.toISOString(),
      endAt: times.end.toISOString(),
      location: null,
      isAllDay: false,
      syncState: 'SYNCED',
      provider: LOGGED_MEETING_PROVIDER,
      contactId: row.entityType === 'contact' ? entityId : null,
      companyId: row.entityType === 'company' ? entityId : null,
      opportunityId: row.entityType === 'opportunity' ? entityId : null,
      localOnly: true,
      createdAt: row.createdAt.toISOString(),
    });
  }
  events.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.subject.localeCompare(b.subject));
  return events;
}
