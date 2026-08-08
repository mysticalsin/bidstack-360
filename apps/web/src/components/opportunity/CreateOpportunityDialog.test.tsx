// POST /api/opportunities is gated server-side behind opportunities:write
// (apps/api/src/routes/opportunities.ts). This dialog opens from several
// controlled, non-gated call sites too (quick-add menu, command palette,
// cockpit header "Create opportunity"), so the fix lives in the dialog
// itself: hide the default trigger AND disable Create with a hint, instead
// of dead-ending in a 403 after the form is filled out.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  canWrite: true,
  createMutate: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => hookMocks.canWrite,
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useCreateOpportunity: () => ({ mutate: hookMocks.createMutate, isPending: false }),
}));

import { CreateOpportunityDialog } from './CreateOpportunityDialog';

describe('CreateOpportunityDialog — opportunities:write gating', () => {
  afterEach(() => {
    cleanup();
    hookMocks.canWrite = true;
    hookMocks.createMutate.mockClear();
  });

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

    const submit = screen.getByRole('button', { name: 'Create opportunity' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('title')).toBe(
      'You need opportunities write access to create an opportunity.',
    );
    expect(
      screen.getByText('You need opportunities write access to create an opportunity.'),
    ).toBeTruthy();
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
});
