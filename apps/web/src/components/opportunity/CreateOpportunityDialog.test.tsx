// POST /api/opportunities is gated server-side behind opportunities:write
// (apps/api/src/routes/opportunities.ts). This dialog opens from several
// controlled, non-gated call sites too (quick-add menu, command palette,
// cockpit header "Create opportunity"), so the fix lives in the dialog
// itself: hide the default trigger AND disable Create with a hint, instead
// of dead-ending in a 403 after the form is filled out.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('shows stage and industry in words, because the stored keys are not labels', () => {
    // A seller picking a stage should see "S1 Lead", the same words as the
    // board. The option value stays the storage key.
    hookMocks.canWrite = true;
    render(<CreateOpportunityDialog open onOpenChange={vi.fn()} />);

    const stage = document.querySelector('select[name="stage"]') as HTMLSelectElement;
    const stageLabels = [...stage.options].map((option) => option.text);
    expect(stageLabels).toContain('S1 Lead');
    expect(stageLabels).not.toContain('s1_lead');
    expect(screen.getByRole('combobox', { name: 'Stage' }).textContent).toContain('S1 Ongoing');

    const industry = document.querySelector('select[name="industry"]') as HTMLSelectElement;
    const industryLabels = [...industry.options].map((option) => option.text);
    expect(industryLabels).toContain('Financial Services');
    expect(industryLabels).not.toContain('financial_services');
  });

  it('asks the seller to choose a customer instead of quoting the schema', () => {
    hookMocks.canWrite = true;
    render(<CreateOpportunityDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Opportunity name'), {
      target: { value: 'Northwind Labs — Clinic add' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create opportunity' }));

    expect(screen.getByRole('alert').textContent).toBe('Choose a customer.');
    expect(screen.queryByText(/String must contain/)).toBeNull();
    expect(hookMocks.createMutate).not.toHaveBeenCalled();
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
