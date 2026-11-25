import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

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

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { TimelinePanel } from './TimelinePanel';

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TimelinePanel oppId="opp-1" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const PRICING_TASK = '00000000-0000-4000-8000-000000010001';
const DONE_TASK = '00000000-0000-4000-8000-000000010099';

describe('TimelinePanel — merged deal narrative', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('renders Activity-model entries (calls/notes) with actor and relative time', async () => {
    // WHY this matters: the chatter Activity model existed but the opportunity
    // timeline never read it — calls and notes logged through /activities were
    // invisible on the deal page. This pins the new entry kinds rendering with
    // who did it and when.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/opportunities/opp-1/timeline') {
        return Promise.resolve({
          items: [
            {
              id: 'activity-a1',
              kind: 'call',
              text: 'Intro call with CTO',
              actorName: 'Jane Doe',
              createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
              metadata: { source: 'activity', status: 'completed', actorType: 'user' },
            },
            {
              id: 'comment-c1',
              kind: 'comment',
              text: 'Pricing looks tight',
              actorName: null,
              createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
            },
          ],
        });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText('Intro call with CTO')).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    // Kind label is humanized and shown alongside the entry.
    expect(screen.getByText('call')).toBeTruthy();
    // Relative time, with the absolute date preserved in the datetime attr.
    expect(screen.getByText('2 hours ago')).toBeTruthy();
    // Legacy comment entries keep rendering in the same merged list.
    expect(screen.getByText('Pricing looks tight')).toBeTruthy();
  });

  it('shows the empty state when the deal has no history yet', async () => {
    apiMock.mockResolvedValue({ items: [] });

    renderPanel();

    expect(await screen.findByText('No activity yet')).toBeTruthy();
  });

  it('says a late demo follow-up is overdue and opens its task', async () => {
    // WHY: the May 2026 pricing follow-up is still in progress. The activity
    // tab must say so in words and open /tasks/:id. A finished follow-up with
    // the same past day is not late. A call on the same list stays text.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T22:30:00.000Z'));
    apiMock.mockResolvedValue({
      items: [
        {
          id: `task-${PRICING_TASK}`,
          kind: 'task',
          text: 'Task created: Submit revised pricing & SoW v2',
          actorName: 'Jordan',
          createdAt: '2026-05-01T00:00:00.000Z',
          metadata: { status: 'in_progress', dueDate: '2026-05-15T00:00:00.000Z' },
        },
        {
          id: `task-${DONE_TASK}`,
          kind: 'task',
          text: 'Task created: Kickoff handover',
          actorName: null,
          createdAt: '2026-05-02T00:00:00.000Z',
          metadata: { status: 'done', dueDate: '2026-05-12T00:00:00.000Z' },
        },
        {
          id: 'activity-call-1',
          kind: 'call',
          text: 'Procurement timeline check',
          actorName: null,
          createdAt: '2026-11-22T09:30:00.000Z',
        },
      ],
    });

    renderPanel();

    const link = await screen.findByRole('link', { name: /Submit revised pricing & SoW v2/ });
    expect(link.getAttribute('href')).toBe(`/tasks/${PRICING_TASK}`);
    expect(link.textContent).toContain('Overdue: 194d late.');
    expect(link.className).toContain('focus-visible:ring-2');
    const done = screen.getByRole('link', { name: 'Task created: Kickoff handover' });
    expect(done.textContent).not.toContain('Overdue');
    expect(screen.getByText('Procurement timeline check').closest('a')).toBeNull();
  });

  it('surfaces a fetch failure as an error state instead of a fake-empty feed', async () => {
    apiMock.mockRejectedValue(new Error('boom'));

    renderPanel();

    expect(await screen.findByText("Couldn't load the timeline")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
