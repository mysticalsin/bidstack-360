import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// WHY: demo deals store companyId, but the list query's explicit select
// omitted it. The serializer cannot link a row it never received, so the
// customer on the deals list stayed plain text.
describe('opportunity list company id', () => {
  it('selects companyId on the deals list', () => {
    const src = readFileSync(new URL('./opportunities.ts', import.meta.url), 'utf8');
    const start = src.indexOf("server.get(\n    '/opportunities',");
    const end = src.indexOf("server.get(\n    '/opportunities/count',");
    const list = src.slice(start, end);
    const select = list.slice(list.indexOf('select: {'), list.indexOf('orderBy:'));
    expect(select).toContain('companyId: true');
  });
});
