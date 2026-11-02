import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { OPEN_OPPORTUNITY_SQL } from '../crm/dashboard.queries.js';
import {
  fetchOpenPipelineBook,
  microsFromDbText,
  openPipelineBookQuery,
  openPipelineTileFromSums,
  percentChangeFromMicros,
  sparklineFromMicros,
} from './open-pipeline-book.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const CHILD = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-01T00:00:00.000Z');

describe('open pipeline book SQL', () => {
  it('sums the full open book as integer micros text and does not take 500', () => {
    // WHY: the cockpit tile summed opportunity.findMany({ take: 500 }). A 501st
    // open deal never reached the key number. The total has to be a Postgres
    // SUM of the same account scope, returned as digit text.
    const page = Array.from({ length: 500 }, () => 1n).reduce((sum, value) => sum + value, 0n);
    const tail = 8598204328457184962n;
    expect(page + tail).not.toBe(page);

    const query = openPipelineBookQuery(ORG, [COMPANY, CHILD], NOW);
    const text = query.text;
    expect(text).toContain(OPEN_OPPORTUNITY_SQL.trim());
    expect(text.match(/SUM\(GREATEST\(o\.value_micros, 0\)\)/g)).toHaveLength(6);
    expect(text.match(/::text/g)?.length).toBeGreaterThanOrEqual(6);
    expect(text).toContain('o.org_id =');
    expect(text).toContain('o.deleted_at IS NULL');
    expect(text).toContain('o.company_id IN');
    expect(text).toContain('ps.deleted_at IS NULL');
    expect(text).toContain('(ps.is_won OR ps.is_lost)');
    expect(text).not.toContain('is_won AND NOT ps.is_lost');
    expect(text).not.toContain('owner_id');
    expect(text).not.toMatch(/\bLIMIT\b/i);
    expect(text).not.toMatch(/take:\s*500/);
    expect(query.values).not.toContain(500);
    expect(query.values).not.toContain(500n);

    const strings = query.values.filter((value): value is string => typeof value === 'string');
    expect(strings).toEqual([ORG, COMPANY, CHILD]);
  });

  it('loadKeyNumbers does not total a 500-row opportunity page', () => {
    const src = readFileSync(new URL('./load.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export async function loadKeyNumbers');
    const end = src.indexOf('return { companyId, items, computedAt: now.toISOString() };', start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(body).not.toMatch(/take:\s*500/);
    expect(body).not.toContain('opportunity.findMany');
    expect(body).not.toContain('sumOpenPipelineMicros');
    expect(body).toContain('fetchOpenPipelineBook(prisma, orgId, ids, now)');
  });
});

describe('open pipeline tile from integer micros', () => {
  it('keeps a one-decimal percent when Number(micros) is not a finite ratio', () => {
    // WHY: the percent beside the key number used Number(now) and Number(ago).
    // Past the float range those are Infinity, and the ratio is NaN, while the
    // printed total is still the exact digit string.
    const previous = 10n ** 400n;
    const current = previous + previous / 10n;
    expect(Number(current)).toBe(Infinity);
    expect(Number.isNaN((Number(current) - Number(previous)) / Math.abs(Number(previous)))).toBe(true);

    const tile = openPipelineTileFromSums({
      openMicros: current.toString(),
      openCount: 2,
      historyMicros: ['0', '0', previous.toString(), previous.toString(), previous.toString()],
    });
    expect(tile.valueMicros).toBe(current.toString());
    expect(tile.delta).toBe(10);
    expect(Number.isFinite(tile.value)).toBe(true);
    expect(tile.series.every((point) => Number.isSafeInteger(point))).toBe(true);
    expect(percentChangeFromMicros(current, previous)).toBe(10);
  });

  it('keeps two sparkline points apart when Number collapses the micros', () => {
    // WHY: Number(deal) and Number(deal + 2n) are the same integer, so a
    // sparkline of those amounts drew a flat line for a book that grew.
    const low = 8598204328457184962n;
    const high = low + 2n;
    expect(Number(low)).toBe(Number(high));
    expect(sparklineFromMicros([100n, 250n, 180n])).toEqual([100, 250, 180]);
    expect(sparklineFromMicros([low, high])).toEqual([0, 2]);
    const wide = sparklineFromMicros([0n, 10n ** 40n]);
    expect(wide[1]).toBeGreaterThan(wide[0]!);
    expect(wide.every((point) => Number.isSafeInteger(point))).toBe(true);
  });

  it('rounds the percent the same way on amounts that still fit a number', () => {
    expect(percentChangeFromMicros(110n, 100n)).toBe(10);
    expect(percentChangeFromMicros(100n, 110n)).toBe(-9.1);
    expect(percentChangeFromMicros(2001n, 2000n)).toBe(0.1);
    expect(percentChangeFromMicros(1999n, 2000n)).toBe(0);
    expect(percentChangeFromMicros(5n, 0n)).toBeNull();
  });

  it('refuses a micros value that has already been rounded', () => {
    expect(microsFromDbText('8598204328457184962')).toBe(8598204328457184962n);
    expect(() => microsFromDbText(Number(8598204328457184962n))).toThrow(/integer micros/);
    expect(() => microsFromDbText('12.5')).toThrow(/integer micros/);
  });

  it('returns the query text for the book, including the deal past a 500-row page', async () => {
    const tail = 8598204328457184962n;
    const full = 500n + tail;
    const queryRaw = vi.fn(async (query: { text: string; values: unknown[] }) => {
      expect(query.text).not.toMatch(/\bLIMIT\b/i);
      expect(query.values).not.toContain(500);
      return [
        {
          openMicros: full.toString(),
          openCount: 501,
          d150: '0',
          d120: '0',
          d90: (full / 2n).toString(),
          d60: full.toString(),
          d30: full.toString(),
        },
      ];
    });
    const tile = await fetchOpenPipelineBook({ $queryRaw: queryRaw }, ORG, [COMPANY], NOW);
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(tile.valueMicros).toBe(full.toString());
    expect(tile.valueMicros).not.toBe('500');
    expect(tile.openCount).toBe(501);
    expect(tile.delta).toBe(100);
    expect(tile.delta).toBe(percentChangeFromMicros(full, full / 2n));
  });
});
