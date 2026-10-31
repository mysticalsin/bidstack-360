import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OpportunitiesTableHead } from './OpportunitiesTableHead';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('OpportunitiesTableHead probability column', () => {
  it('labels the stored stage probability as a stage proxy', () => {
    // Why: the column used to say Probability, which reads as a measured win chance.
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

    const header = screen.getByRole('columnheader', { name: /Stage proxy/ });
    expect(header.getAttribute('title')).toBe('Stored stage probability');
    expect(screen.queryByRole('columnheader', { name: 'Probability' })).toBeNull();
  });
});
