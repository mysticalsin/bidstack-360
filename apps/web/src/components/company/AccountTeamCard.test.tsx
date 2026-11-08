import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAccountTeam', () => ({
  useAccountTeam: vi.fn(),
  useUserAllocation: vi.fn(() => ({ data: undefined })),
  useAddTeamMember: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateTeamMember: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemoveTeamMember: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useUsers', () => ({ useUsers: vi.fn(() => ({ data: [], isLoading: false })) }));

import { useAccountTeam, useRemoveTeamMember, useUserAllocation } from '@/hooks/useAccountTeam';
import { useHasPermission } from '@/hooks/useCapabilities';

import { AccountTeamCard } from './AccountTeamCard';
import { projectedAllocation } from './accountTeam';
import { AccountTeamMemberDialog } from './AccountTeamMemberDialog';

const COMPANY = '00000000-0000-4000-8000-000000000003';

const member = {
  id: '00000000-0000-4000-8000-0000000000a1',
  companyId: COMPANY,
  userId: '00000000-0000-4000-8000-0000000000b1',
  userName: 'Ana Silva',
  userEmail: 'ana@example.test',
  role: 'delivery_lead' as const,
  allocationPct: 60,
  startDate: '2026-11-01',
  endDate: null,
  totalAllocationPct: 120,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function team(data: unknown) {
  vi.mocked(useAccountTeam).mockReturnValue({ data, isLoading: false, isError: false } as never);
}

afterEach(() => {
  cleanup();
  vi.mocked(useHasPermission).mockReturnValue(true);
});

describe('AccountTeamCard', () => {
  it('shows the key account owner as account lead and members with allocation', () => {
    team({
      keyAccountOwner: { userId: 'u0', name: 'Tony Lead', email: 't@example.test' },
      members: [member],
    });
    render(<AccountTeamCard companyId={COMPANY} />);
    expect(screen.getByText('Tony Lead')).toBeTruthy();
    expect(screen.getByText('Owner of record')).toBeTruthy();
    expect(screen.getByText('Ana Silva')).toBeTruthy();
    expect(screen.getByText(/Delivery lead, from Nov 1, 2026/)).toBeTruthy();
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('60');
    expect(meter.getAttribute('aria-label')).toContain('120% across accounts');
    expect(meter.querySelector('[data-over]')).toBeTruthy();
  });

  it('hides add, edit and remove without companies:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    team({ keyAccountOwner: null, members: [member] });
    render(<AccountTeamCard companyId={COMPANY} />);
    expect(screen.queryByRole('button', { name: /Add member/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit Ana Silva/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove Ana Silva/ })).toBeNull();
  });

  it('removes a member for writers', () => {
    const mutate = vi.fn();
    vi.mocked(useRemoveTeamMember).mockReturnValue({ mutate, isPending: false } as never);
    team({ keyAccountOwner: null, members: [member] });
    render(<AccountTeamCard companyId={COMPANY} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove Ana Silva/ }));
    expect(mutate).toHaveBeenCalledWith(member.id);
  });

  it('shows the empty line when nobody is on the team', () => {
    team({ keyAccountOwner: null, members: [] });
    render(<AccountTeamCard companyId={COMPANY} />);
    expect(screen.getByText('No one on the team yet')).toBeTruthy();
  });
});

describe('allocation warning', () => {
  it('projects the total with the edit applied', () => {
    expect(projectedAllocation(90, 30, 50)).toBe(110);
    expect(projectedAllocation(40, null, 20)).toBe(60);
    expect(projectedAllocation(40, 40, null)).toBe(0);
  });

  it('warns in the edit dialog when the person goes over 100%', () => {
    vi.mocked(useUserAllocation).mockReturnValue({
      data: { userId: member.userId, totalPct: 90, accounts: [] },
    } as never);
    render(
      <AccountTeamMemberDialog
        companyId={COMPANY}
        open
        onOpenChange={() => {}}
        member={{ ...member, allocationPct: 30 }}
      />,
    );
    expect(screen.queryByText(/would be at/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Allocation %'), { target: { value: '50' } });
    expect(screen.getByText('Ana Silva would be at 110% across accounts')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('blocks an end date before the start date', () => {
    render(
      <AccountTeamMemberDialog companyId={COMPANY} open onOpenChange={() => {}} member={member} />,
    );
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-01' } });
    expect(screen.getByText('End date must be on or after the start date')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });
});
