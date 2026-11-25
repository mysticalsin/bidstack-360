// WHY: the badge reads the cached unread count. The tray treated any failed
// refresh as "Could not load notifications" and hid the rows already in hand.
// Under demo, a live "Synthetic bid moved to proposal" alert (opp_demo_1) can
// be on the bell while the follow-up list request fails. The open tray then
// shows an error instead of that alert, so the badge and the tray disagree.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';
import { NotificationsBell } from './TopbarNotifications';

const DEMO_ALERT_ID = '11111111-1111-4111-8111-111111111111';
const DEMO_ALERT_TITLE = 'Synthetic bid moved to proposal';

const notifications = vi.hoisted(() => ({
  data: undefined as
    | {
        unread: number;
        items: Array<{
          id: string;
          type: 'stage_change';
          title: string;
          body: string | null;
          entityType: string | null;
          entityId: string | null;
          url: string | null;
          readAt: string | null;
          createdAt: string;
        }>;
      }
    | undefined,
  isError: false,
  isLoading: false,
}));

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => notifications,
  useMarkNotificationRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
  useNotificationStream: () => undefined,
}));

describe('notification tray after a failed refresh', () => {
  afterEach(() => cleanup());

  it('keeps the live demo alert on the badge and in the tray', () => {
    notifications.data = {
      unread: 1,
      items: [
        {
          id: DEMO_ALERT_ID,
          type: 'stage_change',
          title: DEMO_ALERT_TITLE,
          body: 'Demo record only',
          entityType: 'opportunity',
          entityId: 'opp_demo_1',
          url: '/opportunities/opp_demo_1',
          readAt: null,
          createdAt: '2026-05-15T12:00:00.000Z',
        },
      ],
    };
    notifications.isError = true;
    notifications.isLoading = false;

    const view = render(
      <MemoryRouter>
        <NotificationsBell />
      </MemoryRouter>,
    );
    expect(view.getByTestId('notification-badge').textContent).toBe('1');
    fireEvent.click(view.getByTestId('notification-bell'));
    expect(view.getByTestId('notification-item').textContent).toContain(DEMO_ALERT_TITLE);
    expect(view.queryByText('Could not load notifications')).toBeNull();
  });
});
