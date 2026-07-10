import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  isAdmin: false,
}));

const hookMocks = vi.hoisted(() => ({
  useUsers: vi.fn(),
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

vi.mock('@/hooks/useUsers', () => ({ useUsers: hookMocks.useUsers }));
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
    expect(hookMocks.useUsers).toHaveBeenCalledWith({ enabled: false });
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
});
