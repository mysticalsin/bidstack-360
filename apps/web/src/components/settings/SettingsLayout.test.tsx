import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  isAdmin: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => authMocks.isAdmin,
}));

import { SettingsLayout } from './SettingsLayout';

function renderLayout(active: 'overview' | 'top-accounts' = 'overview') {
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
  });

  it('renders settings sections as addressable links', () => {
    renderLayout('top-accounts');

    const link = screen.getByRole('link', { name: 'Top accounts' });
    expect(link.getAttribute('href')).toBe('/settings?tab=top-accounts');
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('hides admin links from non-admin users', () => {
    authMocks.isAdmin = false;

    renderLayout();

    expect(screen.queryByRole('link', { name: 'Top accounts' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Appearance & Language' })).toBeTruthy();
  });
});
