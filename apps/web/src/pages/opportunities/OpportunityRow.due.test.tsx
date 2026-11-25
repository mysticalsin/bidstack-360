// The opportunities list is where a decided demo bid is scanned. OP-2046
// (Aritzia, closed won, due 2026-04-28) must not read as days overdue next
// to its date. An open bid on the same list still must.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { Opportunity } from '@bidstack/shared';

import { Row } from './OpportunityRow';

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const WON: Opportunity = {
  id: '2046',
  code: 'OP-2046',
  customer: 'Aritzia',
  name: 'Aritzia — Endpoint Refresh',
  stage: 'closed_won',
  pipelineStageId: null,
  pipelineStage: null,
  value: 410_000,
  probability: 100,
  dueDate: '2020-01-01',
  owner: null,
  industry: 'retail',
  logo: null,
  country: 'CA',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-04-28T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

function renderRow(opp: Opportunity) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <Row
            opp={opp}
            stageOptions={[]}
            isSelected={false}
            onToggleSelect={vi.fn()}
            patch={{ mutate: vi.fn(), isPending: false } as never}
            canWrite={false}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Opportunity row due clock', () => {
  it('does not call a closed-won bid overdue', () => {
    renderRow(WON);
    expect(screen.getByText('Closed')).toBeDefined();
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it('still says an open bid is overdue when the due date has passed', () => {
    renderRow({ ...WON, id: '2043', code: 'OP-2043', stage: 's4_negotiation', probability: 78 });
    expect(screen.getByText(/d overdue/)).toBeDefined();
    expect(screen.queryByText('Closed')).toBeNull();
  });
});
