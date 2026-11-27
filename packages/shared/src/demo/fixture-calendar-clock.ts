/**
 * Synthetic calendar meetings and the absolute instants the fixture seed writes.
 * A restored snapshot keeps these times, so the current week and the 14-day
 * agenda are empty until the demo clock slides them.
 */
export const FIXTURE_CALENDAR_EVENTS: readonly FixtureCalendarEvent[] = [
  {
    clientRequestId: 'fixture:cal:architecture',
    subject: 'Architecture review',
    location: 'Video',
    startAt: '2026-05-11T13:00:00.000Z',
    endAt: '2026-05-11T14:00:00.000Z',
  },
  {
    clientRequestId: 'fixture:cal:workshop',
    subject: 'Landing zone workshop',
    location: 'Video',
    startAt: '2026-05-12T18:00:00.000Z',
    endAt: '2026-05-12T19:30:00.000Z',
  },
  {
    clientRequestId: 'fixture:cal:steering',
    subject: 'Steering',
    location: 'Video',
    startAt: '2026-05-13T15:00:00.000Z',
    endAt: '2026-05-13T16:00:00.000Z',
  },
  {
    clientRequestId: 'fixture:cal:identity',
    subject: 'Identity scope',
    location: 'Video',
    startAt: '2026-05-14T20:00:00.000Z',
    endAt: '2026-05-14T20:30:00.000Z',
  },
  {
    clientRequestId: 'fixture:cal:debrief',
    subject: 'Plant IT debrief',
    location: 'Video',
    startAt: '2026-05-15T14:30:00.000Z',
    endAt: '2026-05-15T15:30:00.000Z',
  },
];

export interface FixtureCalendarEvent {
  clientRequestId: string;
  subject: string;
  location: string;
  startAt: string;
  endAt: string;
}

export interface FixtureCalendarRow {
  id: string;
  clientRequestId: string | null;
  startAt: Date;
  endAt: Date;
}

const SEEDED = new Map(FIXTURE_CALENDAR_EVENTS.map((event) => [event.clientRequestId, event]));
const EARLIEST = FIXTURE_CALENDAR_EVENTS[0]!;

function utcMidnight(value: Date): number | null {
  if (!Number.isFinite(value.getTime())) return null;
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** Exact `demo`, or unset. `real` and every other spelling stay off. */
export function fixtureCalendarMode(value: string | undefined): 'demo' | 'off' {
  if (value == null || value === 'demo') return 'demo';
  return 'off';
}

/**
 * Milliseconds to add so the earliest seeded meeting lands on today's UTC date,
 * at the same UTC time of day. Zero while that date is still today or later.
 */
export function fixtureCalendarShiftMs(now: Date): number {
  const earliest = utcMidnight(new Date(EARLIEST.startAt));
  const today = utcMidnight(now);
  if (earliest == null || today == null || earliest >= today) return 0;
  return today - earliest;
}

function sameInstant(value: Date, iso: string): boolean {
  const ms = value.getTime();
  return Number.isFinite(ms) && ms === Date.parse(iso);
}

/**
 * In demo, slide a fixture meeting that still holds its seeded start and end.
 * The gap to the other meetings stays. Anything else is the same row.
 * The input dates are not changed.
 */
export function projectFixtureCalendarRow<T extends FixtureCalendarRow>(
  row: T,
  now: Date,
  mode: string | undefined,
): T {
  if (mode !== 'demo' || !row.clientRequestId) return row;
  const seeded = SEEDED.get(row.clientRequestId);
  if (!seeded) return row;
  if (!sameInstant(row.startAt, seeded.startAt) || !sameInstant(row.endAt, seeded.endAt)) return row;
  const shift = fixtureCalendarShiftMs(now);
  if (shift === 0) return row;
  return {
    ...row,
    startAt: new Date(row.startAt.getTime() + shift),
    endAt: new Date(row.endAt.getTime() + shift),
  };
}

function overlaps(row: FixtureCalendarRow, from: Date | undefined, to: Date | undefined): boolean {
  if (to && !(row.startAt.getTime() < to.getTime())) return false;
  if (from && !(row.endAt.getTime() > from.getTime())) return false;
  return true;
}

/**
 * Project fixture rows, then keep the ones that overlap the requested window.
 * The window is applied to the projected times. Real mode leaves stored times.
 */
export function calendarRowsForWindow<T extends FixtureCalendarRow>(
  rows: readonly T[],
  window: { from?: Date; to?: Date },
  now: Date,
  mode: string | undefined,
): T[] {
  return rows
    .map((row) => projectFixtureCalendarRow(row, now, mode))
    .filter((row) => overlaps(row, window.from, window.to))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id));
}
