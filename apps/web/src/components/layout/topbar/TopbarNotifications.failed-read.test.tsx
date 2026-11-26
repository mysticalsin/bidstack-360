// WHY: The bell is the unread count. Until a notification payload arrives,
// and when that read fails, there is no count. The button still used the
// settled zero name ("Notifications") and the tray still said the inbox
// was caught up. A rep can miss a failed or unfinished read and think
// the queue is clear.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const hook = vi.hoisted(() => ({
  useNotifications: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const vars = typeof fallback === 'object' && fallback !== null ? fallback : values;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars?.[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => hook.useNotifications(),
  useMarkNotificationRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
  useNotificationStream: () => undefined,
}));

import { NotificationsBell } from './TopbarNotifications';

const ZERO_BELL = 'Notifications';
const CAUGHT_UP = /caught up/i;

interface QueryShape {
  data?: { items: unknown[]; unread: number };
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
}

function notifications(state: QueryShape) {
  hook.useNotifications.mockReturnValue({
    data: state.data,
    isError: state.isError ?? false,
    isLoading: state.isLoading ?? false,
    isPending: state.isPending ?? state.data === undefined,
    error: state.isError ? new Error('notifications down') : null,
  });
}

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationsBell />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('notification bell failed-read honesty', () => {
  it('does not call a failed notification read zero unread or caught up', () => {
    // WHY: a failed read has no unread count. The closed bell used the same
    // name as a settled empty inbox, so the failure looked like zero.
    notifications({ isError: true, isLoading: false, isPending: false });
    const view = renderBell();
    const bell = view.getByTestId('notification-bell');

    expect(bell.getAttribute('aria-label')).toBe('Notifications, could not load');
    expect(bell.getAttribute('aria-label')).not.toBe(ZERO_BELL);
    expect(view.queryByTestId('notification-badge')).toBeNull();

    fireEvent.click(bell);
    expect(view.queryByText(CAUGHT_UP)).toBeNull();
    expect(view.getByText('Could not load notifications')).toBeTruthy();
    expect(view.queryByText('Mark all read')).toBeNull();
  });

  it('does not call an unread notification payload zero unread or caught up', () => {
    // WHY: the payload has not arrived. isLoading is false while the query
    // is still pending, and the tray said the work was caught up.
    notifications({ isError: false, isLoading: false, isPending: true });
    const view = renderBell();
    const bell = view.getByTestId('notification-bell');

    expect(bell.getAttribute('aria-label')).toBe('Notifications, still loading');
    expect(bell.getAttribute('aria-busy')).toBe('true');
    expect(bell.getAttribute('aria-label')).not.toBe(ZERO_BELL);
    expect(view.queryByTestId('notification-badge')).toBeNull();

    fireEvent.click(bell);
    expect(view.queryByText(CAUGHT_UP)).toBeNull();
    expect(view.getByLabelText('Loading…')).toBeTruthy();
    expect(view.queryByText('Could not load notifications')).toBeNull();
    expect(view.queryByText('Mark all read')).toBeNull();
  });

  it('keeps a settled empty inbox on the zero bell', () => {
    // WHY: a finished read with no alerts is still the settled zero state.
    // That copy stays. This slice only covers a read that has not landed.
    notifications({
      data: { items: [], unread: 0 },
      isError: false,
      isLoading: false,
      isPending: false,
    });
    const view = renderBell();
    const bell = view.getByTestId('notification-bell');

    expect(bell.getAttribute('aria-label')).toBe(ZERO_BELL);
    expect(bell.getAttribute('aria-busy')).toBeNull();
    expect(view.queryByTestId('notification-badge')).toBeNull();

    fireEvent.click(bell);
    expect(view.getByText(CAUGHT_UP)).toBeTruthy();
    expect(view.queryByText('Could not load notifications')).toBeNull();
  });

  it('keeps a settled unread count on the badge', () => {
    // WHY: once the payload arrives, the badge is the real unread count.
    notifications({
      data: {
        unread: 2,
        items: [
          {
            id: 'n-1',
            type: 'system',
            title: 'Demo alert landed',
            body: null,
            entityType: null,
            entityId: null,
            url: null,
            readAt: null,
            createdAt: '2026-11-25T08:00:00.000Z',
          },
        ],
      },
      isError: false,
      isLoading: false,
      isPending: false,
    });
    const view = renderBell();
    const bell = view.getByTestId('notification-bell');

    expect(view.getByTestId('notification-badge').textContent).toBe('2');
    expect(bell.getAttribute('aria-label')).toBe('Notifications, 2 unread');
    expect(bell.getAttribute('aria-busy')).toBeNull();

    fireEvent.click(bell);
    expect(view.getByText('Demo alert landed')).toBeTruthy();
    expect(view.queryByText(CAUGHT_UP)).toBeNull();
  });
});
