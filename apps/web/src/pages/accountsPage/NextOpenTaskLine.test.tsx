import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentProps } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NextOpenTaskLine, NEXT_OPEN_TASK_CAPTION, NEXT_OPEN_TASK_PAGE_CAPTION } from './NextOpenTaskLine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

const TASK = {
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Send the redline',
  dueDate: '2026-02-01',
  companyId: '22222222-2222-4222-8222-222222222222',
};

function renderLine(props: Partial<ComponentProps<typeof NextOpenTaskLine>> = {}) {
  return render(
    <MemoryRouter>
      <NextOpenTaskLine status="ready" hasAccounts complete task={TASK} companyName="Acme" {...props} />
    </MemoryRouter>,
  );
}

describe('NextOpenTaskLine', () => {
  afterEach(cleanup);

  it('shows the earliest open task for this view, and says when the read is only a page', () => {
    // WHY: the line is one task for the filtered companies. A page of tasks
    // must not be captioned as every task in the view.
    renderLine();
    const link = screen.getByRole('link', { name: /Send the redline/ });
    expect(link.getAttribute('href')).toBe(`/tasks/${TASK.id}`);
    expect(link.textContent).toBe('Next open task for Acme: Send the redline · due 2026-02-01');
    expect(link.className).toMatch(/focus-visible:ring-2/);
    expect(link.className).not.toMatch(/gradient/);
    expect(screen.getByTestId('next-open-task-caption').textContent).toBe(NEXT_OPEN_TASK_CAPTION);
    expect(NEXT_OPEN_TASK_CAPTION).toMatch(/this view/i);
    expect(NEXT_OPEN_TASK_CAPTION).not.toMatch(/\bpage\b/i);

    cleanup();
    renderLine({ complete: false, task: null, companyName: null });
    expect(screen.getByTestId('next-open-task-caption').textContent).toBe(NEXT_OPEN_TASK_PAGE_CAPTION);
    expect(NEXT_OPEN_TASK_PAGE_CAPTION).toMatch(/latest page/i);
    expect(NEXT_OPEN_TASK_PAGE_CAPTION).toMatch(/not every task/i);
    expect(screen.getByTestId('next-open-task-line').textContent).toMatch(/latest page, not every task/i);

    cleanup();
    renderLine({ task: null });
    expect(screen.getByText('No open task for the accounts in this view.')).toBeTruthy();

    cleanup();
    renderLine({ status: 'error', task: null });
    expect(screen.getByRole('alert').textContent).toMatch(/didn't load/i);
    expect(screen.queryByTestId('next-open-task-caption')).toBeNull();
  });

  it('asks for the filtered view, not the card page', () => {
    const segment = readFileSync(join(process.cwd(), 'src/pages/accountsPage/AccountsAllSegment.tsx'), 'utf8');
    expect(segment).toContain('useNextOpenTask(viewCompanyIds)');
    expect(segment).not.toMatch(/useNextOpenTask\(\s*pagedRows/);
    expect(segment).not.toMatch(/viewCompanyIds\.slice\(\s*0\s*,\s*(30|100|500)\s*\)/);
  });
});
