// A paused or in-flight settings read has no governance payload yet. The
// overview painted Live and Ready, which is how a settled security book looks.
// The users, roles, and API keys have not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  isAdmin: true,
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

const CHECKING_GOVERNANCE = 'Checking workspace governance. It has not arrived.';
const FAILED_GOVERNANCE = 'Could not load workspace governance. It has not arrived.';
const CHECKING_KEYS = 'Checking API keys. They have not arrived.';
const FAILED_KEYS = 'Could not load API keys. They have not arrived.';

interface CountRead {
  data?: { items: unknown[]; nextCursor?: string | null; pageContinues?: boolean } | null;
  isError?: boolean;
  status?: string;
}

function idleRead(): CountRead {
  return { data: { items: [], pageContinues: false }, isError: false, status: 'success' };
}

function cardText(title: string): string {
  const heading = screen.getByRole('heading', { name: title });
  const card = heading.closest('div.rounded-xl');
  if (!card) throw new Error(`missing card for ${title}`);
  return card.textContent ?? '';
}

function readinessText(label: string): string {
  const node = screen.getByText(label);
  return node.parentElement?.textContent ?? '';
}

function renderOverview(reads: { users?: CountRead; roles?: CountRead; apiKeys?: CountRead }) {
  hookMocks.useUsersPage.mockReturnValue({ isLoading: false, ...idleRead(), ...reads.users });
  hookMocks.useRoles.mockReturnValue({ isLoading: false, ...idleRead(), ...reads.roles });
  hookMocks.useApiKeys.mockReturnValue({ isLoading: false, ...idleRead(), ...reads.apiKeys });
  for (const mock of [
    hookMocks.useTags,
    hookMocks.useEmailTemplates,
    hookMocks.useCustomFieldDefinitions,
    hookMocks.useLeadRotConfig,
    hookMocks.usePipelineStages,
    hookMocks.useWebhookSubscriptions,
  ]) {
    mock.mockReturnValue({ data: undefined, isError: false, isLoading: false, status: 'success' });
  }
  render(<SettingsOverviewSection onNavigate={vi.fn()} />);
}

