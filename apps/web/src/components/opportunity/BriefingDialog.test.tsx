import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BriefingDialog } from './BriefingDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useOpportunityBrief', () => ({
  useOpportunityBrief: () => ({
    isPending: true,
    isError: false,
    data: undefined,
    error: null,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
}));

describe('BriefingDialog', () => {
  afterEach(cleanup);

  it('shows a breathing mark while the brief is written from the record', () => {
    // WHY: a skeleton reads as a missing page. The wait is the brief being
    // written from the recorded deal, and it must say that.
    render(
      <BriefingDialog
        open
        opportunityId="opp-1"
        opportunityLabel="CI Financial"
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('status').textContent).toMatch(/recorded deal/);
  });
});
