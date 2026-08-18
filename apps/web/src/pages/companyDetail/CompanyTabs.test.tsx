// Regression: the company detail page's Opportunities tab must show the
// human-readable stage label ('S3 Technical Iteration'), not the raw stage
// enum id ('s3_technical_iteration'), matching every other opportunity
// surface (OpportunitiesPage, cockpit widgets). Fails if the tab reverts to
// rendering o.stage directly.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpportunityTab } from './CompanyTabs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoneyMicros: (v: string) => `$${v}` }),
}));

function renderTab(stage: string) {
  return render(
    <MemoryRouter>
      <OpportunityTab
        opportunities={[
          {
            id: 'opp-1',
            code: 'OPP-001',
            name: 'Big Deal',
            stage,
            valueMicros: '1000000',
            probability: 60,
            dueDate: null,
          },
        ]}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('CompanyTabs — OpportunityTab stage label', () => {
  it('renders the humanized stage label instead of the raw enum id', () => {
    renderTab('s3_technical_iteration');

    expect(screen.getByText('S3 Technical Iteration')).toBeTruthy();
    expect(screen.queryByText('s3_technical_iteration')).toBeNull();
  });

  it('title-cases single-word and multi-word stage ids the same way', () => {
    renderTab('closed_won');

    expect(screen.getByText('Closed Won')).toBeTruthy();
  });
});
