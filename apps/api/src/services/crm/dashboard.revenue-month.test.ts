import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('account revenue month query', () => {
  it('buckets won revenue on the close stamp, then the due date', () => {
    // WHY: the cockpit chart is filled by this SQL, not by the in-memory
    // fallback. A due date 45 days out must not move a win that already closed.
    const src = readFileSync(new URL('./dashboard.queries.ts', import.meta.url), 'utf8');
    const revenue = src.slice(src.indexOf('async function fetchRevenueRows'));
    expect(revenue).toContain("date_trunc('month', COALESCE(o.closed_at, o.due_date))");
    expect(revenue).toContain("date_trunc('month', COALESCE(closed_at, due_date))");
    expect(revenue).toContain('o.closed_at IS NOT NULL OR o.due_date IS NOT NULL');
    expect(revenue).toContain('closed_at IS NOT NULL OR due_date IS NOT NULL');
  });
});
