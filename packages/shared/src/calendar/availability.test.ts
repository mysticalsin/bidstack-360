/**
 * Tests for computeSlots availability engine.
 *
 * WHY each test exists:
 *   - basic: verifies slots fill the expected window
 *   - buffer: confirms existing events + buffers block correctly
 *   - allDay: all-day events block the whole day
 *   - minNotice: slots sooner than minNoticeHours are excluded
 *   - noRules: returns empty when no rules configured
 *   - emptyRange: returns empty when rangeStart > rangeEnd
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { computeSlots, type AvailabilityRule, type BlockingEvent } from './availability.js';

// Fixed "now" for deterministic notice tests: 2024-01-15 10:00 UTC
const FIXED_NOW = new Date('2024-01-15T10:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('computeSlots', () => {
  it('returns empty array when no rules provided', () => {
    const result = computeSlots({
      rules: [],
      existingEvents: [],
      rangeStart: new Date('2024-01-15T00:00:00Z'),
      rangeEnd: new Date('2024-01-15T23:59:59Z'),
      durationMinutes: 30,
    });
    expect(result).toEqual([]);
  });

  it('returns empty array when rangeStart is after rangeEnd', () => {
    const rules: AvailabilityRule[] = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
    ];
    const result = computeSlots({
      rules,
      existingEvents: [],
      rangeStart: new Date('2024-01-20T00:00:00Z'),
      rangeEnd: new Date('2024-01-15T00:00:00Z'),
      durationMinutes: 30,
    });
    expect(result).toEqual([]);
  });

  it('generates correct slots for a Monday 09:00–11:00 window', () => {
    // 2024-01-15 is a Monday UTC
    const rules: AvailabilityRule[] = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '11:00' },
    ];
    const result = computeSlots({
      rules,
      existingEvents: [],
      rangeStart: new Date('2024-01-15T00:00:00Z'),
      rangeEnd: new Date('2024-01-15T23:59:59Z'),
      durationMinutes: 30,
      minNoticeHours: 0,
    });
    // Expect 4 slots: 09:00, 09:30, 10:00, 10:30
    expect(result).toHaveLength(4);
    expect(result[0]).toBe('2024-01-15T09:00:00.000Z');
    expect(result[3]).toBe('2024-01-15T10:30:00.000Z');
  });

  it('excludes slots blocked by existing events', () => {
    const rules: AvailabilityRule[] = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '11:00' },
    ];
    const existingEvents: BlockingEvent[] = [
      {
        startAt: new Date('2024-01-15T09:30:00Z'),
        endAt: new Date('2024-01-15T10:00:00Z'),
        isAllDay: false,
      },
    ];
    const result = computeSlots({
      rules,
      existingEvents,
      rangeStart: new Date('2024-01-15T00:00:00Z'),
      rangeEnd: new Date('2024-01-15T23:59:59Z'),
      durationMinutes: 30,
      minNoticeHours: 0,
    });
    // 09:00 is free, 09:30 is blocked, 10:00 is free, 10:30 is free
    expect(result).toHaveLength(3);
    expect(result).not.toContain('2024-01-15T09:30:00.000Z');
    expect(result).toContain('2024-01-15T09:00:00.000Z');
    expect(result).toContain('2024-01-15T10:00:00.000Z');
  });

  it('respects buffer before and after blocked events', () => {
    const rules: AvailabilityRule[] = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
    ];
    // Event at 10:00–10:30 with 30 min buffer before and after
    const existingEvents: BlockingEvent[] = [
      {
        startAt: new Date('2024-01-15T10:00:00Z'),
        endAt: new Date('2024-01-15T10:30:00Z'),
        isAllDay: false,
      },
    ];
    const result = computeSlots({
      rules,
      existingEvents,
      rangeStart: new Date('2024-01-15T00:00:00Z'),
      rangeEnd: new Date('2024-01-15T23:59:59Z'),
      durationMinutes: 30,
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      minNoticeHours: 0,
    });
    // Buffer expands event block to 09:30–11:00
    // Available: 09:00 (but 09:30 starts during buffer → blocked)
    // 11:00 and 11:30 should be free
    expect(result).toContain('2024-01-15T09:00:00.000Z');
    expect(result).not.toContain('2024-01-15T09:30:00.000Z');
    expect(result).not.toContain('2024-01-15T10:00:00.000Z');
    expect(result).toContain('2024-01-15T11:00:00.000Z');
    expect(result).toContain('2024-01-15T11:30:00.000Z');
  });

  it('blocks the entire day for an all-day event', () => {
    const rules: AvailabilityRule[] = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
    ];
    const existingEvents: BlockingEvent[] = [
      {
        startAt: new Date('2024-01-15T00:00:00Z'),
        endAt: new Date('2024-01-15T23:59:59Z'),
        isAllDay: true,
      },
    ];
    const result = computeSlots({
      rules,
      existingEvents,
      rangeStart: new Date('2024-01-15T00:00:00Z'),
      rangeEnd: new Date('2024-01-15T23:59:59Z'),
      durationMinutes: 30,
      minNoticeHours: 0,
    });
    expect(result).toHaveLength(0);
  });

  it('excludes slots within minNoticeHours from now', () => {
    // Now = 10:00 UTC. minNoticeHours = 2 → slots before 12:00 are excluded
    const rules: AvailabilityRule[] = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '14:00' },
    ];
    const result = computeSlots({
      rules,
      existingEvents: [],
      rangeStart: new Date('2024-01-15T00:00:00Z'),
      rangeEnd: new Date('2024-01-15T23:59:59Z'),
      durationMinutes: 30,
      minNoticeHours: 2,
    });
    // Slots at 09:00, 09:30, 10:00, 10:30, 11:00, 11:30 are within 2h of 10:00
    // Only 12:00, 12:30, 13:00, 13:30 survive
    expect(result.length).toBeGreaterThan(0);
    for (const slot of result) {
      const slotTime = new Date(slot);
      expect(slotTime.getTime() - FIXED_NOW.getTime()).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    }
  });

  it('generates slots across multiple days', () => {
    const rules: AvailabilityRule[] = [
      { dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }, // Monday
      { dayOfWeek: 2, startTime: '14:00', endTime: '15:00' }, // Tuesday
    ];
    const result = computeSlots({
      rules,
      existingEvents: [],
      // 2024-01-15 Mon, 2024-01-16 Tue
      rangeStart: new Date('2024-01-15T00:00:00Z'),
      rangeEnd: new Date('2024-01-16T23:59:59Z'),
      durationMinutes: 30,
      minNoticeHours: 0,
    });
    // Mon: 10:00, 10:30 = 2 slots; Tue: 14:00, 14:30 = 2 slots
    expect(result).toHaveLength(4);
    expect(result.some((s) => s.startsWith('2024-01-15'))).toBe(true);
    expect(result.some((s) => s.startsWith('2024-01-16'))).toBe(true);
  });

  it('returns empty when no rules match days in range', () => {
    // Range is only a Sunday (2024-01-14) but rules only cover Monday
    const rules: AvailabilityRule[] = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
    ];
    const result = computeSlots({
      rules,
      existingEvents: [],
      rangeStart: new Date('2024-01-14T00:00:00Z'),
      rangeEnd: new Date('2024-01-14T23:59:59Z'),
      durationMinutes: 30,
      minNoticeHours: 0,
    });
    expect(result).toHaveLength(0);
  });
});
