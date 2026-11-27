import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { workspaceEnvironment } from './workspace-environment';

const identity = vi.hoisted(() => ({
  current: {
    isLoading: false,
    isError: false,
    data: undefined as { dataMode: 'demo' | 'real' } | undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isSignedIn: true, isLoaded: true }),
  useUser: () => ({
    user: {
      fullName: 'Ada Admin',
      firstName: 'Ada',
      primaryEmailAddress: { emailAddress: 'ada.admin@example.test' },
    },
  }),
}));

vi.mock('@/hooks/usePoloIdentity', () => ({
  usePoloPublicIdentity: () => identity.current,
}));

import { WorkspaceSection } from './WorkspaceSection.original';

describe('workspaceEnvironment', () => {
  it('calls demo data Demo and keeps a real production build labeled production', () => {
    // WHY: the public demo bundle is built with Vite MODE=production. The
    // Workspace card exists so someone can see which data they are about to
    // trust. Synthetic demo records are not a production org. A real org
    // still shows the build environment, including staging.
    expect(
      workspaceEnvironment({ status: 'ready', dataMode: 'demo', viteMode: 'production' }),
    ).toEqual({ state: 'ready', label: 'Demo', tone: 'amber' });
    expect(
      workspaceEnvironment({ status: 'ready', dataMode: 'real', viteMode: 'production' }),
    ).toEqual({ state: 'ready', label: 'production', tone: 'jade' });
    expect(
      workspaceEnvironment({ status: 'ready', dataMode: 'real', viteMode: 'staging' }),
    ).toEqual({ state: 'ready', label: 'staging', tone: 'amber' });
    expect(workspaceEnvironment({ status: 'loading', dataMode: 'demo', viteMode: 'production' })).toEqual({
      state: 'loading',
    });
    expect(workspaceEnvironment({ status: 'error', viteMode: 'production' })).toEqual({ state: 'error' });
    expect(workspaceEnvironment({ status: 'ready', dataMode: null, viteMode: 'production' })).toEqual({
      state: 'error',
    });
  });
});

describe('settings workspace environment', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    identity.current = { isLoading: false, isError: false, data: undefined };
  });

  it('does not call a demo workspace production while the demo bundle is built that way', () => {
    // WHY: Settings, Workspace is the fingerprint an admin reads before minting
    // a key. On the demo build Vite MODE is production, so the row wore a
    // green production badge over synthetic records. The row says Demo, and
    // it does not say production.
    vi.stubEnv('MODE', 'production');
    identity.current = { isLoading: false, isError: false, data: { dataMode: 'demo' } };

    render(<WorkspaceSection />);

    expect(screen.queryByText('production')).toBeNull();
    expect(screen.getByText('Demo')).toBeTruthy();
  });

  it('keeps production on a real workspace built in production mode', () => {
    // WHY: the demo label is for synthetic data. A real org in a production
    // build still needs the production badge the row already showed.
    vi.stubEnv('MODE', 'production');
    identity.current = { isLoading: false, isError: false, data: { dataMode: 'real' } };

    render(<WorkspaceSection />);

    expect(screen.getByText('production')).toBeTruthy();
    expect(screen.queryByText('Demo')).toBeNull();
  });

  it('does not invent a production badge while the data mode is still loading', () => {
    // WHY: the identity request is what knows demo from real. Until it
    // answers, Vite MODE would flash production on the demo. The row waits.
    vi.stubEnv('MODE', 'production');
    identity.current = { isLoading: true, isError: false, data: undefined };

    render(<WorkspaceSection />);

    expect(screen.queryByText('production')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('does not invent a production badge when the data mode fails to load', () => {
    // WHY: a failed identity request is not evidence of a production org.
    // The row says it could not load instead of filling the gap with the
    // build mode.
    vi.stubEnv('MODE', 'production');
    identity.current = { isLoading: false, isError: true, data: undefined };

    render(<WorkspaceSection />);

    expect(screen.queryByText('production')).toBeNull();
    expect(screen.getByRole('status', { name: 'Could not load' })).toBeTruthy();
  });
});
