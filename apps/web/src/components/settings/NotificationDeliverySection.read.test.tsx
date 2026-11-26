// A paused or in-flight delivery read has no channel settings yet. The section
// rendered nothing, which is how a missing block looks. The channels have not
// arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useNotificationChannels: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/useNotificationChannels', () => ({
  useNotificationChannels: hookMocks.useNotificationChannels,
  useUpdateNotificationChannels: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveTeamsWebhook: () => ({ mutate: vi.fn(), isPending: false }),
  useClearTeamsWebhook: () => ({ mutate: vi.fn(), isPending: false }),
  useTestTeamsWebhook: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { NotificationDeliverySection } from './NotificationDeliverySection';

const CHECKING = 'Checking delivery settings. The channels have not arrived.';
const FAILED = 'Could not load delivery settings.';

interface ChannelSettings {
  groups: {
    account_activity: { in_app: boolean; email: boolean; teams: boolean };
    deals: { in_app: boolean; email: boolean; teams: boolean };
    tasks: { in_app: boolean; email: boolean; teams: boolean };
    mentions: { in_app: boolean; email: boolean; teams: boolean };
  };
  dailyDigest: boolean;
  teamsWebhook: { configured: boolean; host: string | null };
}

function toggles(on = false) {
  return { in_app: on, email: on, teams: on };
}

function settings(overrides: Partial<ChannelSettings> = {}): ChannelSettings {
  return {
    groups: {
      account_activity: toggles(),
      deals: toggles(),
      tasks: toggles(),
      mentions: toggles(),
    },
    dailyDigest: false,
    teamsWebhook: { configured: false, host: null },
    ...overrides,
  };
}

function renderSection(read: { data?: unknown; isError?: boolean; status?: string }) {
  hookMocks.useNotificationChannels.mockReturnValue({
    data: read.data,
    isError: read.isError ?? false,
    isLoading: false,
    status: read.status ?? 'pending',
  });
  render(<NotificationDeliverySection />);
}

describe('NotificationDeliverySection read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused delivery read as a missing block', () => {
    // WHY: a paused first read has isLoading false and no payload. Rendering
    // nothing is how a missing block looks. This one has not arrived.
    renderSection({ data: undefined, isError: false, status: 'pending' });

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Delivery')).toBeNull();
    expect(screen.queryByText('Daily account digest email')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight delivery read as a missing block', () => {
    // WHY: a slow read also has no payload, and isLoading can stay false.
    // A blank section must not stand in for a read that is still running.
    renderSection({ data: undefined, isError: false, status: 'pending' });

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Delivery')).toBeNull();
    expect(screen.queryByText('Daily account digest email')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed delivery read on the error', () => {
    // WHY: a failed read is not an unread pause and not a missing block.
    renderSection({ data: undefined, isError: true, status: 'error' });

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Delivery')).toBeNull();
    expect(screen.queryByText('Daily account digest email')).toBeNull();
  });

  it('lets a failed status win over a stale channel row', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // previous toggles when isError is still false.
    renderSection({
      data: settings({
        groups: {
          account_activity: toggles(),
          deals: toggles(),
          tasks: toggles(),
          mentions: { in_app: true, email: true, teams: false },
        },
        teamsWebhook: { configured: true, host: 'stale.example.test' },
      }),
      isError: false,
      status: 'error',
    });

    expect(screen.queryByText('stale.example.test')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Mentions: Email' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText('Delivery')).toBeNull();
  });

  it('drops a stale channel row when the read is in error', () => {
    // WHY: isError wins even when a previous row is still in data.
    // That row is not the settled delivery settings.
    renderSection({
      data: settings({
        groups: {
          account_activity: toggles(),
          deals: toggles(),
          tasks: toggles(),
          mentions: { in_app: true, email: true, teams: false },
        },
        teamsWebhook: { configured: true, host: 'stale.example.test' },
      }),
      isError: true,
      status: 'error',
    });

    expect(screen.queryByText('stale.example.test')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Mentions: Email' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays blank when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is
    // not a failed load, and it is not still checking.
    renderSection({ data: null, isError: false, status: 'success' });

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Delivery')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('keeps a settled row that is off', () => {
    // WHY: a row of offs has arrived. Unread must not replace that settled
    // row, and the offs must not say the load failed.
    renderSection({ data: settings(), isError: false, status: 'success' });

    const digest = screen.getByRole('checkbox', {
      name: /Daily account digest email/,
    }) as HTMLInputElement;
    const mentionsEmail = screen.getByRole('checkbox', {
      name: 'Mentions: Email',
    }) as HTMLInputElement;
    expect(digest.checked).toBe(false);
    expect(mentionsEmail.checked).toBe(false);
    expect(screen.getByText('Delivery')).toBeTruthy();
    expect(screen.queryByText('Saved webhook on')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows a loaded row, including a blank webhook host', () => {
    // WHY: a loaded row is the settings. Unread must not drop it, and a
    // blank webhook host is still a loaded row.
    renderSection({
      data: settings({
        dailyDigest: true,
        groups: {
          account_activity: toggles(),
          deals: toggles(),
          tasks: toggles(),
          mentions: { in_app: true, email: true, teams: false },
        },
        teamsWebhook: { configured: true, host: '' },
      }),
      isError: false,
      status: 'success',
    });

    const digest = screen.getByRole('checkbox', {
      name: /Daily account digest email/,
    }) as HTMLInputElement;
    const mentionsEmail = screen.getByRole('checkbox', {
      name: 'Mentions: Email',
    }) as HTMLInputElement;
    expect(digest.checked).toBe(true);
    expect(mentionsEmail.checked).toBe(true);
    expect(screen.getByText('Saved webhook on')).toBeTruthy();
    expect(screen.getByText('Saved webhook on').parentElement?.textContent).toContain(
      'Saved webhook on',
    );
    const host = screen.getByText('Saved webhook on').parentElement?.querySelector('span');
    expect(host?.textContent).toBe('');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText('stale.example.test')).toBeNull();
  });
});
