import { describe, expect, it } from 'vitest';

import { whoRows } from './whitespace';

const companyId = '00000000-0000-4000-8000-000000000001';

describe('who works with them totals', () => {
  it('keeps an amount whose currency was not recorded', () => {
    const rows = whoRows({
      company: { id: companyId, name: 'Acme', relation: 'self', country: null },
      companies: [],
      rows: [
        {
          kind: 'opportunity',
          id: 'opp-1',
          label: 'Deal',
          companyId,
          companyName: 'Acme',
          entity: 'Amaris',
          line: 'cloud',
          owner: null,
          lastActivityAt: null,
          valueMicros: 2_500_000,
          currency: null,
          country: null,
        },
        {
          kind: 'opportunity',
          id: 'opp-2',
          label: 'Euro deal',
          companyId,
          companyName: 'Acme',
          entity: 'Amaris',
          line: 'cloud',
          owner: null,
          lastActivityAt: null,
          valueMicros: 1_000_000,
          currency: 'EUR',
          country: null,
        },
      ],
      people: [],
      activity: [],
    });
    expect(rows[0]?.totals).toEqual([
      { currency: 'EUR', valueMicros: 1_000_000 },
      { currency: 'unspecified', valueMicros: 0, unknownCount: 1 },
    ]);
  });

  it('does not add two amounts that have no currency', () => {
    const row = {
      kind: 'opportunity' as const,
      id: '00000000-0000-4000-8000-000000000010',
      label: 'Deal',
      companyId,
      companyName: 'Acme',
      entity: 'Amaris',
      line: 'cloud',
      owner: null,
      lastActivityAt: null,
      country: null,
    };
    const rows = whoRows({
      companyId,
      companies: [],
      entities: [],
      people: [],
      lines: [],
      countries: [],
      rows: [
        { ...row, valueMicros: 2_500_000, currency: null },
        { ...row, id: '00000000-0000-4000-8000-000000000011', valueMicros: 4_000_000, currency: ' ' },
      ],
    });
    expect(rows[0]?.totals).toEqual([{ currency: 'unspecified', valueMicros: 0, unknownCount: 2 }]);
  });
});
