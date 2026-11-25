import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { openDealIsPastClose, utcDayStart } from './accounts.overdue.js';

// Demo open bids close April–September 2026. On a later afternoon those
// dates are already past, and a close dated today is not late for the rest
// of that UTC day. Strategic and Top account lists were still counting every
// open deal as current pipeline.
const NOW = new Date('2026-11-25T15:00:00.000Z');

describe('open deal past close', () => {
  it('counts a previous UTC close day and keeps today, a missing date, and a future date off the clock', () => {
    expect(utcDayStart(NOW).toISOString()).toBe('2026-11-25T00:00:00.000Z');
    expect(openDealIsPastClose(new Date('2026-07-22T00:00:00.000Z'), NOW)).toBe(true);
    expect(openDealIsPastClose(new Date('2026-11-24T00:00:00.000Z'), NOW)).toBe(true);
    expect(openDealIsPastClose(new Date('2026-11-25T00:00:00.000Z'), NOW)).toBe(false);
    expect(openDealIsPastClose(new Date('2026-12-01T00:00:00.000Z'), NOW)).toBe(false);
    expect(openDealIsPastClose(null, NOW)).toBe(false);
  });

  it('uses that UTC day on both the key-account aggregate and the auto top-account query', () => {
    const helpers = readFileSync(new URL('./accounts.helpers.ts', import.meta.url), 'utf8');
    const routes = readFileSync(new URL('./accounts.ts', import.meta.url), 'utf8');
    expect(helpers).toContain('dueDate: { lt: utcDayStart(now) }');
    expect(helpers).toContain("stage: { notIn: ['closed_won', 'closed_lost'] }");
    expect(routes).toContain("o.due_date < (timezone('UTC', now()))::date");
    expect(routes).toContain('overdueDeals');
  });
});
