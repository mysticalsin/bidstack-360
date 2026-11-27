import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  prefsRefetch: vi.fn(),
  channelsRefetch: vi.fn(),
  mutatePrefs: vi.fn(),
  mutateChannels: vi.fn(),
  useNotificationPrefs: vi.fn(),
  useUpdateNotificationPrefs: vi.fn(),
  useNotificationChannels: vi.fn(),
  useUpdateNotificationChannels: vi.fn(),
  useSaveTeamsWebhook: vi.fn(),
  useClearTeamsWebhook: vi.fn(),
  useTestTeamsWebhook: vi.fn(),
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
  useSaveTeamsWebhook: hookMocks.useSaveTeamsWebhook,
  useClearTeamsWebhook: hookMocks.useClearTeamsWebhook,
  useTestTeamsWebhook: hookMocks.useTestTeamsWebhook,
}));

import { NotificationPrefsSection } from './NotificationPrefsSection';

const STORED_PREFS = {
  emailDigest: true,
  mentionPush: true,
  taskDueSoon: true,
  dealStageChange: false,
};

const DELIVERY = {
  groups: {
    account_activity: { in_app: true, email: false, teams: false },
    deals: { in_app: true, email: false, teams: false },
    tasks: { in_app: true, email: false, teams: false },
    mentions: { in_app: true, email: false, teams: false },
  },
  dailyDigest: false,
  teamsWebhook: { configured: false, host: null },
};

function prefsQuery(overrides: Record<string, unknown>) {
  hookMocks.useNotificationPrefs.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: hookMocks.prefsRefetch,
    ...overrides,
  });
}

function channelsQuery(overrides: Record<string, unknown>) {
  hookMocks.useNotificationChannels.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: hookMocks.channelsRefetch,
    ...overrides,
  });
}

describe('notification preference states', () => {
  beforeEach(() => {
    hookMocks.useUpdateNotificationPrefs.mockReturnValue({
      mutate: hookMocks.mutatePrefs,
      isPending: false,
    });
    hookMocks.useUpdateNotificationChannels.mockReturnValue({
      mutate: hookMocks.mutateChannels,
      isPending: false,
    });
    hookMocks.useSaveTeamsWebhook.mockReturnValue({ mutate: vi.fn(), isPending: false });
    hookMocks.useClearTeamsWebhook.mockReturnValue({ mutate: vi.fn(), isPending: false });
    hookMocks.useTestTeamsWebhook.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('saves a mention opt-out and keeps the stored digest flag', () => {
    // WHY: mention, task, and deal switches gate real alerts. Turning one off
    // must still send the stored morning-digest flag, which this screen no
    // longer edits.
    prefsQuery({ data: STORED_PREFS });
    channelsQuery({ data: DELIVERY });

    render(<NotificationPrefsSection />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Mention notifications/ }));

    expect(hookMocks.mutatePrefs).toHaveBeenCalledWith({
      ...STORED_PREFS,
      mentionPush: false,
    });
  });

  it('names a loading preferences panel', () => {
    // WHY: the loading skeleton has no accessible name, so the page reads as
    // blank while demo preferences are still arriving.
    prefsQuery({ isLoading: true });
    channelsQuery({ data: DELIVERY });

    render(<NotificationPrefsSection />);

    expect(screen.getByLabelText('Loading notification preferences')).toBeTruthy();
  });

  it('says preferences are not loaded when the query settles with no payload', () => {
    // WHY: a successful query with no payload rendered nothing inside the
    // card. On demo that looks like an empty settings page.
    prefsQuery({ data: undefined, isLoading: false, isError: false });
    channelsQuery({ data: DELIVERY });

    render(<NotificationPrefsSection />);

    expect(screen.getByText('Notification preferences are not loaded')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Mention notifications/ })).toBeNull();
  });

  it('says delivery settings failed instead of leaving that block blank', () => {
    // WHY: a failed channel load returned null. The four switches stayed and
    // the delivery grid vanished, with no error and no retry.
    prefsQuery({ data: STORED_PREFS });
    channelsQuery({ isError: true, data: undefined });

    render(<NotificationPrefsSection />);

    expect(screen.getByText("Couldn't load delivery settings")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('says delivery settings are not loaded when the query settles with no payload', () => {
    // WHY: missing channel data used the same blank return as an error. A
    // settled empty payload is not a loaded grid.
    prefsQuery({ data: STORED_PREFS });
    channelsQuery({ isLoading: false, isError: false, data: undefined });

    render(<NotificationPrefsSection />);

    expect(screen.getByText('Delivery settings are not loaded')).toBeTruthy();
  });

  it('does not offer a morning digest switch that nothing sends', () => {
    // WHY: demo defaults check Daily digest email. Nothing reads that flag,
    // so the switch looks on and no morning mail goes out. The row stays and
    // says the digest is not sent. Mention alerts stay a real switch.
    prefsQuery({ data: STORED_PREFS });
    channelsQuery({ data: DELIVERY });

    render(<NotificationPrefsSection />);

    expect(screen.queryByRole('checkbox', { name: /Daily digest email/ })).toBeNull();
    expect(screen.getByText(/Not sent/)).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: /Mention notifications/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByRole('checkbox', { name: /Daily account digest email/ })).toBeTruthy();
  });
});
