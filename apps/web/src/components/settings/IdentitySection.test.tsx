import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isSignedIn: true }),
  useIsAdmin: () => authMocks.isAdmin,
}));

vi.mock('@/hooks/usePoloIdentity', () => ({
  usePoloPublicIdentity: () => ({
    isLoading: false,
    data: { dataMode: 'real', authProvider: 'cf-access', demoBanner: false, cfAccessEnabled: true },
  }),
  usePoloMe: () => ({
    isLoading: false,
    data: { name: 'Ada', email: 'ada@example.com', role: 'admin', roles: ['Admin'], allowlist: [] },
  }),
}));

vi.mock('@/hooks/useOrgDemoData', () => ({
  useOrgDemoData: () => ({ isLoading: false, isError: false, data: { demoData: false }, refetch: vi.fn() }),
  useUpdateOrgDemoData: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock('@/components/settings/TeamSection', () => ({ TeamSection: () => null }));

import { IdentitySection } from './IdentitySection';

afterEach(() => {
  cleanup();
  authMocks.isAdmin = true;
});

describe('identity data-mode badge', () => {
  it('is the Demo data switch for an owner or system Admin, and is hidden from everyone else', () => {
    // WHY: Settings showed Real or Demo as a badge nobody could change.
    // The badge has to be the org switch, and only an owner or Admin may use it.
    render(<IdentitySection />);
    expect(screen.getByRole('switch', { name: 'Demo data' })).toBeTruthy();
    expect(screen.queryByText('Real')).toBeNull();

    cleanup();
    authMocks.isAdmin = false;
    render(<IdentitySection />);
    expect(screen.queryByRole('switch', { name: 'Demo data' })).toBeNull();
  });
});
