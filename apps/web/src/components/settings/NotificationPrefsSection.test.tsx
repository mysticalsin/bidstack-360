import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificationChannelSettings, NotificationPrefs } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  mutatePrefs: vi.fn(),
  useNotificationPrefs: vi.fn(),
  useUpdateNotificationPrefs: vi.fn(),
  useNotificationChannels: vi.fn(),
  useUpdateNotificationChannels: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useNotificationPrefs', () => ({
  useNotificationPrefs: hookMocks.useNotificationPrefs,
  useUpdateNotificationPrefs: hookMocks.useUpdateNotificationPrefs,
}));

vi.mock('@/hooks/useNotificationChannels', () => ({
  useNotificationChannels: hookMocks.useNotificationChannels,
  useUpdateNotificationChannels: hookMocks.useUpdateNotificationChannels,
  useSaveTeamsWebhook: () => ({ mutate: vi.fn(), isPending: false }),
  useClearTeamsWebhook: () => ({ mutate: vi.fn(), isPending: false }),
  useTestTeamsWebhook: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { NotificationPrefsSection } from './NotificationPrefsSection';

const STORED_PREFS: NotificationPrefs = {
  emailDigest: true,
  mentionPush: true,
  taskDueSoon: true,
  dealStageChange: false,
};

const CHANNELS: NotificationChannelSettings = {
  groups: {
    account_activity: { in_app: true, email: false, teams: false },
    deals: { in_app: true, email: false, teams: false },
    tasks: { in_app: true, email: false, teams: false },
    mentions: { in_app: true, email: false, teams: false },
  },
  dailyDigest: false,
  teamsWebhook: { configured: false, host: null },
};

function renderPrefs() {
  hookMocks.useNotificationPrefs.mockReturnValue({
    data: STORED_PREFS,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  hookMocks.useUpdateNotificationPrefs.mockReturnValue({
    mutate: hookMocks.mutatePrefs,
    isPending: false,
  });
  hookMocks.useNotificationChannels.mockReturnValue({
    data: CHANNELS,
    isLoading: false,
    isError: false,
  });
  hookMocks.useUpdateNotificationChannels.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  render(<NotificationPrefsSection />);
}

describe('NotificationPrefsSection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not offer a morning pipeline digest that nothing sends', () => {
    // WHY: emailDigest defaults on and the panel calls it "Daily digest email"
    // with a morning pipeline, task, and mention summary. No sender reads that
    // flag. The account digest under Delivery is the mail that can actually go
    // out, and it defaults off. A checked box here tells a demo user a mail
    // is coming.
    renderPrefs();

    expect(
      screen.queryByRole('checkbox', {
        name: /A summary of your pipeline, tasks, and mentions every morning/,
      }),
    ).toBeNull();
    expect(screen.queryByText('Daily digest email')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Mention notifications/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Task reminders/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Deal stage changes/ })).toBeTruthy();
    const accountDigest = screen.getByRole('checkbox', {
      name: /Daily account digest email/,
    }) as HTMLInputElement;
    expect(accountDigest.checked).toBe(false);
  });

  it('keeps the stored digest flag when another alert is switched', () => {
    // WHY: the prefs PUT still requires emailDigest. Dropping the dead control
    // must not drop the stored boolean, or saving a real toggle would 400.
    renderPrefs();

    fireEvent.click(screen.getByRole('checkbox', { name: /Mention notifications/ }));

    expect(hookMocks.mutatePrefs).toHaveBeenCalledWith({
      emailDigest: true,
      mentionPush: false,
      taskDueSoon: true,
      dealStageChange: false,
    });
  });
});
