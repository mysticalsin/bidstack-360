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

import { CUSTOM_FIELD_LIST_PAGE } from './custom-field-list-caption';
import { ROLE_LIST_PAGE } from './role-list-caption';
import { SettingsOverviewSection } from './SettingsOverviewSection';
import { STAGE_LIST_PAGE } from './stage-list-caption';
import { USER_OVERVIEW_PAGE } from './user-overview-caption';
import { WEBHOOK_LIST_PAGE } from './webhook-list-caption';

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
      data: { items: [{ id: 'role-1' }, { id: 'role-2' }], pageContinues: false },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(
      screen.getByText(
        `${USER_OVERVIEW_PAGE} in the latest ${USER_OVERVIEW_PAGE}, not every user / 2 roles`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/not every role/i)).toBeNull();
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
      data: { items: [{ id: 'role-1' }, { id: 'role-2' }], pageContinues: false },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(screen.getByText('3 users / 2 roles')).toBeTruthy();
    expect(screen.queryByText(/not every user/i)).toBeNull();
    expect(screen.queryByText(/not every role/i)).toBeNull();
  });

  it('says the role count is not every role when the role page continues', () => {
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
      data: {
        items: Array.from({ length: ROLE_LIST_PAGE }, (_, index) => ({ id: String(index) })),
        pageContinues: true,
      },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(
      screen.getByText(
        `3 users / ${ROLE_LIST_PAGE} in the latest ${ROLE_LIST_PAGE}, not every role`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(new RegExp(`${ROLE_LIST_PAGE} roles`))).toBeNull();
  });

  it('says neither count is the whole set when both pages continue', () => {
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
      data: {
        items: Array.from({ length: ROLE_LIST_PAGE }, (_, index) => ({ id: String(index) })),
        pageContinues: true,
      },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(
      screen.getByText(
        `${USER_OVERVIEW_PAGE} in the latest ${USER_OVERVIEW_PAGE}, not every user / ${ROLE_LIST_PAGE} in the latest ${ROLE_LIST_PAGE}, not every role`,
      ),
    ).toBeTruthy();
  });

  it('says the stage count is not every stage when the stage page continues', () => {
    authMocks.isAdmin = true;
    Object.values(hookMocks).forEach((mock) => mock.mockReturnValue(emptyQuery()));
    hookMocks.usePipelineStages.mockReturnValue({
      data: {
        items: Array.from({ length: STAGE_LIST_PAGE }, (_, index) => ({ id: String(index) })),
        pageContinues: true,
      },
      isError: false,
      isLoading: false,
    });
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: { items: [{ id: 'field-1' }, { id: 'field-2' }] },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(
      screen.getByText(
        `${STAGE_LIST_PAGE} in the latest ${STAGE_LIST_PAGE}, not every stage / 2 company fields`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(new RegExp(`${STAGE_LIST_PAGE} stages`))).toBeNull();
  });

  it('keeps the stage count when the stage page is shorter than the probe', () => {
    authMocks.isAdmin = true;
    Object.values(hookMocks).forEach((mock) => mock.mockReturnValue(emptyQuery()));
    hookMocks.usePipelineStages.mockReturnValue({
      data: {
        items: Array.from({ length: 7 }, (_, index) => ({ id: String(index) })),
        pageContinues: false,
      },
      isError: false,
      isLoading: false,
    });
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: { items: [{ id: 'field-1' }, { id: 'field-2' }] },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(screen.getByText('7 stages / 2 company fields')).toBeTruthy();
    expect(screen.queryByText(/not every stage/i)).toBeNull();
  });

  it('says the field count is not every field when the field page continues', () => {
    authMocks.isAdmin = true;
    Object.values(hookMocks).forEach((mock) => mock.mockReturnValue(emptyQuery()));
    hookMocks.usePipelineStages.mockReturnValue({
      data: {
        items: Array.from({ length: 7 }, (_, index) => ({ id: String(index) })),
        pageContinues: false,
      },
      isError: false,
      isLoading: false,
    });
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: {
        items: Array.from({ length: CUSTOM_FIELD_LIST_PAGE }, (_, index) => ({
          id: String(index),
        })),
        pageContinues: true,
      },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(
      screen.getByText(
        `7 stages / ${CUSTOM_FIELD_LIST_PAGE} in the latest ${CUSTOM_FIELD_LIST_PAGE}, not every field`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(new RegExp(`${CUSTOM_FIELD_LIST_PAGE} company fields`))).toBeNull();
  });

  it('keeps the field count when the field page is shorter than the probe', () => {
    authMocks.isAdmin = true;
    Object.values(hookMocks).forEach((mock) => mock.mockReturnValue(emptyQuery()));
    hookMocks.usePipelineStages.mockReturnValue({
      data: {
        items: Array.from({ length: 7 }, (_, index) => ({ id: String(index) })),
        pageContinues: false,
      },
      isError: false,
      isLoading: false,
    });
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: { items: [{ id: 'field-1' }, { id: 'field-2' }], pageContinues: false },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(screen.getByText('7 stages / 2 company fields')).toBeTruthy();
    expect(screen.queryByText(/not every field/i)).toBeNull();
  });

  it('says neither count is the whole set when stage and field pages continue', () => {
    authMocks.isAdmin = true;
    Object.values(hookMocks).forEach((mock) => mock.mockReturnValue(emptyQuery()));
    hookMocks.usePipelineStages.mockReturnValue({
      data: {
        items: Array.from({ length: STAGE_LIST_PAGE }, (_, index) => ({ id: String(index) })),
        pageContinues: true,
      },
      isError: false,
      isLoading: false,
    });
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: {
        items: Array.from({ length: CUSTOM_FIELD_LIST_PAGE }, (_, index) => ({
          id: String(index),
        })),
        pageContinues: true,
      },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(
      screen.getByText(
        `${STAGE_LIST_PAGE} in the latest ${STAGE_LIST_PAGE}, not every stage / ${CUSTOM_FIELD_LIST_PAGE} in the latest ${CUSTOM_FIELD_LIST_PAGE}, not every field`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/company fields/i)).toBeNull();
  });

  it('says the webhook count is not every webhook when the webhook page continues', () => {
    authMocks.isAdmin = true;
    Object.values(hookMocks).forEach((mock) => mock.mockReturnValue(emptyQuery()));
    hookMocks.useWebhookSubscriptions.mockReturnValue({
      data: {
        items: Array.from({ length: WEBHOOK_LIST_PAGE }, (_, index) => ({
          id: String(index),
          active: true,
          failureCount: 0,
        })),
        pageContinues: true,
      },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(
      screen.getByText(
        `${WEBHOOK_LIST_PAGE} active / 0 failing. ${WEBHOOK_LIST_PAGE} in the latest ${WEBHOOK_LIST_PAGE}, not every webhook`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(`${WEBHOOK_LIST_PAGE} active / 0 failing`)).toBeNull();
  });

  it('keeps the webhook counts when the webhook page is shorter than the probe', () => {
    authMocks.isAdmin = true;
    Object.values(hookMocks).forEach((mock) => mock.mockReturnValue(emptyQuery()));
    hookMocks.useWebhookSubscriptions.mockReturnValue({
      data: {
        items: [
          { id: 'wh-1', active: true, failureCount: 0 },
          { id: 'wh-2', active: false, failureCount: 2 },
        ],
        pageContinues: false,
      },
      isError: false,
      isLoading: false,
    });

    render(<SettingsOverviewSection onNavigate={vi.fn()} />);

    expect(screen.getByText('1 active / 1 failing')).toBeTruthy();
    expect(screen.queryByText(/not every webhook/i)).toBeNull();
  });
});
