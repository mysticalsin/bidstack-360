// The tasks list is the overdue book. "Submit revised pricing & SoW v2" is
// Alex Example's follow-up (alex.example@example.test). The row showed the
// title, the date, and the status, and the owner only appeared after opening
// the record. An unassigned follow-up must not grow an owner line.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { Task } from '@bidstack/shared';

import { TaskRow } from './TaskRow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useUpdateTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const PRICING: Task = {
  id: '00000000-0000-4000-8000-000000010001',
  oppId: '00000000-0000-4000-8000-000000020041',
  title: 'Submit revised pricing & SoW v2',
  dueDate: '2026-05-15',
  status: 'in_progress',
  assignee: 'alex.example@example.test',
  createdAt: '2026-05-01T00:00:00.000Z',
};

function renderRow(task: Task) {
  return render(
    <MemoryRouter>
      <div role="list">
        <TaskRow task={task} canWrite />
      </div>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('TaskRow owner', () => {
  it('names the owner of the demo pricing follow-up on the row', () => {
    renderRow(PRICING);

    expect(screen.getByText('Submit revised pricing & SoW v2')).toBeTruthy();
    const owner = screen.getByText('Assigned to alex.example@example.test');
    // Secondary foreground clears the card in both themes. Tertiary is the
    // date line and is the token that goes dim.
    expect(owner.className).toContain('text-[var(--fg-secondary)]');
    expect(owner.className).not.toContain('fg-tertiary');
  });

  it('does not invent an owner when the follow-up is unassigned', () => {
    renderRow({ ...PRICING, id: '00000000-0000-4000-8000-000000010099', assignee: null });

    expect(screen.getByText('Submit revised pricing & SoW v2')).toBeTruthy();
    expect(screen.queryByText(/Assigned to/)).toBeNull();
  });
});
