import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/components/settings/SettingsLayout', () => ({
  SettingsLayout: ({ active, children }: { active: string; children: ReactNode }) => (
    <section data-testid="settings-layout" data-active={active}>
      <div data-testid="active-tab">{active}</div>
      {children}
    </section>
  ),
}));

vi.mock('@/components/settings/SettingsOverviewSection', () => ({
  SettingsOverviewSection: () => <div>Overview panel</div>,
}));
vi.mock('@/components/settings/ProfileSection', () => ({
  ProfileSection: () => <div>Profile panel</div>,
}));
vi.mock('@/components/settings/AppearanceSection', () => ({
  AppearanceSection: () => <div>Appearance panel</div>,
}));
vi.mock('@/components/settings/NotificationPrefsSection', () => ({
  NotificationPrefsSection: () => <div>Notifications panel</div>,
}));
vi.mock('@/components/settings/SecuritySection', () => ({
  SecuritySection: () => <div>Security panel</div>,
}));
vi.mock('@/components/settings/WorkspaceSection', () => ({
  WorkspaceSection: () => <div>Workspace panel</div>,
}));
vi.mock('@/components/settings/CrmConfigurationSection', () => ({
  CrmConfigurationSection: () => <div>Data configuration panel</div>,
}));
vi.mock('@/components/settings/DataImportSection', () => ({
  DataImportSection: () => <div>Data import panel</div>,
}));
vi.mock('@/components/settings/TopAccountsSection', () => ({
  TopAccountsSection: () => <div>Top accounts panel</div>,
}));
vi.mock('@/components/settings/DeveloperAccessSection', () => ({
  DeveloperAccessSection: () => <div>Developer access panel</div>,
}));
vi.mock('@/components/settings/LanguageSwitcher', () => ({
  LanguageSwitcher: () => <div>Language panel</div>,
}));
vi.mock('@/components/settings/IntegrationsSection', () => ({
  IntegrationsSection: () => <div>Integrations panel</div>,
}));
vi.mock('@/components/settings/WebhooksSection', () => ({
  WebhooksSection: () => <div>Webhooks panel</div>,
}));
vi.mock('@/components/settings/AuditLogSection', () => ({
  AuditLogSection: () => <div>Audit log panel</div>,
}));
vi.mock('@/components/settings/RfpAnalyticsSection', () => ({
  RfpAnalyticsSection: () => <div>RFP analytics panel</div>,
}));
vi.mock('@/components/settings/AccessGroupsSection', () => ({
  AccessGroupsSection: () => <div>Access groups panel</div>,
}));
vi.mock('@/components/settings/OpportunityFiltersSection', () => ({
  OpportunityFiltersSection: () => <div>Opportunity filters panel</div>,
}));
vi.mock('@/components/settings/SerumControlPlaneSection', () => ({
  SerumControlPlaneSection: () => <div>SERUM panel</div>,
}));
vi.mock('@/components/settings/ModulesSection', () => ({
  ModulesSection: () => <div>Modules panel</div>,
}));

import { SettingsPage } from './SettingsPage';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsPage routing guard', () => {
  beforeEach(() => {
    authMocks.isAdmin = true;
  });

  afterEach(() => cleanup());

  it('falls back to overview for unknown tabs instead of indexing missing sections', async () => {
    renderPage('/settings?tab=does-not-exist');

    expect(screen.getByTestId('active-tab').textContent).toBe('overview');
    expect(screen.getByText('Overview panel')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/settings?tab=overview'),
    );
  });

  it('does not render admin-only settings from a non-admin deep link', async () => {
    authMocks.isAdmin = false;

    renderPage('/settings?tab=groups');

    expect(screen.getByTestId('active-tab').textContent).toBe('overview');
    expect(screen.getByText('Overview panel')).toBeTruthy();
    expect(screen.queryByText('Access groups panel')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/settings?tab=overview'),
    );
  });

  it('keeps admin-only deep links available for admins', () => {
    renderPage('/settings?tab=groups');

    expect(screen.getByTestId('active-tab').textContent).toBe('groups');
    expect(screen.getByText('Access groups panel')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/settings?tab=groups');
  });
});
