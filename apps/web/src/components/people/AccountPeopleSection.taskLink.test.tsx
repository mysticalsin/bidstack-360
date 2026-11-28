// People tab on a company and on a deal. Demo follow-ups such as
// "Submit revised pricing & SoW v2" are stored with a task id, but the title
// is plain text. Opening that follow-up means leaving the account and
// searching Tasks, which can match a different row.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { AccountWork } from '@bidstack/shared';

import { AccountPeopleSection } from './AccountPeopleSection';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const PRICING = '00000000-0000-4000-8000-000000010001';

const work = vi.hoisted(() => ({
  current: {
    data: undefined as AccountWork | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => ({
    data: { companyId: COMPANY, opportunityId: null, people: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAccountWork: () => work.current,
  useCreateCommitment: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useCreatePersonFact: () => ({ mutate: vi.fn(), isPending: false }),
  useDecidePersonFact: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderPeople() {
  render(
    <MemoryRouter>
      <AccountPeopleSection companyId={COMPANY} deals={[]} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  work.current.data = undefined;
});

describe('people follow-up titles', () => {
  it('opens the follow-up record from the task title', () => {
    // WHY: this list is the account's follow-ups. The title is the only way
    // onto the record. Leaving it as text forces a search that can match
    // another follow-up.
    work.current.data = {
      commitments: [],
      internalTasks: [
        {
          recordKind: 'internal_task',
          id: PRICING,
          title: 'Submit revised pricing & SoW v2',
          dueDate: '2026-05-15',
          status: 'in_progress',
          assigneeEmail: 'jordan@northwind.example',
        },
      ],
    };

    renderPeople();

    const link = screen.getByRole('link', { name: /Submit revised pricing & SoW v2/ });
    expect(link.getAttribute('href')).toBe(`/tasks/${PRICING}`);
    expect(link.textContent).toContain('open follow-up');
    expect(link.className).toContain('min-h-11');
    expect(link.className).toContain('focus-visible:ring-2');
    expect(link.className).toContain('dark:text-[var(--brand-deep)]');
  });

  it('keeps a title as text when the id is not a task id', () => {
    // WHY: the address is the id, never the title. A script, a path, or a
    // title must not become the href.
    work.current.data = {
      commitments: [],
      internalTasks: [
        {
          recordKind: 'internal_task',
          id: 'javascript:alert(1)',
          title: 'Submit revised pricing & SoW v2',
          dueDate: '2026-05-15',
          status: 'open',
          assigneeEmail: null,
        },
      ],
    };

    renderPeople();

    expect(screen.getByText('Submit revised pricing & SoW v2')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Submit revised pricing/ })).toBeNull();
  });
});
