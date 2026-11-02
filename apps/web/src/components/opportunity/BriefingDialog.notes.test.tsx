import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BriefingDialog } from './BriefingDialog';

const briefState = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  data: undefined as
    | undefined
    | {
        brief: string;
        model: string;
        tokens: number;
        noteCount: number;
        notesPageContinues: boolean;
      },
  error: null,
  mutate: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useOpportunityBrief', () => ({
  useOpportunityBrief: () => briefState,
}));

describe('BriefingDialog note caption', () => {
  afterEach(() => {
    cleanup();
    briefState.data = undefined;
  });

  it('says a full note page is not every note and keeps a short page as the brief', () => {
    // WHY: the brief quoted the loaded note page as the account's notes.
    // notesPageContinues means the route read one note past the page and
    // dropped it. A shorter page is every linked note and keeps the old brief.
    briefState.data = {
      brief: '## Account Signals\n- Recent: Discovery recap',
      model: 'crm-grounded-v1',
      tokens: 80,
      noteCount: 5,
      notesPageContinues: true,
    };
    const { unmount } = render(
      <BriefingDialog open opportunityId="opp-1" opportunityLabel="Acme" onOpenChange={vi.fn()} />,
    );
    const full = screen.getByLabelText('Brief content').textContent ?? '';
    expect(full).toContain('5 in the latest 5, not every note');
    expect(full).not.toContain('5 notes');
    unmount();

    briefState.data = {
      brief: '## Account Signals\n- Recent: Discovery recap',
      model: 'crm-grounded-v1',
      tokens: 80,
      noteCount: 2,
      notesPageContinues: false,
    };
    render(
      <BriefingDialog open opportunityId="opp-1" opportunityLabel="Acme" onOpenChange={vi.fn()} />,
    );
    const short = screen.getByLabelText('Brief content').textContent ?? '';
    expect(short).toBe('## Account Signals\n- Recent: Discovery recap');
    expect(short).not.toMatch(/not every note/i);
  });
});
