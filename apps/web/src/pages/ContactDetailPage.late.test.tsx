// A contact's related deals and follow-ups are the place a rep checks
// before a call. Demo bids close in April–September 2026 and demo tasks
// were due in May 2026. On a later day those dates are late. The record
// used to print the raw stage id and "Due {date}" for both, so a won deal,
// a deal due today, and a finished task looked the same as an open bid
// that should have closed months ago.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { daysUntilDueUtc } from '@/components/ui/DueDateChip';

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

const hooks = vi.hoisted(() => ({
  opps: [] as Array<Record<string, unknown>>,
  tasks: [] as Array<Record<string, unknown>>,
}));

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
  useOpportunities: () => ({ data: { items: hooks.opps, nextCursor: null } }),
}));
vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => ({ data: { items: hooks.tasks } }),
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

const NOW = new Date('2026-11-25T15:00:00.000Z');

function renderRecord() {
  render(
    <MemoryRouter>
      <ContactDetailPage />
    </MemoryRouter>,
  );
}

describe('ContactDetailPage late work', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    hooks.opps = [];
    hooks.tasks = [];
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('says an open deal is overdue and names the stage, not the stage id', () => {
    // WHY: "s3_technical_iteration" and a bare July date do not tell a rep
    // the bid is late. The chip is the same bid clock as the deal list.
    hooks.opps = [
      {
        id: 'o-open',
        code: 'OP-2041',
        name: 'IT Modernization',
        customer: 'CI Financial',
        stage: 's3_technical_iteration',
        probability: 65,
        dueDate: '2026-07-22',
      },
    ];
    renderRecord();
    const lateBy = Math.abs(daysUntilDueUtc('2026-07-22', NOW));
    expect(screen.getByText(`${lateBy}d overdue`)).toBeTruthy();
    expect(screen.getByText('S3 Technical Iteration')).toBeTruthy();
    expect(screen.queryByText('s3_technical_iteration')).toBeNull();
  });

  it('keeps a won deal, a deal due today, and a future deal off the overdue clock', () => {
    // WHY: a closed outcome, including a configured won stage, is not a
    // missed close, and the due day itself is not late for the whole afternoon.
    hooks.opps = [
      {
        id: 'o-won',
        code: 'OP-2046',
        name: 'Endpoint Refresh',
        customer: 'CI Financial',
        stage: 'closed_won',
        probability: 100,
        dueDate: '2026-04-28',
      },
      {
        id: 'o-today',
        code: 'OP-9',
        name: 'Room hold',
        customer: 'CI Financial',
        stage: 's2_sent',
        probability: 40,
        dueDate: '2026-11-25',
      },
      {
        id: 'o-later',
        code: 'OP-10',
        name: 'Next year',
        customer: 'CI Financial',
        stage: 's1_ongoing',
        probability: 20,
        dueDate: '2099-12-31',
      },
      {
        id: 'o-configured-won',
        code: 'OP-11',
        name: 'Configured win',
        customer: 'CI Financial',
        stage: 's4_negotiation',
        pipelineStage: { isWon: true, isLost: false },
        probability: 100,
        dueDate: '2026-04-01',
      },
    ];
    renderRecord();
    expect(screen.queryByText(/overdue/i)).toBeNull();
    expect(screen.getByText('Closed Won')).toBeTruthy();
    expect(screen.getByText('S4 Negotiation')).toBeTruthy();
    expect(screen.getByText('Apr 1, 2026')).toBeTruthy();
    expect(screen.getByText('Apr 28, 2026')).toBeTruthy();
    expect(screen.getByText('Due today')).toBeTruthy();
    expect(screen.getByText(/\d+d left/)).toBeTruthy();
  });

  it('says an open, in-progress, or blocked follow-up is overdue once its date has passed', () => {
    hooks.opps = [
      {
        id: 'o-open',
        code: 'OP-2041',
        name: 'IT Modernization',
        customer: 'CI Financial',
        stage: 's1_ongoing',
        probability: 35,
        dueDate: '2099-01-01',
      },
    ];
    hooks.tasks = [
      { id: 't-open', oppId: 'o-open', title: 'Submit the revision', status: 'open', dueDate: '2026-05-15', assignee: null },
      { id: 't-prog', oppId: 'o-open', title: 'Workshop the scope', status: 'in_progress', dueDate: '2026-05-20', assignee: null },
      { id: 't-block', oppId: 'o-open', title: 'Chase the signature', status: 'blocked', dueDate: '2026-05-12', assignee: null },
    ];
    renderRecord();
    const late = Math.abs(daysUntilDueUtc('2026-05-15', NOW));
    expect(screen.getByText(`Overdue: ${late}d late`)).toBeTruthy();
    expect(screen.getByText(`Overdue: ${Math.abs(daysUntilDueUtc('2026-05-20', NOW))}d late`)).toBeTruthy();
    expect(screen.getByText(`Overdue: ${Math.abs(daysUntilDueUtc('2026-05-12', NOW))}d late`)).toBeTruthy();
  });

  it('keeps a follow-up due today and a finished follow-up quiet', () => {
    hooks.opps = [
      {
        id: 'o-open',
        code: 'OP-2041',
        name: 'IT Modernization',
        customer: 'CI Financial',
        stage: 's1_ongoing',
        probability: 35,
        dueDate: null,
      },
    ];
    hooks.tasks = [
      { id: 't-today', oppId: 'o-open', title: 'Confirm the room', status: 'open', dueDate: '2026-11-25', assignee: null },
      { id: 't-done', oppId: 'o-open', title: 'Archive the brief', status: 'done', dueDate: '2026-05-15', assignee: null },
    ];
    renderRecord();
    expect(screen.queryByText(/Overdue/)).toBeNull();
    expect(screen.getByText('Confirm the room')).toBeTruthy();
    expect(screen.getByText('Archive the brief')).toBeTruthy();
  });
});
