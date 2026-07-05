import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    <QueryClientProvider client={queryClient}>
      <TimelinePanel oppId="opp-1" />
    </QueryClientProvider>,
  );
}

describe('TimelinePanel — merged deal narrative', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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

  it('surfaces a fetch failure as an error state instead of a fake-empty feed', async () => {
    apiMock.mockRejectedValue(new Error('boom'));

    renderPanel();

    expect(await screen.findByText("Couldn't load the timeline")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
