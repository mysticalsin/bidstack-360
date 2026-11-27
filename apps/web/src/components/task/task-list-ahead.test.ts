import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dateChipAheadEmpty, type FollowUpTiming } from './task-list-ahead';

const IKEA: FollowUpTiming = {
  title: 'Prepare pricing annex for IKEA',
  dueDate: '2026-11-28',
  status: 'open',
};

const SIEMENS: FollowUpTiming = {
  title: 'Finalize technical volume for Siemens ERP',
  dueDate: '2026-11-30',
  status: 'in_progress',
};

const HANDOVER: FollowUpTiming = {
  title: 'Kickoff handover to delivery, Stellantis',
  dueDate: '2026-11-23',
  status: 'done',
};

describe('dateChipAheadEmpty', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 10:00 UTC keeps a date-only day three ahead on the elapsed-time clock
    // (62 hours rounds to 3) and on a calendar-day clock.
    vi.setSystemTime(new Date('2026-11-25T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the IKEA annex, three days out, when Today is empty on a fresh demo book', () => {
    const copy = dateChipAheadEmpty('today', 0, [IKEA, SIEMENS, HANDOVER]);

    expect(copy?.titleFallback).toBe('Nothing is due today');
    expect(copy?.messageFallback).toBe('Next is {{title}}, in {{count}} days.');
    expect(copy?.vars).toEqual({
      title: 'Prepare pricing annex for IKEA',
      count: 3,
      days: 3,
    });
  });

  it('counts only the open rows on an empty Overdue chip and skips the finished handover', () => {
    const copy = dateChipAheadEmpty('overdue', 0, [IKEA, SIEMENS, HANDOVER]);

    expect(copy?.titleFallback).toBe('Nothing is overdue');
    expect(copy?.messageFallback).toBe(
      '{{count}} open follow-ups in this list are still ahead. Next is {{title}}, in {{days}} days.',
    );
    expect(copy?.vars.count).toBe(2);
    expect(copy?.vars.title).toBe('Prepare pricing annex for IKEA');
    expect(copy?.vars.days).toBe(3);
  });

  it('stays quiet when a late follow-up is why Today is empty', () => {
    const late: FollowUpTiming = {
      title: 'Submit revised pricing & SoW v2',
      dueDate: '2026-05-15',
      status: 'in_progress',
    };

    expect(dateChipAheadEmpty('today', 0, [late, IKEA])).toBeNull();
  });

  it('stays quiet for All, for a chip that already lists a row, and for a finished-only book', () => {
    expect(dateChipAheadEmpty('all', 0, [IKEA])).toBeNull();
    expect(dateChipAheadEmpty('today', 1, [IKEA])).toBeNull();
    expect(dateChipAheadEmpty('overdue', 0, [HANDOVER])).toBeNull();
  });

  it('keeps the ahead sentences, and their placeholders, in every task catalog', () => {
    // A missing placeholder shows "{{title}}" to that language. Arabic has no
    // task catalog and already falls back to English.
    const keys = [
      'todayAheadTitle',
      'overdueClearTitle',
      'nextTomorrow',
      'nextDays',
      'overdueClearMany',
      'overdueClearManyTomorrow',
    ] as const;
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{[^}]+\}\}/g)].map((match) => match[0]).sort();
    const read = (locale: string) => {
      const raw = readFileSync(join(process.cwd(), 'public/locales', locale, 'crm.json'), 'utf8');
      const doc = JSON.parse(raw) as { tasks: { empty: Record<string, string> } };
      return doc.tasks.empty;
    };
    const english = read('en');
    for (const locale of ['en', 'es', 'fr', 'it', 'pt', 'zh']) {
      const block = read(locale);
      for (const key of keys) {
        expect(block[key], `${locale}.${key}`).toEqual(expect.any(String));
        expect(block[key]!.length, `${locale}.${key}`).toBeGreaterThan(0);
        expect(placeholders(block[key]!), `${locale}.${key}`).toEqual(placeholders(english[key]!));
      }
    }
  });

  it('says tomorrow when the soonest open follow-up is the next calendar day', () => {
    const tomorrow: FollowUpTiming = {
      title: 'Schedule discovery workshop with Sanofi CMIO',
      dueDate: '2026-11-26',
      status: 'open',
    };

    const copy = dateChipAheadEmpty('today', 0, [tomorrow]);

    expect(copy?.messageFallback).toBe('Next is {{title}}, tomorrow.');
    expect(copy?.vars).toMatchObject({ title: tomorrow.title, count: 1, days: 1 });
  });
});
