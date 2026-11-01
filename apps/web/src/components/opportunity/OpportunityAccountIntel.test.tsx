import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpportunityAccountIntel } from './OpportunityAccountIntel';

const useAccountIntel = vi.fn();

vi.mock('@/hooks/useAccountIntel', () => ({
  useAccountIntel: (accountId: string | undefined) => useAccountIntel(accountId),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('framer-motion', () => ({
  motion: { div: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> },
  useReducedMotion: () => true,
}));

describe('OpportunityAccountIntel', () => {
  afterEach(() => {
    cleanup();
    useAccountIntel.mockReset();
  });

  it('does not look up a customer name as a company', () => {
    // WHY: the deal page used to pass the customer string. That is not a company id.
    useAccountIntel.mockReturnValue({ isLoading: false, isError: false, data: undefined });
    render(<OpportunityAccountIntel accountId={null} />);
    expect(screen.getByText('Not linked to a company')).toBeTruthy();
    expect(screen.getByText('A customer name is not a company link.')).toBeTruthy();
    expect(useAccountIntel).toHaveBeenCalledWith(undefined);
  });
});