// The calendar chip used to open /tasks?search=<title>. The tasks page only
// reads filter, sort, and view, so that click dropped the follow-up and
// showed the whole list. The chip has to open the follow-up's own record.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { Task } from '@bidstack/shared';

import { TaskCalendar } from './TaskCalendar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const DEMO_TASK: Task = {
  id: '00000000-0000-4000-8000-000000010001',
  oppId: '00000000-0000-4000-8000-000000020001',
  title: 'Submit revised pricing & SoW v2',
  dueDate: '2026-05-15',
  status: 'in_progress',
  assignee: 'alex.example@example.test',
  createdAt: '2026-05-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TaskCalendar follow-up link', () => {
  it('opens the follow-up record instead of a search the list ignores', () => {
    render(
      <MemoryRouter>
        <TaskCalendar tasks={[DEMO_TASK]} />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: DEMO_TASK.title });
    expect(link.getAttribute('href')).toBe(`/tasks/${DEMO_TASK.id}`);
    expect(link.getAttribute('href')).not.toContain('search=');
    expect(link.className).toContain('focus-visible:ring-2');
  });
});