describe('SettingsOverviewSection security read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    authMocks.isAdmin = true;
  });

  it('does not treat a paused governance read as a live ready workspace', () => {
    // WHY: a paused first read has no users and no roles. Live and Ready are
    // a settled security book. This one has not arrived.
    renderOverview({
      users: { data: undefined, isError: false, status: 'pending' },
      roles: { data: undefined, isError: false, status: 'pending' },
    });

    const governance = cardText('Workspace governance');
    expect(governance).toContain(CHECKING_GOVERNANCE);
    expect(governance).not.toContain('Live');
    expect(governance).not.toMatch(/\d+ users/);
    expect(screen.queryByText(FAILED_GOVERNANCE)).toBeNull();
    const workspace = readinessText('Workspace controls');
    expect(workspace).toContain('Checking');
    expect(workspace).not.toContain('Ready');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight governance read as a live ready workspace', () => {
    // WHY: a slow read also has no payload, and isLoading can stay false.
    // Live and Ready must not stand in for a read that is still running.
    renderOverview({
      users: { data: undefined, isError: false, status: 'pending' },
      roles: { data: undefined, isError: false, status: 'pending' },
    });

    const governance = cardText('Workspace governance');
    expect(governance).toContain(CHECKING_GOVERNANCE);
    expect(governance).not.toContain('Live');
    expect(governance).not.toMatch(/\d+ users/);
    const workspace = readinessText('Workspace controls');
    expect(workspace).toContain('Checking');
    expect(workspace).not.toContain('Ready');
    expect(screen.queryByText(FAILED_GOVERNANCE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat a paused API key read as live ready access', () => {
    // WHY: API and MCP access is a security control. A paused key list is
    // not an empty keyring and it is not Ready.
    renderOverview({
      apiKeys: { data: undefined, isError: false, status: 'pending' },
    });

    const keys = cardText('Developer access');
    expect(keys).toContain(CHECKING_KEYS);
    expect(keys).not.toContain('Live');
    expect(keys).not.toMatch(/\d+ API keys/);
    const access = readinessText('API and MCP access');
    expect(access).toContain('Checking');
    expect(access).not.toContain('Ready');
    expect(screen.queryByText(FAILED_KEYS)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed governance read on the error', () => {
    // WHY: a failed read is not an unread pause and not a live workspace.
    renderOverview({
      users: { data: undefined, isError: true, status: 'error' },
      roles: { data: undefined, isError: true, status: 'error' },
    });

    const governance = cardText('Workspace governance');
    expect(governance).toContain(FAILED_GOVERNANCE);
    expect(governance).not.toContain('Live');
    expect(governance).not.toContain(CHECKING_GOVERNANCE);
    expect(governance).not.toMatch(/\d+ users/);
    const workspace = readinessText('Workspace controls');
    expect(workspace).toContain('Not loaded');
    expect(workspace).not.toContain('Ready');
  });

  it('lets a failed status win over a stale governance count', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // previous user count when isError is still false.
    renderOverview({
      users: {
        data: { items: Array.from({ length: 17 }, (_item, index) => ({ id: `user-${index}` })) },
        isError: false,
        status: 'error',
      },
      roles: idleRead(),
    });

    const governance = cardText('Workspace governance');
    expect(governance).not.toContain('17');
    expect(governance).toContain(FAILED_GOVERNANCE);
    expect(governance).not.toContain('Live');
    expect(governance).not.toContain(CHECKING_GOVERNANCE);
    expect(readinessText('Workspace controls')).toContain('Not loaded');
  });

  it('lets a failed API key status win over a stale key count', () => {
    // WHY: a stale key count must not stay Live when the read is in error
    // and isError is still false.
    renderOverview({
      apiKeys: {
        data: { items: Array.from({ length: 9 }, (_item, index) => ({ id: `key-${index}` })) },
        isError: false,
        status: 'error',
      },
    });

    const keys = cardText('Developer access');
    expect(keys).not.toContain('9');
    expect(keys).toContain(FAILED_KEYS);
    expect(keys).not.toContain('Live');
    expect(readinessText('API and MCP access')).toContain('Not loaded');
  });

  it('stays on the empty book when a settled governance payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is
    // not a failed load, and it is not still checking.
    renderOverview({
      users: { data: null, isError: false, status: 'success' },
      roles: { data: null, isError: false, status: 'success' },
    });

    const governance = cardText('Workspace governance');
    expect(governance).toContain('0 users / 0 roles');
    expect(governance).toContain('Live');
    expect(governance).not.toContain(CHECKING_GOVERNANCE);
    expect(governance).not.toContain(FAILED_GOVERNANCE);
    expect(readinessText('Workspace controls')).toContain('Ready');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled API key list has no keys', () => {
    // WHY: a zero keyring has arrived. Unread must not replace that settled
    // miss, and the miss must not say the load failed.
    renderOverview({
      apiKeys: { data: { items: [], pageContinues: false }, isError: false, status: 'success' },
    });

    const keys = cardText('Developer access');
    expect(keys).toContain('0 API keys');
    expect(keys).toContain('Live');
    expect(keys).not.toContain(CHECKING_KEYS);
    expect(keys).not.toContain(FAILED_KEYS);
    expect(readinessText('API and MCP access')).toContain('Ready');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows a loaded governance book and a loaded key count', () => {
    // WHY: a loaded book is the security picture. Unread must not drop it.
    renderOverview({
      users: {
        data: { items: Array.from({ length: 4 }, (_item, index) => ({ id: `user-${index}` })) },
        isError: false,
        status: 'success',
      },
      roles: {
        data: { items: Array.from({ length: 2 }, (_item, index) => ({ id: `role-${index}` })), pageContinues: false },
        isError: false,
        status: 'success',
      },
      apiKeys: {
        data: { items: Array.from({ length: 3 }, (_item, index) => ({ id: `key-${index}` })), pageContinues: false },
        isError: false,
        status: 'success',
      },
    });

    expect(cardText('Workspace governance')).toContain('4 users / 2 roles');
    expect(cardText('Workspace governance')).toContain('Live');
    expect(cardText('Developer access')).toContain('3 API keys');
    expect(cardText('Developer access')).toContain('Live');
    expect(readinessText('Workspace controls')).toContain('Ready');
    expect(readinessText('API and MCP access')).toContain('Ready');
    expect(screen.queryByText(CHECKING_GOVERNANCE)).toBeNull();
    expect(screen.queryByText(FAILED_GOVERNANCE)).toBeNull();
    expect(screen.queryByText(CHECKING_KEYS)).toBeNull();
    expect(screen.queryByText(FAILED_KEYS)).toBeNull();
  });
});
