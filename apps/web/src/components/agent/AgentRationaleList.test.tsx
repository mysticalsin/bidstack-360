// "What the agent did" is rendered from BidFact rows and nothing else — no task
// queue, no run history (ROUND2-ULTRAPLAN: no dispatcher this round). These
// tests pin the two things a reviewer reads it for: order (newest first) and
// the amber that marks a held outcome apart from an ordinary one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { BidFact } from '@/hooks/agent/useBidFacts';
import { AgentRationaleList } from './AgentRationaleList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

function fact(overrides: Partial<BidFact> = {}): BidFact {
  return {
    id: 'f1',
    opportunityId: 'o1',
    subjectType: 'matrix_row',
    subjectId: 'r1',
    claim: 'YES — EU datacentres only',
    verdict: 'YES',
    confidenceBps: 9000,
    band: 'VERIFIED',
    assessmentStatus: 'ASSESSED',
    rationale: 'The bid library states this directly',
    status: 'PROPOSED',
    producedByAgentKey: 'compliance-fill',
    decidedByUserId: null,
    decidedAt: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    citations: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe('AgentRationaleList', () => {
  it('says plainly that nothing has been proposed rather than rendering an empty table', () => {
    render(<AgentRationaleList facts={[]} />);
    expect(screen.getByText('The agent has not proposed anything on this bid yet.')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('orders newest first', () => {
    render(
      <AgentRationaleList
        facts={[
          fact({ id: 'a', claim: 'Older claim', createdAt: '2026-07-01T09:00:00.000Z' }),
          fact({ id: 'b', claim: 'Newer claim', createdAt: '2026-08-03T09:00:00.000Z' }),
        ]}
      />,
    );
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rows[0]?.textContent).toContain('Newer claim');
    expect(rows[1]?.textContent).toContain('Older claim');
  });

  it('marks a held outcome amber and drops the duplicated "Held:" prefix', () => {
    render(
      <AgentRationaleList
        facts={[
          fact({
            rationale: 'Held: amendment 2 contradicts the base document on SLA.',
            confidenceBps: 4500,
            band: 'POSSIBLE',
          }),
        ]}
      />,
    );
    const row = screen.getAllByRole('row')[1];
    expect(row?.className).toContain('warning');
    expect(screen.getByText('Held')).toBeDefined();
    expect(screen.getByText('amendment 2 contradicts the base document on SLA.')).toBeDefined();
  });

  it('shows the ledger state for a settled fact, never an error tone', () => {
    render(<AgentRationaleList facts={[fact({ status: 'DISMISSED' })]} />);
    expect(screen.getByText('Dismissed')).toBeDefined();
    const dot = document.querySelector('[data-slot="indicator-dot"]');
    expect(dot?.getAttribute('data-tone')).toBe('neutral');
  });

  it('caps the list so a long ledger cannot take over the panel', () => {
    const facts = Array.from({ length: 20 }, (_, index) =>
      fact({ id: `f${index}`, createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T09:00:00.000Z` }),
    );
    render(<AgentRationaleList facts={facts} limit={5} />);
    expect(screen.getAllByRole('row')).toHaveLength(6); // 5 + header
  });
});
