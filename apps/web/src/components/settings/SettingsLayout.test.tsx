import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  isAdmin: true,
  canReadAudit: false,
  failed: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => authMocks.isAdmin,
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: (key: string) =>
    !authMocks.failed && key === 'audit-log:read' && authMocks.canReadAudit,
  useCapabilities: () => ({
    isError: authMocks.failed,
    isPending: false,
    isLoading: false,
    data: authMocks.failed ? undefined : {},
  }),
}));

import { SettingsLayout } from './SettingsLayout';

function renderLayout(active: 'overview' | 'top-accounts' | 'modules' = 'overview') {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsLayout active={active}>
        <div>Settings body</div>
      </SettingsLayout>
    </MemoryRouter>,
  );
}

describe('SettingsLayout', () => {
  afterEach(() => {
    cleanup();
    authMocks.isAdmin = true;
    authMocks.canReadAudit = false;
    authMocks.failed = false;
  });

  it('renders settings sections as addressable links', () => {
    renderLayout('top-accounts');

    const link = screen.getByRole('link', { name: 'Top accounts' });
    expect(link.getAttribute('href')).toBe('/settings?tab=top-accounts');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Identity & roles' }).getAttribute('href')).toBe(
      '/settings?tab=identity',
    );
  });

  it('hides admin links from non-admin users', () => {
    authMocks.isAdmin = false;

    renderLayout();

    expect(screen.queryByRole('link', { name: 'Top accounts' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Modules' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Audit log' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Appearance & Language' })).toBeTruthy();
  });

  it('keeps the Modules link when the access check failed', () => {
    // WHY: A failed capability read is not a loaded member visit. Hiding
    // Modules makes the demo settings look like the module switches were removed.
    authMocks.isAdmin = false;
    authMocks.failed = true;

    renderLayout('modules');

    const link = screen.getByRole('link', { name: 'Modules' });
    expect(link.getAttribute('href')).toBe('/settings?tab=modules');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'SERUM Control Plane' })).toBeTruthy();
  });

  it('shows the Audit log tab when the user has audit-log:read', () => {
    authMocks.isAdmin = false;
    authMocks.canReadAudit = true;

    renderLayout();

    expect(screen.getByRole('link', { name: 'Audit log' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Top accounts' })).toBeNull();
  });
});
