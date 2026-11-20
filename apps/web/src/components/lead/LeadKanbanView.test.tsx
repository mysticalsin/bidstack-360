import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LeadSummary } from '@bidstack/shared';

const { mutate, info } = vi.hoisted(() => ({ mutate: vi.fn(), info: vi.fn() }));
vi.mock('@/hooks/useLeads', () => ({ useUpdateLeadById: () => ({ mutate }) }));
vi.mock('@/hooks/useLeadRot', () => ({
  useLeadRotConfig: () => ({ data: { items: [] } }),
  useRecoverySuggest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info } }));

import { LeadKanbanView } from './LeadKanbanView';

function lead(status: LeadSummary['status'], id: string): LeadSummary {
  return {
    id,
    firstName: 'Ada',
    lastName: status,
    companyName: 'Northwind',
    status,
    priority: 'medium',
    statusChangedAt: new Date().toISOString(),
  } as LeadSummary;
}

function card(root: HTMLElement) {
  const el = root.querySelector<HTMLElement>('[aria-roledescription="draggable lead"]');
  if (!el) throw new Error('no lead card rendered');
  return el;
}

describe('LeadKanbanView converted column', () => {
  afterEach(cleanup);
  beforeEach(() => {
    mutate.mockReset();
    info.mockReset();
  });

  it('moves between open statuses with the arrow keys', () => {
    const { container } = render(
      <MemoryRouter>
        <LeadKanbanView leads={[lead('new', 'l1')]} />
      </MemoryRouter>,
    );
    fireEvent.keyDown(card(container), { key: 'ArrowRight' });
    expect(mutate).toHaveBeenCalledWith({ id: 'l1', patch: { status: 'contacted' } }, expect.anything());
  });

  it('does not PATCH a lead into converted; conversion goes through the convert flow', () => {
    const { container } = render(
      <MemoryRouter>
        <LeadKanbanView leads={[lead('disqualified', 'l2')]} />
      </MemoryRouter>,
    );
    fireEvent.keyDown(card(container), { key: 'ArrowRight' });
    expect(mutate).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });

  it('keeps converted leads in place', () => {
    const { container } = render(
      <MemoryRouter>
        <LeadKanbanView leads={[lead('converted', 'l3')]} />
      </MemoryRouter>,
    );
    fireEvent.keyDown(card(container), { key: 'ArrowLeft' });
    expect(mutate).not.toHaveBeenCalled();
  });
});
