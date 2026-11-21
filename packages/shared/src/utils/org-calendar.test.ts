import { describe, expect, it } from 'vitest';

import {
  civilDay,
  civilDayAsUtcDate,
  dateOnlyRange,
  isBeforeCivilDay,
  quarterBounds,
  resolveTimeZone,
} from './org-calendar.js';

const SAO_PAULO = 'America/Sao_Paulo';

describe('org calendar quarters', () => {
  it('keeps the last hours of 31 Dec in São Paulo inside 2025-Q4', () => {
    // 2026-01-01 02:00 UTC is 2025-12-31 23:00 in America/Sao_Paulo (UTC−3, no DST).
    const bounds = quarterBounds(new Date('2026-01-01T02:00:00.000Z'), SAO_PAULO);
    expect(bounds.key).toBe('2025-Q4');
    expect(bounds.start.toISOString()).toBe('2025-10-01T03:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-01-01T03:00:00.000Z');
  });

  it('starts 2026-Q1 at São Paulo midnight, not UTC midnight', () => {
    const bounds = quarterBounds(new Date('2026-01-01T03:00:00.000Z'), SAO_PAULO);
    expect(bounds.key).toBe('2026-Q1');
    expect(bounds.start.toISOString()).toBe('2026-01-01T03:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-04-01T03:00:00.000Z');
  });

  it('keeps 1 Apr 02:30 UTC in Q1 because São Paulo is still 31 Mar', () => {
    const bounds = quarterBounds(new Date('2026-04-01T02:30:00.000Z'), SAO_PAULO);
    expect(bounds.key).toBe('2026-Q1');
    expect(bounds.end.toISOString()).toBe('2026-04-01T03:00:00.000Z');
  });

  it('includes the whole local 31 Dec and stops at the next local midnight', () => {
    const range = dateOnlyRange('2025-12-31', '2025-12-31', SAO_PAULO);
    const inside = new Date('2026-01-01T02:30:00.000Z');
    const nextDay = new Date('2026-01-01T03:00:00.000Z');
    const previousEvening = new Date('2025-12-31T02:59:00.000Z');
    expect(range.gte && inside >= range.gte && range.lt && inside < range.lt).toBe(true);
    expect(range.lt && nextDay < range.lt).toBe(false);
    expect(range.gte && previousEvening >= range.gte).toBe(false);
  });

  it('keeps 22:00 in São Paulo on that civil day, which is 01:00 UTC the next day', () => {
    // 2026-11-21 01:00 UTC is 2026-11-20 22:00 in America/Sao_Paulo (UTC−3).
    const evening = new Date('2026-11-21T01:00:00.000Z');
    expect(civilDay(evening, SAO_PAULO)).toBe('2026-11-20');
    expect(isBeforeCivilDay('2026-11-20', evening, SAO_PAULO)).toBe(false);
    expect(isBeforeCivilDay('2026-11-19', evening, SAO_PAULO)).toBe(true);
    expect(isBeforeCivilDay(null, evening, SAO_PAULO)).toBe(false);
    expect(civilDayAsUtcDate(evening, SAO_PAULO).toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });

  it('falls back when the stored zone is missing or not a real IANA name', () => {
    expect(resolveTimeZone(null)).toBe('America/Toronto');
    expect(resolveTimeZone('Mars/Olympus')).toBe('America/Toronto');
    expect(resolveTimeZone('  America/Sao_Paulo  ')).toBe(SAO_PAULO);
  });

  it('places every hour of a year inside exactly one quarter that meets the next', () => {
    const origin = Date.parse('2025-06-01T00:00:00.000Z');
    for (let hour = 0; hour < 24 * 400; hour += 1) {
      const instant = new Date(origin + hour * 3_600_000);
      const bounds = quarterBounds(instant, SAO_PAULO);
      expect(instant.getTime()).toBeGreaterThanOrEqual(bounds.start.getTime());
      expect(instant.getTime()).toBeLessThan(bounds.end.getTime());
      const following = quarterBounds(bounds.end, SAO_PAULO);
      expect(following.start.getTime()).toBe(bounds.end.getTime());
      expect(following.key).not.toBe(bounds.key);
    }
  });
});
