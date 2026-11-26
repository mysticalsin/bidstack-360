// WHY: the account card waits on coverage, then treats a missing meetings
// payload as an empty book. A slow or failed meetings read was "No meetings
// recorded" before the list arrived. A challenges read that has not arrived
// was "No challenges captured yet". An empty book that did arrive still says so.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>();
  return { ...real, api: vi.fn() };
});

import { WhoWeMetCard } from './WhoWeMetCard';
import { api } from '@/lib/api';

const CI = 'c0000000-0000-4000-8000-000000000001';

const emptyCoverage = {
  groupId: CI,
  regions: [],
  seniorities: [],
  windowDays: 365,
  cells: [],
  gaps: [],
};

const coverageWithPerson = {
  groupId: CI,
  regions: ['CA'],
  seniorities: ['c_level', 'vp', 'director', 'manager'],
  windowDays: 365,
  cells: [
    {
      region: 'CA',
      seniority: 'c_level',
      meetings: 1,
      people: 1,
      lastMetAt: '2026-10-25T10:00:00Z',
    },
  ],
  gaps: [],
};

const meeting = {
  id: 'm1',
  companyId: CI,
  companyName: 'Northwind',
  title: 'Cloud cost review',
  heldAt: '2026-10-25T10:00:00Z',
  visibility: 'org',
  sources: ['manual'],
  attendeeCount: 1,
  topSeniority: 'c_level',
  challenges: [],
  nextSteps: [],
  summary: null,
  transcript: null,
  similarProjects: [],
  opportunities: [],
  createdAt: '2026-10-25T12:00:00Z',
  attendees: [],
  sourceLinks: [],
};

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WhoWeMetCard companyId={CI} companyName="Northwind" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function route(handlers: Record<string, () => unknown>) {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path.includes('/coverage')) return handlers.coverage?.() as never;
    if (path.includes('/challenges')) return handlers.challenges?.() as never;
    if (path.startsWith('/api/meeting-intel')) return handlers.meetings?.() as never;
    throw new Error(`unexpected ${path}`);
  });
}

afterEach(() => {
  cleanup();
  vi.mocked(api).mockReset();
});

describe('Who we met does not call an unread meetings list empty', () => {
  it('says the meetings have not arrived when coverage is empty and the list is still out', async () => {
    route({
      coverage: () => emptyCoverage,
      challenges: () => ({ items: [] }),
      meetings: () => new Promise(() => undefined),
    });
    renderCard();
    expect(await screen.findByText('Checking meetings. They have not arrived.')).toBeTruthy();
    expect(screen.queryByText(/No meetings recorded/)).toBeNull();
  });

  it('says the meetings failed to load instead of an empty book', async () => {
    route({
      coverage: () => emptyCoverage,
      challenges: () => ({ items: [] }),
      meetings: () => {
        throw new Error('meetings down');
      },
    });
    renderCard();
    // The list retries twice before it settles as a failure. Until then the
    // card stays on "not arrived", which is still not an empty book.
    const alert = await screen.findByRole('alert', undefined, { timeout: 8000 });
    expect(alert.textContent).toContain('Could not load meetings.');
    expect(alert.textContent).toContain('The meetings have not arrived.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(/No meetings recorded/)).toBeNull();
  });

  it('does not call a meetings payload with no list an empty book', async () => {
    route({
      coverage: () => emptyCoverage,
      challenges: () => ({ items: [] }),
      meetings: () => ({}),
    });
    renderCard();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load meetings.');
    expect(screen.queryByText(/No meetings recorded/)).toBeNull();
  });

  it('still says there are no meetings when the empty list has arrived', async () => {
    route({
      coverage: () => emptyCoverage,
      challenges: () => ({ items: [] }),
      meetings: () => ({ items: [], nextCursor: null }),
    });
    renderCard();
    expect(await screen.findByText(/No meetings recorded/)).toBeTruthy();
    expect(screen.queryByText('Checking meetings. They have not arrived.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a meeting that has arrived', async () => {
    route({
      coverage: () => coverageWithPerson,
      challenges: () => ({ items: [] }),
      meetings: () => ({ items: [meeting], nextCursor: null }),
    });
    renderCard();
    expect(await screen.findByText('Cloud cost review')).toBeTruthy();
    expect(screen.queryByText('Checking meetings. They have not arrived.')).toBeNull();
    expect(screen.queryByText(/No meetings recorded/)).toBeNull();
  });

  it('does not call unread challenges an empty rollup', async () => {
    route({
      coverage: () => coverageWithPerson,
      challenges: () => new Promise(() => undefined),
      meetings: () => ({ items: [meeting], nextCursor: null }),
    });
    renderCard();
    expect(await screen.findByText('Cloud cost review')).toBeTruthy();
    expect(await screen.findByText('Checking challenges. They have not arrived.')).toBeTruthy();
    expect(screen.queryByText('No challenges captured yet.')).toBeNull();
  });

  it('says challenges failed to load instead of an empty rollup', async () => {
    route({
      coverage: () => coverageWithPerson,
      challenges: () => {
        throw new Error('challenges down');
      },
      meetings: () => ({ items: [meeting], nextCursor: null }),
    });
    renderCard();
    expect(await screen.findByText('Cloud cost review')).toBeTruthy();
    const alert = await screen.findByRole('alert', undefined, { timeout: 8000 });
    expect(alert.textContent).toContain('Could not load challenges.');
    expect(alert.textContent).toContain('The challenges have not arrived.');
    expect(screen.queryByText('No challenges captured yet.')).toBeNull();
  });

  it('keeps coverage on screen when the meetings list fails', async () => {
    route({
      coverage: () => coverageWithPerson,
      challenges: () => ({ items: [] }),
      meetings: () => {
        throw new Error('meetings down');
      },
    });
    renderCard();
    expect(await screen.findByTestId('coverage-map')).toBeTruthy();
    const alert = await screen.findByRole('alert', undefined, { timeout: 8000 });
    expect(alert.textContent).toContain('Could not load meetings.');
    expect(alert.textContent).toContain('The meetings have not arrived.');
    expect(screen.queryByTestId('meeting-timeline')).toBeNull();
  });

  it('still says no challenges when that empty rollup has arrived', async () => {
    route({
      coverage: () => coverageWithPerson,
      challenges: () => ({ items: [] }),
      meetings: () => ({ items: [meeting], nextCursor: null }),
    });
    renderCard();
    expect(await screen.findByText('No challenges captured yet.')).toBeTruthy();
    expect(screen.queryByText('Checking challenges. They have not arrived.')).toBeNull();
  });
});
