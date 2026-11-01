import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OpportunitiesTableHead } from './OpportunitiesTableHead';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('OpportunitiesTableHead probability column', () => {
  it('labels the deal probability as stored, not a stage proxy', () => {
    // Why: the column is the deal field. Calling it a stage proxy, or a bare win chance, is false.
    render(
      <table>
        <OpportunitiesTableHead
          sortState={{ key: null, dir: null }}
          setSortState={() => undefined}
          allSelected={false}
          someSelected={false}
          toggleAll={() => undefined}
        />
      </table>,
    );

    const header = screen.getByRole('columnheader', { name: 'Stored probability' });
    expect(header.getAttribute('title')).toBe(
      'Stored on the deal. A blank is saved as 0 and is not a measured win chance.',
    );
    expect(screen.queryByRole('columnheader', { name: 'Stage proxy' })).toBeNull();
    const value = screen.getByRole('columnheader', { name: 'Value' });
    expect(value.getAttribute('title')).toBe('currency not recorded; not a euro forecast');
  });
});
