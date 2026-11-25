import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({
  publicId: {
    isLoading: false,
    isError: false,
    data: undefined as
      | {
          dataMode: 'demo' | 'real';
          authProvider: 'stub' | 'clerk' | 'demo' | 'cf-access';
          demoBanner: boolean;
          cfAccessEnabled: boolean;
        }
      | undefined,
  },
  me: {
    isLoading: false,
    isError: false,
    data: undefined as
      | {
          id: string;
          email: string | null;
          name: string | null;
          role: string;
          roles: string[];
          dataMode: 'demo' | 'real';
          authProvider: 'stub' | 'clerk' | 'demo' | 'cf-access';
        }
      | undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isSignedIn: true, isLoaded: true }),
  useIsAdmin: () => false,
}));

vi.mock('@/hooks/usePoloIdentity', () => ({
  usePoloPublicIdentity: () => identity.publicId,
  usePoloMe: () => identity.me,
}));

vi.mock('@/components/settings/TeamSection', () => ({
  TeamSection: () => <div data-testid="team-section" />,
}));

import { IdentitySection } from './IdentitySection';

function settled(input: {
  dataMode: 'demo' | 'real';
  authProvider: 'stub' | 'clerk' | 'demo' | 'cf-access';
  name?: string | null;
  email?: string | null;
  role?: string;
  roles?: string[];
}): void {
  identity.publicId = {
    isLoading: false,
    isError: false,
    data: {
      dataMode: input.dataMode,
      authProvider: input.authProvider,
      demoBanner: input.dataMode === 'demo',
      cfAccessEnabled: input.authProvider === 'cf-access',
    },
  };
  identity.me = {
    isLoading: false,
    isError: false,
    data: {
      id: 'user-demo-1',
      email: input.email === undefined ? 'ada.visitor@example.test' : input.email,
      name: input.name === undefined ? 'Ada Visitor' : input.name,
      role: input.role ?? 'member',
      roles: input.roles ?? ['Seller'],
      dataMode: input.dataMode,
      authProvider: input.authProvider,
    },
  };
}

function hasEmDash(text: string | null | undefined): boolean {
  return (text ?? '').includes(String.fromCharCode(0x2014));
}

describe('settings login identity under demo data', () => {
  afterEach(() => {
    cleanup();
    identity.publicId = { isLoading: false, isError: false, data: undefined };
    identity.me = { isLoading: false, isError: false, data: undefined };
  });

  it('does not name Jane Smith on a synthetic demo session that uses the stub door', () => {
    // WHY: Identity and roles is the page the demo banner opens. Demo data
    // mode with the local stub door printed Dev stub (Jane Smith). That
    // person is not the synthetic session. The signed-in name stays, the
    // door says Dev stub, and the card does not borrow a name.
    settled({ dataMode: 'demo', authProvider: 'stub' });

    render(<IdentitySection />);

    expect(screen.queryAllByText(/Jane Smith/)).toHaveLength(0);
    expect(screen.getByText('Ada Visitor')).toBeTruthy();
    expect(screen.getByText('ada.visitor@example.test')).toBeTruthy();
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.getByText('Dev stub')).toBeTruthy();
    expect(screen.getByTestId('team-section')).toBeTruthy();
    expect(hasEmDash(document.body.textContent)).toBe(false);
  });

  it('does not call the public demo door a dev stub or Jane Smith', () => {
    // WHY: DEMO_MODE answers authProvider demo. That door is the public demo
    // over synthetic records. It is not the local stub and it is not a
    // named person.
    settled({ dataMode: 'demo', authProvider: 'demo' });

    render(<IdentitySection />);

    expect(screen.queryAllByText(/Jane Smith/)).toHaveLength(0);
    expect(screen.queryByText('Dev stub')).toBeNull();
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.getByText('Public demo door')).toBeTruthy();
  });

  it('does not invent Demo or Jane Smith when the identity answer fails', () => {
    // WHY: a failed identity request is not evidence of demo data and not a
    // person. The rows say they could not load.
    identity.publicId = { isLoading: false, isError: true, data: undefined };
    identity.me = { isLoading: false, isError: true, data: undefined };

    render(<IdentitySection />);

    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.queryAllByText(/Jane Smith/)).toHaveLength(0);
    expect(screen.queryByText('Dev stub')).toBeNull();
    expect(screen.getAllByRole('status', { name: 'Could not load' }).length).toBeGreaterThan(0);
    expect(hasEmDash(document.body.textContent)).toBe(false);
  });

  it('does not invent Demo or Jane Smith while the identity answer is still loading', () => {
    // WHY: until the identity request answers, the card used to keep Jane
    // Smith in the caption. The rows wait.
    identity.publicId = { isLoading: true, isError: false, data: undefined };
    identity.me = { isLoading: true, isError: false, data: undefined };

    render(<IdentitySection />);

    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.queryAllByText(/Jane Smith/)).toHaveLength(0);
    expect(screen.queryByText('Dev stub')).toBeNull();
  });

  it('does not fill an empty email or role with a dash', () => {
    // WHY: a synthetic session can be signed in before an email or RBAC role
    // is on file. Those rows were em dashes. Empty stays empty in words.
    settled({
      dataMode: 'demo',
      authProvider: 'demo',
      email: null,
      role: '',
      roles: [],
    });

    render(<IdentitySection />);

    expect(hasEmDash(document.body.textContent)).toBe(false);
    expect(screen.getAllByText('Not on file').length).toBeGreaterThan(0);
    expect(screen.getByText('Ada Visitor')).toBeTruthy();
  });

  it('keeps Cloudflare Access and Clerk when that is the identity answer', () => {
    // WHY: the demo label is only for the demo door. Cloudflare Access and
    // Clerk stay themselves, including when the data under them is synthetic.
    settled({ dataMode: 'demo', authProvider: 'cf-access', name: 'Ada Access' });
    render(<IdentitySection />);
    expect(screen.getByText('Cloudflare Access')).toBeTruthy();
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.queryAllByText(/Jane Smith/)).toHaveLength(0);
    expect(screen.queryByText('Dev stub')).toBeNull();
    cleanup();

    settled({ dataMode: 'real', authProvider: 'clerk', name: 'Ada Clerk' });
    render(<IdentitySection />);
    expect(screen.getByText('Clerk')).toBeTruthy();
    expect(screen.getByText('Real')).toBeTruthy();
    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.queryAllByText(/Jane Smith/)).toHaveLength(0);
  });
});
