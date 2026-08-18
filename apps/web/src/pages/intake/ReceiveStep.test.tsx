import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Company } from '@bidstack/shared';
import type { useFiles } from '@/hooks/useFiles';

// BLOCKER regression: the '/intake' rail item carries no account id, and the
// old "no account selected" state only told the user to hand-edit the URL
// with ?account=ACCOUNT_ID — a dead end with no way to look up that id. This
// locks in that ReceiveStep instead offers a real account picker.
const hookMocks = vi.hoisted(() => ({
  companies: [] as Company[],
}));

vi.mock('@/hooks/useFiles', () => ({
  useUploadFile: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: { items: hookMocks.companies }, isLoading: false, isError: false }),
}));

import { ReceiveStep } from './ReceiveStep';

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
    name: 'Acme Corp',
    legalName: null,
    domain: null,
    industry: null,
    employeeCount: null,
    countryCode: null,
    address: null,
    billingEmail: null,
    taxId: null,
    logoUrl: null,
    website: null,
    source: 'manual',
    confidence: 1,
    enrichedAt: null,
    tier: 'standard',
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const idleFiles = {
  isError: false,
  isLoading: false,
  error: null,
  data: { items: [] },
} as unknown as ReturnType<typeof useFiles>;

describe('ReceiveStep — no account selected', () => {
  afterEach(() => {
    cleanup();
    hookMocks.companies = [];
  });

  it('offers an account picker instead of telling the user to edit the URL', () => {
    hookMocks.companies = [company()];
    render(
      <ReceiveStep
        accountId=""
        files={idleFiles}
        selectedDocs={new Set()}
        onToggle={vi.fn()}
        onNext={vi.fn()}
        onSelectAccount={vi.fn()}
      />,
    );

    expect(screen.queryByText(/add \?account=/i)).toBeNull();
    expect(screen.getByRole('option', { name: /Acme Corp/i })).toBeTruthy();
  });

  it('calls onSelectAccount with the picked account id', () => {
    const onSelectAccount = vi.fn();
    hookMocks.companies = [company({ id: 'company-1', name: 'Acme Corp' })];
    render(
      <ReceiveStep
        accountId=""
        files={idleFiles}
        selectedDocs={new Set()}
        onToggle={vi.fn()}
        onNext={vi.fn()}
        onSelectAccount={onSelectAccount}
      />,
    );

    fireEvent.click(screen.getByRole('option', { name: /Acme Corp/i }));
    expect(onSelectAccount).toHaveBeenCalledWith('company-1');
  });

  it('moves focus to the step heading once the account transitions from empty to set', () => {
    // Selecting an account unmounts IntakeAccountPicker (the parent swaps to
    // the files view once accountId is non-empty) which used to drop focus
    // to <body> with no indication of where a keyboard-only user landed.
    hookMocks.companies = [company({ id: 'company-1', name: 'Acme Corp' })];
    const { rerender } = render(
      <ReceiveStep
        accountId=""
        files={idleFiles}
        selectedDocs={new Set()}
        onToggle={vi.fn()}
        onNext={vi.fn()}
        onSelectAccount={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('option', { name: /Acme Corp/i }));

    // The real app re-renders ReceiveStep with the newly-selected accountId
    // once IntakePage's setSearchParams commits — simulate that transition.
    rerender(
      <ReceiveStep
        accountId="company-1"
        files={idleFiles}
        selectedDocs={new Set()}
        onToggle={vi.fn()}
        onNext={vi.fn()}
        onSelectAccount={vi.fn()}
      />,
    );

    expect(document.activeElement).toBe(screen.getByText('Select documents'));
  });
});
