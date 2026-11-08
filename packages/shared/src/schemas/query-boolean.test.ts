// z.coerce.boolean() is Boolean(value), so the query string "false" parses as
// true: `?unreadOnly=false` returned only unread rows, `?active=false` returned
// only active workflows, `?includeArchived=false` included archived templates.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { OpportunityFilter } from './opportunity.js';
import { QueryBoolean } from './query-boolean.js';

describe('QueryBoolean', () => {
  const Q = z.object({ flag: QueryBoolean.optional() });

  it('parses the string forms a query string carries', () => {
    expect(Q.parse({ flag: 'true' }).flag).toBe(true);
    expect(Q.parse({ flag: 'false' }).flag).toBe(false);
    expect(Q.parse({ flag: '1' }).flag).toBe(true);
    expect(Q.parse({ flag: '0' }).flag).toBe(false);
    expect(Q.parse({ flag: true }).flag).toBe(true);
    expect(Q.parse({ flag: false }).flag).toBe(false);
    expect(Q.parse({}).flag).toBeUndefined();
  });

  it('rejects junk instead of guessing', () => {
    expect(Q.safeParse({ flag: 'yes please' }).success).toBe(false);
    expect(Q.safeParse({ flag: '' }).success).toBe(false);
  });

  it('keeps a default', () => {
    expect(z.object({ f: QueryBoolean.default(false) }).parse({}).f).toBe(false);
  });

  it('OpportunityFilter.overdue=false is false', () => {
    expect(OpportunityFilter.parse({ overdue: 'false' }).overdue).toBe(false);
  });
});
