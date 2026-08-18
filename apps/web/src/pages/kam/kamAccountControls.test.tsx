// Regression coverage for the KAM designate write gating: the candidates
// typeahead (GET) and designate PATCH (kam-accounts.ts:83,114) are gated
// server-side behind kam:write, but the "Designate a key account" entry
// points and the designate submit rendered enabled unconditionally for every
// role — a role without the permission could open the flow only to 403 as
// soon as it searched or submitted.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { KamAccountSwitcher, KamDesignateDialog, KamZeroState } from './kamAccountControls';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useDesignateAccount, useKamCandidates } from '@/hooks/useKamAccounts';
import type { KamAccount } from '@bidstack/shared';

vi.mock('@/hooks/useKamAccounts', () => ({
  useKamCandidates: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
  useDesignateAccount: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

// The designate flow is gated server-side behind kam:write — default true so
// incidental rendering assertions aren't affected; the dedicated describe
// blocks below override per-test.
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

const account: KamAccount = {
  id: 'co-1',
  name: 'Acme',
  domain: 'acme.com',
  countryCode: 'ES',
  industry: null,
  kamStatus: 'active',
  kamOwnerModel: 'presales_driven',
} as KamAccount;

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
});

describe('KamAccountSwitcher — kam:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHasPermission).mockReturnValue(true);
  });

  it('renders the "Designate a key account" entry point for a role with kam:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderWithClient(
      <KamAccountSwitcher
        open
        onOpenChange={vi.fn()}
        accounts={[account]}
        activeId={account.id}
        onSelect={vi.fn()}
        onDesignate={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Designate a key account/i })).toBeTruthy();
  });

  it('hides the "Designate a key account" entry point for a role without kam:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderWithClient(
      <KamAccountSwitcher
        open
        onOpenChange={vi.fn()}
        accounts={[account]}
        activeId={account.id}
        onSelect={vi.fn()}
        onDesignate={vi.fn()}
      />,
    );

    // The switcher itself still renders (read access is ungated) ...
    expect(screen.getByText('Acme')).toBeTruthy();
    // ... but the write affordance that would 403 as soon as it searched is gone.
    expect(screen.queryByRole('button', { name: /Designate a key account/i })).toBeNull();
  });
});

describe('KamZeroState — kam:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHasPermission).mockReturnValue(true);
  });

  it('renders the designate CTA for a role with kam:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    render(<KamZeroState onDesignate={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Designate a key account/i })).toBeTruthy();
  });

  it('hides the designate CTA for a role without kam:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    render(<KamZeroState onDesignate={vi.fn()} />);

    expect(screen.getByText('No key accounts yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Designate a key account/i })).toBeNull();
  });
});

describe('KamDesignateDialog — kam:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHasPermission).mockReturnValue(true);
    vi.mocked(useKamCandidates).mockReturnValue({
      data: { items: [] },
      isLoading: false,
    } as ReturnType<typeof useKamCandidates>);
    vi.mocked(useDesignateAccount).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDesignateAccount>);
  });

  it('enables the designate submit for a role with kam:write once a company is picked', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    vi.mocked(useKamCandidates).mockReturnValue({
      data: { items: [{ id: 'co-2', name: 'Beta Co', domain: 'beta.com', countryCode: 'FR' }] },
      isLoading: false,
    } as ReturnType<typeof useKamCandidates>);

    renderWithClient(<KamDesignateDialog open onOpenChange={vi.fn()} onDesignated={vi.fn()} />);
    fireEvent.click(screen.getByRole('option', { name: /Beta Co/i }));

    const submit = screen.getByRole('button', { name: /Designate key account/i });
    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('disables the designate submit with a hint for a role without kam:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    vi.mocked(useKamCandidates).mockReturnValue({
      data: { items: [{ id: 'co-2', name: 'Beta Co', domain: 'beta.com', countryCode: 'FR' }] },
      isLoading: false,
    } as ReturnType<typeof useKamCandidates>);

    renderWithClient(<KamDesignateDialog open onOpenChange={vi.fn()} onDesignated={vi.fn()} />);
    fireEvent.click(screen.getByRole('option', { name: /Beta Co/i }));

    const submit = screen.getByRole('button', { name: /Designate key account/i });
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(submit.getAttribute('title')).toMatch(/kam\.designate\.readOnlyHint|write access/i);
  });
});
