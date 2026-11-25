// A contact's related follow-ups are titles with no destination. Demo rows
// such as "Submit revised pricing & SoW v2" already store a task id, but the
// title never uses it, so the only way to open that follow-up is to leave
// the contact and search Tasks. A title search can match a different row.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

const PRICING = '00000000-0000-4000-8000-000000010001';
const DEAL = '00000000-0000-4000-8000-0000000000aa';

vi.mock('@/hooks/useContacts', () => ({
  useContact: () => ({
    isLoading: false,
    isError: false,
    data: {
      id: 'c-1',
      customer: 'CI Financial',
      name: 'Alex Example',
      role: 'CIO',
      email: 'alex@example.test',
      phone: null,
      influence: null,
      sentiment: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      companyId: null,
      linkState: 'linked',
    },
  }),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: () => ({
    data: {
      items: [
        {
          id: DEAL,
          code: 'OP-2041',
          name: 'IT Modernization',
          customer: 'CI Financial',
          stage: 's3_technical_iteration',
          probability: 65,
        },
      ],
      nextCursor: null,
    },
  }),
}));

const tasks = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => ({ data: { items: tasks.items } }),
}));

vi.mock('@/hooks/useNotes', () => ({ useNotes: () => ({ data: { items: [] } }) }));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'c-1' }) };
});

import { ContactDetailPage } from './ContactDetailPage';

function renderRecord() {
  render(
    <MemoryRouter>
      <ContactDetailPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  tasks.items = [];
});

describe('contact follow-up titles', () => {
  it('opens the follow-up record from the task title', () => {
    // WHY: this card is the contact's follow-up list. The title is the only
    // way onto the record. Leaving it as text forces a search that can match
    // another follow-up.
    tasks.items = [
      {
        id: PRICING,
        oppId: DEAL,
        title: 'Submit revised pricing & SoW v2',
        status: 'in_progress',
        dueDate: '2026-05-15',
        assignee: 'jordan@northwind.example',
      },
    ];

    renderRecord();

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
    tasks.items = [
      {
        id: 'javascript:alert(1)',
        oppId: DEAL,
        title: 'Submit revised pricing & SoW v2',
        status: 'open',
        dueDate: '2026-05-15',
        assignee: null,
      },
    ];

    renderRecord();

    expect(screen.getByText('Submit revised pricing & SoW v2')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Submit revised pricing/ })).toBeNull();
  });
});
