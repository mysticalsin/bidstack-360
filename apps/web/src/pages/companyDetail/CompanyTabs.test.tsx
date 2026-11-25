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

// Demo close dates sit in April–September 2026. On a later day those bids are
// overdue. The company opportunities tab used to drop dueDate, so the row
// looked current and the only way to see the deadline was to open the bid.
function renderDue(dueDate: string | null) {
  return render(
    <MemoryRouter>
      <OpportunityTab
        opportunities={[
          {
            id: 'opp-2041',
            code: 'OP-2041',
            name: 'CI Financial — IT Modernization & MSP',
            stage: 's3_technical_iteration',
            valueMicros: '1240000000000',
            probability: 65,
            dueDate,
          },
        ]}
      />
    </MemoryRouter>,
  );
}

describe('CompanyTabs — OpportunityTab due date', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says a past close date is overdue instead of hiding the date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));
    renderDue('2026-07-22T00:00:00.000Z');

    expect(screen.getByRole('columnheader', { name: 'Due' })).toBeTruthy();
    expect(screen.getByText(/\d+d overdue/)).toBeTruthy();
  });

  it('does not call a later close date overdue', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T12:00:00.000Z'));
    renderDue('2026-12-20T00:00:00.000Z');

    expect(screen.getByText(/\d+d left/)).toBeTruthy();
    expect(screen.queryByText(/overdue/)).toBeNull();
  });

  it('says when the bid has no due date', () => {
    renderDue(null);

    expect(screen.getByText('No date')).toBeTruthy();
  });
});
