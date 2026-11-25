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

// The company Opportunities tab receives dueDate and drops it. On the demo
// book an open bid such as Logistec SOC 2 (due 2026-08-15, still S1) is
// already late, and the tab still looks current. A won bid such as Aritzia
// Endpoint Refresh (closed 2026-04-28) has a past due date because it already
// closed — that must not read as overdue.
function renderDue(stage: string, dueDate: string | null, name = 'Logistec — SOC 2 Readiness') {
  return render(
    <MemoryRouter>
      <OpportunityTab
        opportunities={[
          {
            id: 'opp-due',
            code: 'OP-2042',
            name,
            stage,
            valueMicros: '320000000000',
            probability: 35,
            dueDate,
          },
        ]}
      />
    </MemoryRouter>,
  );
}

describe('CompanyTabs — OpportunityTab due clock', () => {
  it('says an open bid is overdue when its due date is already past', () => {
    renderDue('s1_ongoing', '2020-01-01');

    expect(screen.getByText(/d overdue/)).toBeTruthy();
    expect(screen.queryByText('Closed')).toBeNull();
  });

  it('keeps a bid due today off the overdue count', () => {
    const today = new Date().toISOString().slice(0, 10);
    renderDue('s3_technical_iteration', today, 'CI Financial — IT Modernization');

    expect(screen.getByText('Due today')).toBeTruthy();
    expect(screen.queryByText(/overdue/)).toBeNull();
  });

  it('stops the clock once the bid is won or lost, even if the due date is past', () => {
    for (const stage of ['closed_won', 'closed_lost'] as const) {
      cleanup();
      renderDue(stage, '2020-01-01', 'Aritzia — Endpoint Refresh');

      expect(screen.getByText('Closed')).toBeTruthy();
      expect(screen.queryByText(/overdue/)).toBeNull();
    }
  });
});
