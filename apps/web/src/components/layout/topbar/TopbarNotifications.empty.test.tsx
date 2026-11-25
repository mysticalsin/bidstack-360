// WHY: A demo inbox has no alerts, and the fixture follow-up
// "Submit revised pricing & SoW v2" is still open and past due.
// The tray's only line was "You're all caught up", which reads as if that
// work were finished. The empty state has to say there are no alerts yet,
// and Escape has to close the tray. Search already closes on Escape. The
// bell did not, so a keyboard user who opened an empty inbox was stuck.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';
import { NotificationsBell } from './TopbarNotifications';

const hook = vi.hoisted(() => ({
  notifications: {
    data: {
      items: [] as Array<{
        id: string;
        type: 'task_due';
        title: string;
        body: string | null;
        entityType: string | null;
        entityId: string | null;
        url: string | null;
        readAt: string | null;
        createdAt: string;
      }>,
      unread: 0,
    },
    isError: false,
    isLoading: false,
  },
}));

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => hook.notifications,
  useMarkNotificationRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
  useNotificationStream: () => undefined,
}));

const EN_CRM = resolve(process.cwd(), 'public/locales/en/crm.json');

const PRICING_TASK = {
  id: '00000000-0000-4000-8000-000000010001',
  type: 'task_due' as const,
  title: 'Task overdue: Submit revised pricing & SoW v2',
  body: '"Submit revised pricing & SoW v2" is overdue.',
  entityType: 'task',
  entityId: '00000000-0000-4000-8000-000000010001',
  url: '/tasks/00000000-0000-4000-8000-000000010001',
  readAt: null,
  createdAt: '2026-11-25T08:00:00.000Z',
};

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationsBell />
    </MemoryRouter>,
  );
}

describe('empty notification tray', () => {
  beforeEach(() => {
    hook.notifications = {
      data: { items: [], unread: 0 },
      isError: false,
      isLoading: false,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('says there are no new notifications, not that the work is caught up', () => {
    const { getByTestId, queryByText } = renderBell();
    fireEvent.click(getByTestId('notification-bell'));
    const status = getByTestId('notification-empty');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain('No new notifications');
    expect(status.textContent).toContain('Updates appear here as they happen.');
    expect(queryByText(/caught up/i)).toBeNull();
  });

  it('closes on Escape and returns focus to the bell', async () => {
    const { getByTestId, queryByTestId } = renderBell();
    const bell = getByTestId('notification-bell');
    fireEvent.click(bell);
    const tray = getByTestId('notification-tray');
    fireEvent.keyDown(tray, { key: 'Escape' });
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(bell);
    await waitFor(() => {
      expect(queryByTestId('notification-tray')).toBeNull();
    });
  });

  it('does not describe a loading tray as empty', () => {
    hook.notifications = {
      data: { items: [], unread: 0 },
      isError: false,
      isLoading: true,
    };
    const { getByTestId, queryByTestId } = renderBell();
    fireEvent.click(getByTestId('notification-bell'));
    expect(queryByTestId('notification-empty')).toBeNull();
    expect(getByTestId('notification-tray').querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('keeps an unread fixture follow-up on the badge and in the tray', () => {
    hook.notifications = {
      data: { items: [PRICING_TASK], unread: 1 },
      isError: false,
      isLoading: false,
    };
    const { getByTestId } = renderBell();
    expect(getByTestId('notification-badge').textContent).toBe('1');
    fireEvent.click(getByTestId('notification-bell'));
    expect(getByTestId('notification-item').textContent).toContain(
      'Task overdue: Submit revised pricing & SoW v2',
    );
  });

  it('ships the English empty copy in the locale file the app loads', () => {
    const en = JSON.parse(readFileSync(EN_CRM, 'utf8')) as {
      topbarNotifications: { emptyTitle?: string; emptyBody?: string; empty?: string };
    };
    expect(en.topbarNotifications.emptyTitle).toBe('No new notifications');
    expect(en.topbarNotifications.emptyBody).toBe('Updates appear here as they happen.');
    expect(en.topbarNotifications.empty ?? '').not.toMatch(/caught up/i);
  });
});
