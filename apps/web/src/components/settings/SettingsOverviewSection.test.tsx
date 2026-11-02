import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  isAdmin: false,
}));

const hookMocks = vi.hoisted(() => ({
  useUsersPage: vi.fn(),
  useRoles: vi.fn(),
  useTags: vi.fn(),
  useEmailTemplates: vi.fn(),
  useCustomFieldDefinitions: vi.fn(),
  useLeadRotConfig: vi.fn(),
  usePipelineStages: vi.fn(),
  useApiKeys: vi.fn(),
  useWebhookSubscriptions: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string | number>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => authMocks.isAdmin,
}));

vi.mock('@/hooks/useUsers', () => ({ useUsersPage: hookMocks.useUsersPage }));
vi.mock('@/hooks/useRoles', () => ({ useRoles: hookMocks.useRoles }));
vi.mock('@/hooks/useTags', () => ({ useTags: hookMocks.useTags }));
vi.mock('@/hooks/useEmailTemplates', () => ({
  useEmailTemplates: hookMocks.useEmailTemplates,
}));
vi.mock('@/hooks/useCustomFields', () => ({
  useCustomFieldDefinitions: hookMocks.useCustomFieldDefinitions,
}));
vi.mock('@/hooks/useLeadRot', () => ({ useLeadRotConfig: hookMocks.useLeadRotConfig }));
vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: hookMocks.usePipelineStages,
}));
vi.mock('@/hooks/useApiKeys', () => ({ useApiKeys: hookMocks.useApiKeys }));
vi.mock('@/hooks/useWebhookSubscriptions', () => ({
  useWebhookSubscriptions: hookMocks.useWebhookSubscriptions,
}));

import { SettingsOverviewSection } from './SettingsOverviewSection';
import { USER_OVERVIEW_PAGE } from './user-overview-caption';

function emptyQuery() {
  return { data: undefined, isError: false, isLoading: false };
}

describe('SettingsOverviewSection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    authMocks.isAdmin = false;
  });

  it('does not launch admin-only settings queries for non-admin users', () => {
    Object.values(hookMocks).forEach((mock) => mock.mockReturnValue(emptyQuery()));

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(screen.getByText('Personal settings')).toBeTruthy();
    expect(screen.queryByText('Developer access')).toBeNull();
    expect(hookMocks.useUsersPage).toHaveBeenCalledWith({
      limit: USER_OVERVIEW_PAGE,
      enabled: false,
    });
    expect(hookMocks.useRoles).toHaveBeenCalledWith({ enabled: false });
    expect(hookMocks.useTags).toHaveBeenCalledWith(undefined, { enabled: false });
    expect(hookMocks.useEmailTemplates).toHaveBeenCalledWith({ enabled: false });
    expect(hookMocks.useCustomFieldDefinitions).toHaveBeenCalledWith('company', {
      enabled: false,
    });
    expect(hookMocks.useLeadRotConfig).toHaveBeenCalledWith({ enabled: false });
    expect(hookMocks.usePipelineStages).toHaveBeenCalledWith({ enabled: false });
    expect(hookMocks.useApiKeys).toHaveBeenCalledWith({ enabled: false });
    expect(hookMocks.useWebhookSubscriptions).toHaveBeenCalledWith({ enabled: false });
  });

  it('says the workspace user count is not every user when the roster page continues', () => {
    authMocks.isAdmin = true;
    Object.values(hookMocks).forEach((mock) => mock.mockReturnValue(emptyQuery()));
    hookMocks.useUsersPage.mockReturnValue({
      data: {
        items: Array.from({ length: USER_OVERVIEW_PAGE }, (_, index) => ({ id: String(index) })),
        nextCursor: '00000000-0000-4000-8000-000000000001',
      },
      isError: false,
      isLoading: false,
    });
    hookMocks.useRoles.mockReturnValue({
      data: [{ id: 'role-1' }, { id: 'role-2' }],
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(
      screen.getByText(
        `${USER_OVERVIEW_PAGE} in the latest ${USER_OVERVIEW_PAGE}, not every user / 2 roles`,
      ),
    ).toBeTruthy();
  });

  it('keeps the user count when the roster page is shorter than the probe', () => {
    authMocks.isAdmin = true;
    Object.values(hookMocks).forEach((mock) => mock.mockReturnValue(emptyQuery()));
    hookMocks.useUsersPage.mockReturnValue({
      data: {
        items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        nextCursor: null,
      },
      isError: false,
      isLoading: false,
    });
    hookMocks.useRoles.mockReturnValue({
      data: [{ id: 'role-1' }, { id: 'role-2' }],
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(screen.getByText('3 users / 2 roles')).toBeTruthy();
    expect(screen.queryByText(/not every user/i)).toBeNull();
  });
});
