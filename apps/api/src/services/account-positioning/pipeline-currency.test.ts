import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('open pipeline currency', () => {
  it('does not invent EUR for a sum of Opportunity.valueMicros', () => {
    // Opportunity has valueMicros and no currency column. Stamping EUR here
    // would convert an unrecorded amount. Revenue rows that carry a real
    // currency code are a different line and may keep it.
    const src = readFileSync(new URL('./load.ts', import.meta.url), 'utf8');
    const pipeline = src.split('\n').find((line) => line.includes("id: 'pipeline'"));
    expect(pipeline).toBeTruthy();
    expect(pipeline).toContain("unit: 'money_micros'");
    expect(pipeline).not.toContain('EUR');
    expect(pipeline).not.toMatch(/currency:/);
  });
});
