import { describe, expect, it } from 'vitest';

import { extractMsaFields } from './extract-fields.js';

/**
 * A rate line that already names a currency must keep that currency.
 * The review prints "unspecified" only when the line named none.
 * Inventing EUR would repeat the liability-cap default this row does not own.
 */
describe('extract rate-card currency', () => {
  it('keeps the currency a rate line already states and does not invent one', () => {
    const fields = extractMsaFields(
      [
        'Senior Consultant: 850 EUR per day',
        'Principal Consultant: £1,100 per day',
        'Analyst: $400 per hour',
        'Researcher: 700 usd per day',
        'Associate: 900 per day',
      ].join('\n'),
    );
    const lines = fields.rateCard.value as Array<{
      role: string;
      rateMicros: number;
      unit: string;
      currency: string | null;
    }>;

    expect(lines.map((line) => [line.role, line.rateMicros, line.unit, line.currency])).toEqual([
      ['Senior Consultant', 850_000_000, 'day', 'EUR'],
      ['Principal Consultant', 1_100_000_000, 'day', 'GBP'],
      ['Analyst', 400_000_000, 'hour', 'USD'],
      ['Researcher', 700_000_000, 'day', 'USD'],
      ['Associate', 900_000_000, 'day', null],
    ]);
  });
});
