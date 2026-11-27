// WHY: the cockpit notes card is the only place a saved note, a pin, and a
// failed refresh are visible. These cases lock the promises that were
// breaking that card:
// - a successful save must stay on screen while the follow-up list refetch
//   is still in flight, including when an older list response arrives late
// - a pin must lift that note above newer unpinned notes immediately
// - a background refetch failure must not replace loaded notes with an
//   error wall, and must not claim the list is empty
// - a cold load failure must be retryable
// - switching accounts must drop an open draft and an open import dialog
//   so they cannot be saved onto the next account
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Note } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!opts) return template;
      return Object.entries(opts).reduce(
        (str, [name, value]) => str.replaceAll(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { NotesPanel } from './NotesPanel';

const ACME = 'acct-acme';
const GLOBEX = 'acct-globex';

function note(overrides: Partial<Note> & Pick<Note, 'id' | 'title' | 'createdAt'>): Note {
  return {
    accountId: ACME,
    bodyMd: 'Synthetic context for the demo account.',
    pinned: false,
    authorUserId: '11111111-1111-4111-8111-111111111111',
    authorEmail: 'ada@example.com',
    updatedAt: overrides.updatedAt ?? overrides.createdAt,
    ...overrides,
  };
}

const PINNED = note({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Pinned decision',
  createdAt: '2026-03-01T12:00:00.000Z',
  pinned: true,
  bodyMd: 'Keep the renewal owner on the demo account.',
});

const OLDER = note({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  title: 'Renewal risk',
  createdAt: '2026-03-01T12:00:00.000Z',
  bodyMd: 'Endpoint migration timing is still open.',
});

const NEWER = note({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title: 'Latest check-in',
  createdAt: '2026-03-09T12:00:00.000Z',
  bodyMd: 'Security review moved to next week.',
});

const CREATED = note({
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Kickoff recap',
  createdAt: '2026-03-10T12:00:00.000Z',
  bodyMd: 'Synthetic kickoff notes.',
});

type ApiInit = { method?: string; body?: { title?: string; accountId?: string } };

function renderPanel(accountId: string = ACME) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const view = render(panel(accountId, client));
  return {
    client,
    ...view,
    rerenderFor(nextAccountId: string) {
      view.rerender(panel(nextAccountId, client));
    },
  };
}

function panel(accountId: string, client: QueryClient): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <NotesPanel accountId={accountId} companyName="Acme Demo" domain="acme.example" />
    </QueryClientProvider>
  );
}

function noteTitles(): string[] {
  return screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent ?? '');
}

