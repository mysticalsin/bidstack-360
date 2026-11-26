// A coverage cell with no loaded people is not proof that nobody was met.
// An unread list, or a meeting row whose detail never arrives, must not say
// the level is empty.
import { cleanup, render, screen } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  },
}));

import { PeopleDrill } from './PeopleDrill';

const GROUP = 'c0000000-0000-4000-8000-0000000000aa';
const CELL = { region: 'CA', seniority: 'c_level' as const };

const DETAIL = {
  id: 'm1',
  title: 'Harbor review',
  heldAt: '2026-10-25T10:00:00Z',
  attendees: [
    {
      id: 'a1',
      name: 'Casey Quinn',
      email: null,
      title: 'Buyer',
      seniority: 'c_level',
      region: 'CA',
      businessUnit: null,
      isInternal: false,
      contactId: 'k-1',
      reportsToContactId: null,
    },
  ],
};

function renderDrill() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PeopleDrill groupId={GROUP} cell={CELL} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  onlineManager.setOnline(true);
});

describe('PeopleDrill failed read', () => {
  it('does not say nobody when the meeting list has not arrived', () => {
    onlineManager.setOnline(false);
    apiMock.mockImplementation(() => new Promise(() => undefined));

    renderDrill();

    expect(screen.queryByText(/Nobody at this level/)).toBeNull();
    expect(screen.getByText('Loading people…')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('does not say nobody when the meeting detail fails', async () => {
    onlineManager.setOnline(true);
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/meeting-intel?')) {
        return { items: [{ id: 'm1' }], nextCursor: null };
      }
      throw new Error('detail failed');
    });

    renderDrill();

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load these meetings.");
    expect(screen.queryByText(/Nobody at this level/)).toBeNull();
  });

  it('still says nobody when the list arrived and the level is empty', async () => {
    onlineManager.setOnline(true);
    apiMock.mockResolvedValue({ items: [], nextCursor: null });

    renderDrill();

    expect(await screen.findByText('Nobody at this level met in CA yet.')).toBeTruthy();
  });

  it('still names a person whose meeting detail arrived', async () => {
    onlineManager.setOnline(true);
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/meeting-intel?')) {
        return { items: [{ id: 'm1' }], nextCursor: null };
      }
      if (path === '/api/meeting-intel/m1') return DETAIL;
      throw new Error(`unexpected ${path}`);
    });

    renderDrill();

    expect(await screen.findByText('Casey Quinn')).toBeTruthy();
    expect(screen.queryByText(/Nobody at this level/)).toBeNull();
  });
});
