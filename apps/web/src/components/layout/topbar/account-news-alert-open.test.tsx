// A stored account-news alert uses `/dashboard?account=<id>#watchdog`.
// The home dashboard does not read `account`, so the row opens the portfolio.
// The account page is `/accounts/<id>` and the feed is `#watchdog`.
// The fixture account is c0000000-0000-4000-8000-000000000001.
// A deal URL and a stored task-list marker stay as sent. Those opens are not this fix.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { NotificationsBell } from './TopbarNotifications';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

const useNotifications = vi.fn();
const markRead = vi.fn();

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => useNotifications(),
  useNotificationStream: () => undefined,
  useMarkNotificationRead: () => ({ mutate: markRead, isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));

const FIXTURE_ACCOUNT = 'c0000000-0000-4000-8000-000000000001';
const NEWS_URL = `/dashboard?account=${FIXTURE_ACCOUNT}#watchdog`;
const ACCOUNT_URL = `/accounts/${FIXTURE_ACCOUNT}#watchdog`;
const DEAL_URL = '/opportunities/00000000-0000-4000-8000-000000020041';
const TASK_LIST_URL = '/tasks?taskId=00000000-0000-4000-8000-000000010001&due=2026-11-25';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}${loc.hash}`}</div>;
}

function page(url: string, title: string) {
  useNotifications.mockReturnValue({
    data: {
      unread: 1,
      items: [
        {
          id: '00000000-0000-4000-8000-0000000a0001',
          type: 'system',
          title,
          body: 'Sample signal on the fixture account.',
          entityType: 'company',
          entityId: FIXTURE_ACCOUNT,
          url,
          readAt: null,
          createdAt: '2026-11-25T12:00:00.000Z',
        },
      ],
    },
    isError: false,
    isLoading: false,
  });
}

function renderBell() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <NotificationsBell />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function openRow(title: string) {
  fireEvent.click(screen.getByTestId('notification-bell'));
  fireEvent.click(screen.getByRole('menuitem', { name: title }));
}

describe('account news alert open path', () => {
  beforeEach(() => {
    useNotifications.mockReset();
    markRead.mockReset();
  });

  afterEach(() => cleanup());

  it('opens the fixture account watchdog, not the home dashboard', () => {
    const title = 'Update at fixture account: sample funding';
    page(NEWS_URL, title);
    renderBell();
    openRow(title);
    expect(screen.getByTestId('location').textContent).toBe(ACCOUNT_URL);
    expect(markRead).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000a0001');
  });

  it('leaves a deal URL and a stored task-list marker as sent', () => {
    const deal = 'Synthetic bid moved to proposal';
    page(DEAL_URL, deal);
    const first = renderBell();
    openRow(deal);
    expect(screen.getByTestId('location').textContent).toBe(DEAL_URL);
    first.unmount();

    const task = 'Task overdue: Submit revised pricing & SoW v2';
    page(TASK_LIST_URL, task);
    renderBell();
    openRow(task);
    expect(screen.getByTestId('location').textContent).toBe(TASK_LIST_URL);
  });
});