describe('NotesPanel', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  it('keeps a saved note visible when an older list response arrives after the save', async () => {
    let resolveStaleList: (value: { items: Note[] }) => void = () => undefined;
    const staleList = new Promise<{ items: Note[] }>((resolve) => {
      resolveStaleList = resolve;
    });
    let listCalls = 0;
    apiMock.mockImplementation((url: string, init?: ApiInit) => {
      if (url.startsWith('/api/notes?')) {
        listCalls += 1;
        if (listCalls === 1) return staleList;
        return new Promise(() => undefined);
      }
      if (init?.method === 'POST') return Promise.resolve(CREATED);
      return Promise.reject(new Error(`unexpected ${init?.method ?? 'GET'} ${url}`));
    });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Kickoff recap' } });
    fireEvent.change(screen.getByLabelText('Note body'), {
      target: { value: 'Synthetic kickoff notes.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('heading', { name: 'Kickoff recap' })).toBeTruthy();

    // The late empty payload is the response that was in flight before the
    // save. Applying it would flash "No notes yet" over a note that saved.
    await act(async () => {
      resolveStaleList({ items: [] });
      await staleList;
    });
    expect(screen.getByRole('heading', { name: 'Kickoff recap' })).toBeTruthy();
    expect(screen.queryByText('No notes yet')).toBeNull();
  });

  it('places a new unpinned note under notes that are already pinned', async () => {
    let listCalls = 0;
    apiMock.mockImplementation((url: string, init?: ApiInit) => {
      if (url.startsWith('/api/notes?')) {
        listCalls += 1;
        if (listCalls === 1) return Promise.resolve({ items: [PINNED] });
        return new Promise(() => undefined);
      }
      if (init?.method === 'POST') return Promise.resolve(CREATED);
      return Promise.reject(new Error(`unexpected ${init?.method ?? 'GET'} ${url}`));
    });

    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Pinned decision' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Kickoff recap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(noteTitles()).toEqual(['Pinned decision', 'Kickoff recap']));
    expect(screen.queryByText('No notes yet')).toBeNull();
  });

  it('lifts a pinned note above a newer unpinned note before the list refetch returns', async () => {
    let listCalls = 0;
    apiMock.mockImplementation((url: string, init?: ApiInit) => {
      if (url.startsWith('/api/notes?')) {
        listCalls += 1;
        if (listCalls === 1) return Promise.resolve({ items: [NEWER, OLDER] });
        return new Promise(() => undefined);
      }
      if (init?.method === 'PATCH' && url.endsWith(OLDER.id)) {
        return Promise.resolve({ ...OLDER, pinned: true, updatedAt: '2026-03-10T12:00:00.000Z' });
      }
      return Promise.reject(new Error(`unexpected ${init?.method ?? 'GET'} ${url}`));
    });

    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Latest check-in' })).toBeTruthy();
    expect(noteTitles()).toEqual(['Latest check-in', 'Renewal risk']);

    const renewal = screen.getByRole('heading', { name: 'Renewal risk' }).closest('li');
    expect(renewal).toBeTruthy();
    fireEvent.click(within(renewal as HTMLElement).getByRole('button', { name: 'Pin Renewal risk' }));

    await waitFor(() => expect(noteTitles()).toEqual(['Renewal risk', 'Latest check-in']));
    expect(within(screen.getByRole('heading', { name: 'Renewal risk' }).closest('li') as HTMLElement).getByText('Pinned')).toBeTruthy();
  });

  it('keeps loaded notes and a retry when a background refresh fails', async () => {
    let failRefresh = false;
    apiMock.mockImplementation((url: string) => {
      if (!url.startsWith('/api/notes?')) return Promise.reject(new Error(`unexpected ${url}`));
      if (failRefresh) return Promise.reject(new Error('focus refetch failed'));
      return Promise.resolve({ items: [NEWER] });
    });

    const { client } = renderPanel();
    expect(await screen.findByRole('heading', { name: 'Latest check-in' })).toBeTruthy();
    failRefresh = true;
    await client.refetchQueries({ queryKey: ['notes', ACME] }).catch(() => undefined);

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Showing the last loaded notes.');
    });
    expect(screen.getByRole('heading', { name: 'Latest check-in' })).toBeTruthy();
    expect(screen.queryByText("Couldn't load notes")).toBeNull();

    failRefresh = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Latest check-in' })).toBeTruthy();
  });

  it('does not call a failed refresh over an empty list a confirmed empty state', async () => {
    let failRefresh = false;
    apiMock.mockImplementation((url: string) => {
      if (!url.startsWith('/api/notes?')) return Promise.reject(new Error(`unexpected ${url}`));
      if (failRefresh) return Promise.reject(new Error('refetch failed over empty'));
      return Promise.resolve({ items: [] });
    });

    const { client } = renderPanel();
    expect(await screen.findByText('No notes yet')).toBeTruthy();
    failRefresh = true;
    await client.refetchQueries({ queryKey: ['notes', ACME] }).catch(() => undefined);

    await waitFor(() => {
      expect(screen.queryByText('No notes yet')).toBeNull();
      expect(screen.queryByText("Couldn't load notes")).toBeNull();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    });

    failRefresh = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No notes yet')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers retry on a cold load failure and renders notes after it succeeds', async () => {
    let fail = true;
    apiMock.mockImplementation((url: string) => {
      if (!url.startsWith('/api/notes?')) return Promise.reject(new Error(`unexpected ${url}`));
      if (fail) return Promise.reject(new Error('notes offline'));
      return Promise.resolve({ items: [NEWER] });
    });

    renderPanel();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText("Couldn't load notes")).toBeTruthy();
    expect(screen.getByText('notes offline')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Latest check-in' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('drops an open draft and import dialog when the account changes', async () => {
    apiMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/notes?')) return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const view = renderPanel(ACME);
    expect(await screen.findByText('No notes yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import meeting' }));
    expect(await screen.findByRole('heading', { name: 'Import meeting notes' })).toBeTruthy();

    view.rerenderFor(GLOBEX);
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Import meeting notes' })).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByLabelText('Note title'), {
      target: { value: 'Do not save on Globex' },
    });
    view.rerenderFor(ACME);
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Do not save on Globex')).toBeNull();
    });
    expect(screen.queryByLabelText('Note title')).toBeNull();
  });
});
