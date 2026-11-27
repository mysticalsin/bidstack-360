// POST /api/opportunities is gated server-side behind opportunities:write
// (apps/api/src/routes/opportunities.ts). This dialog opens from several
// controlled, non-gated call sites too (quick-add menu, command palette,
// cockpit header "Create opportunity"), so the fix lives in the dialog
// itself: hide the default trigger AND disable Create with a hint, instead
// of dead-ending in a 403 after the form is filled out.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const LEAD = '11111111-1111-4111-8111-111111111111';
const NEGOTIATION = '22222222-2222-4222-8222-222222222222';

const loadedStages = {
  data: {
    items: [
      {
        id: LEAD,
        key: 's1_lead',
        name: 'S1 Lead',
        isWon: false,
        isLost: false,
      },
      {
        id: NEGOTIATION,
        key: 's4_negotiation',
        name: 'S4 Negotiation',
        isWon: false,
        isLost: false,
      },
    ],
    pageContinues: false,
  },
  isLoading: false,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

const hookMocks = vi.hoisted(() => ({
  canWrite: true,
  createMutate: vi.fn(),
  stages: null as null | {
    data?: { items: Array<Record<string, unknown>>; pageContinues: boolean };
    isLoading: boolean;
    isPending: boolean;
    isError: boolean;
    refetch: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => hookMocks.canWrite,
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useCreateOpportunity: () => ({ mutate: hookMocks.createMutate, isPending: false }),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: () => hookMocks.stages,
}));

import { CreateOpportunityDialog } from './CreateOpportunityDialog';

describe('CreateOpportunityDialog — opportunities:write gating', () => {
  afterEach(() => {
    cleanup();
    hookMocks.canWrite = true;
    hookMocks.createMutate.mockClear();
    hookMocks.stages = {
      ...loadedStages,
      refetch: vi.fn(),
    };
  });

  // The stage read has to be ready before the first render: a missing board
  // stage disables Create, which these permission cases are not about.
  hookMocks.stages = {
    ...loadedStages,
    refetch: vi.fn(),
  };

  it('renders the default "+ New opportunity" trigger for a user with opportunities:write', () => {
    hookMocks.canWrite = true;
    render(<CreateOpportunityDialog />);

    expect(screen.getByRole('button', { name: '+ New opportunity' })).toBeTruthy();
  });

  it('hides the default trigger for a user without opportunities:write', () => {
    hookMocks.canWrite = false;
    render(<CreateOpportunityDialog />);

    expect(screen.queryByRole('button', { name: '+ New opportunity' })).toBeNull();
  });

  it('disables Create opportunity and explains why when opened via a controlled caller without opportunities:write', () => {
    // Mirrors how the quick-add menu / command palette open this dialog:
    // a hidden trigger + a controlled `open` prop, bypassing any call-site gate.
    hookMocks.canWrite = false;
    render(<CreateOpportunityDialog open onOpenChange={vi.fn()} />);

    const submit = screen.getByRole('button', { name: /^Create opportunity/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('title')).toBe(
      'You need opportunities write access to create an opportunity.',
    );
    expect(
      screen.getByText('You need opportunities write access to create an opportunity.'),
    ).toBeTruthy();
    // `title` is mouse-only — the accessible name itself must carry the
    // reason so screen-reader/keyboard users get it too.
    expect(submit.getAttribute('aria-label')).toBe(
      'Create opportunity — You need opportunities write access to create an opportunity.',
    );
  });

  it('keeps Create opportunity enabled for a user with opportunities:write', () => {
    hookMocks.canWrite = true;
    render(<CreateOpportunityDialog open onOpenChange={vi.fn()} />);

    const submit = screen.getByRole('button', { name: 'Create opportunity' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(
      screen.queryByText('You need opportunities write access to create an opportunity.'),
    ).toBeNull();
  });

  it('files the bid on the board stage the user picked, not the first column', () => {
    render(<CreateOpportunityDialog open onOpenChange={vi.fn()} defaultCustomer="Siemens" />);

    expect(screen.queryByRole('option', { name: 's4_negotiation' })).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'Stage' }));
    fireEvent.click(screen.getByRole('option', { name: 'S4 Negotiation' }));
    fireEvent.change(screen.getByLabelText('Opportunity name'), {
      target: { value: 'Plant network' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create opportunity' }));

    expect(hookMocks.createMutate).toHaveBeenCalledTimes(1);
    const payload = hookMocks.createMutate.mock.calls[0]?.[0] as {
      pipelineStageId?: string;
      stage?: string;
      customer?: string;
      name?: string;
    };
    expect(payload).toMatchObject({
      customer: 'Siemens',
      name: 'Plant network',
      pipelineStageId: NEGOTIATION,
      stage: 's4_negotiation',
    });
    expect(payload.pipelineStageId).not.toBe(LEAD);
  });

  it('does not create a bid while the board stages are still loading', () => {
    hookMocks.stages = {
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    };
    render(<CreateOpportunityDialog open onOpenChange={vi.fn()} defaultCustomer="Siemens" />);

    const submit = screen.getByRole('button', {
      name: 'Create opportunity — Loading pipeline stages…',
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(hookMocks.createMutate).not.toHaveBeenCalled();
  });

  it('says the stage read failed instead of offering a legacy stage list', () => {
    const refetch = vi.fn();
    hookMocks.stages = {
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      refetch,
    };
    render(<CreateOpportunityDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('alert').textContent).toContain("Couldn't load pipeline stages.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('option', { name: 's1_ongoing' })).toBeNull();
    const submit = screen.getByRole('button', {
      name: "Create opportunity — Couldn't load pipeline stages.",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
