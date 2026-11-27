// Phone notification tray. Below 768px the top bar and the main column set
// overflow-x: clip. The tray is absolute and 20rem wide, and its right edge
// sits inward of the currency control and the avatar, so the left side of
// every row (including empty, loading, and error copy) is off the screen.
// A fixed inset panel stays inside the viewport. Rows and Mark all read are
// the tap targets, so they keep a 44px floor.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { NotificationsBell } from './TopbarNotifications';

const PHONE_TRAY =
  'max-md:fixed max-md:left-2 max-md:right-2 max-md:top-14 max-md:w-auto';
const PHONE_SCROLL =
  'max-md:max-h-[calc(100dvh-8rem-env(safe-area-inset-bottom,0px))]';

const bell = vi.hoisted(() => ({
  data: undefined as
    | {
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
        unread: number;
      }
    | undefined,
  isLoading: false,
  isError: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  useReducedMotion: () => true,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => {
          const {
            initial: _initial,
            animate: _animate,
            exit: _exit,
            whileHover: _whileHover,
            transition: _transition,
            ...domProps
          } = rest as Record<string, unknown>;
          return <div {...domProps}>{children}</div>;
        },
    },
  ),
}));

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => bell,
  useNotificationStream: () => undefined,
  useMarkNotificationRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationsBell />
    </MemoryRouter>,
  );
}

function openTray() {
  fireEvent.click(screen.getByTestId('notification-bell'));
  return screen.getByTestId('notification-tray');
}

afterEach(() => {
  cleanup();
  bell.data = undefined;
  bell.isLoading = false;
  bell.isError = false;
});

describe('notification tray on a phone', () => {
  it('says the feed failed, inside a panel that fits the phone', () => {
    bell.isError = true;
    renderBell();
    const tray = openTray();

    expect(within(tray).getByText('Could not load notifications')).toBeTruthy();
    expect(tray.className).toContain(PHONE_TRAY);
  });

  it('holds the list while it loads, inside a panel that fits the phone', () => {
    bell.isLoading = true;
    renderBell();
    const tray = openTray();

    expect(within(tray).getByLabelText('Loading…')).toBeTruthy();
    expect(tray.className).toContain(PHONE_TRAY);
  });

  it('says the feed is empty, and the list can scroll inside the phone', () => {
    bell.data = { items: [], unread: 0 };
    renderBell();
    const tray = openTray();

    expect(within(tray).getByText(/all caught up/)).toBeTruthy();
    expect(tray.className).toContain(PHONE_TRAY);
    expect(tray.querySelector('.overflow-y-auto')?.className).toContain(PHONE_SCROLL);
  });

  it('keeps a synthetic alert and Mark all read at a 44px tap target', () => {
    bell.data = {
      unread: 1,
      items: [
        {
          id: 'ntf_demo_stage',
          type: 'stage_change',
          title: 'Synthetic bid moved to proposal',
          body: 'Demo record only',
          entityType: 'opportunity',
          entityId: 'opp_demo_1',
          url: '/opportunities/opp_demo_1',
          readAt: null,
          createdAt: '2026-11-25T12:00:00.000Z',
        },
      ],
    };
    renderBell();
    const tray = openTray();
    const row = within(tray).getByRole('menuitem', { name: 'Synthetic bid moved to proposal' });

    expect(row.className).toContain('min-h-11');
    expect(within(tray).getByRole('button', { name: 'Mark all read' }).className).toContain('min-h-11');
    expect(tray.className).toContain(PHONE_TRAY);
  });
});
