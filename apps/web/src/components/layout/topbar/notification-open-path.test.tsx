// The hourly scan stores the overdue demo follow-up
// "Submit revised pricing & SoW v2" (due 15 May 2026, id
// 00000000-0000-4000-8000-000000010001) under a list query that doubles as
// the dedupe marker: /tasks?taskId=<id>&due=<day>. The tasks list reads
// filter, sort, and view. It does not read taskId. Opening that bell row
// marked the alert read and left the assignee on the unfiltered list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { NotificationsBell } from './TopbarNotifications';

const DEMO_TASK_ID = '00000000-0000-4000-8000-000000010001';
const LEGACY_URL = `/tasks?taskId=${DEMO_TASK_ID}&due=2026-11-25`;
const RECORD_URL = `/tasks/${DEMO_TASK_ID}?due=2026-11-25`;

const bell = vi.hoisted(() => ({
  data: undefined as
    | {
        items: Array<{
          id: string;
          type: 'task_due' | 'stage_change';
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
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  useReducedMotion: () => true,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...dom
    }: {
      children?: React.ReactNode;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    } & React.HTMLAttributes<HTMLDivElement>) => <div {...dom}>{children}</div>,
  },
}));

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => bell,
  useNotificationStream: () => undefined,
  useMarkNotificationRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
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
              <Where />
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

afterEach(() => {
  cleanup();
  bell.data = undefined;
  bell.isLoading = false;
  bell.isError = false;
});

describe('notification tray open path', () => {
  it('opens the stored overdue pricing follow-up on its record', () => {
    // WHY: the badge counted this alert. Following it has to land on the
    // follow-up, not the unfiltered task list the dedupe query names.
    bell.data = {
      unread: 1,
      items: [
        {
          id: 'ntf_demo_pricing',
          type: 'task_due',
          title: 'Task overdue: Submit revised pricing & SoW v2',
          body: '"Submit revised pricing & SoW v2" is overdue.',
          entityType: 'task',
          entityId: DEMO_TASK_ID,
          url: LEGACY_URL,
          readAt: null,
          createdAt: '2026-11-25T12:00:00.000Z',
        },
      ],
    };
    renderBell();
    openRow('Task overdue: Submit revised pricing & SoW v2');
    expect(screen.getByTestId('where').textContent).toBe(RECORD_URL);
  });

  it('still opens a stage alert on the opportunity the server named', () => {
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
          createdAt: '2026-05-15T12:00:00.000Z',
        },
      ],
    };
    renderBell();
    openRow('Synthetic bid moved to proposal');
    expect(screen.getByTestId('where').textContent).toBe('/opportunities/opp_demo_1');
  });
});
