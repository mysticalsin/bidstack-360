// A paused or in-flight toolkit read has no rows yet. The library used the
// same "No stored toolkits yet" line as a catalog that arrived empty. The
// list has not arrived, so that sentence is not a finding.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SalesToolkit } from '@bidstack/shared';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: apiMock,
}));

import { ToolkitStoreSection } from './ToolkitStoreSection';

const STORE_PATH = '/api/sales-toolkits/store';
const EMPTY = 'No stored toolkits yet';
const EMPTY_DETAIL =
  'Add your SharePoint decks, templates, and battle-cards here so the team — and the MCP — can find them.';
const WAITING = 'Checking stored toolkits. The list has not arrived.';
const TOOLKIT_TITLE = 'Pricing battle card';

function storedToolkit(): SalesToolkit {
  return {
    id: 'toolkit-pricing',
    title: TOOLKIT_TITLE,
    description: 'Commercial terms for the Siemens bid.',
    category: 'battlecard',
    sectorTags: ['Healthcare'],
    url: 'https://example.test/pricing-battle-card',
    source: 'manual',
    externalId: null,
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
  };
}

function renderLibrary() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ToolkitStoreSection />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function expectNoSettledMiss() {
  expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
  expect(screen.queryByText(EMPTY_DETAIL)).toBeNull();
  expect(screen.queryByText(TOOLKIT_TITLE)).toBeNull();
}

describe('ToolkitStoreSection unread catalog', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused toolkit read an empty library', async () => {
    // WHY: a paused first read has isLoading false and no rows. The library
    // said No stored toolkits yet, while the catalog has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderLibrary();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call an in-flight toolkit read an empty library', async () => {
    // WHY: the skeleton alone still sat where a settled empty library sits.
    // A slow read is not an empty toolkit catalog.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderLibrary();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a failed toolkit read an empty library', async () => {
    // WHY: a failed read is not evidence that nothing is stored. The error
    // stays, and the library does not say the catalog is empty.
    apiMock.mockImplementation((path: string) => {
      if (path === STORE_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderLibrary();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('network down');
    expect(screen.getByRole('heading', { name: "Couldn't load toolkits" })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expectNoSettledMiss();
  });

  it('still says a settled library found none', async () => {
    // WHY: a payload that arrived with no rows is a miss. That line stays, so
    // a real empty library is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === STORE_PATH) return Promise.resolve({ items: [], nextCursor: null });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderLibrary();

    expect(await screen.findByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.getByText(EMPTY_DETAIL)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a toolkit that has arrived', async () => {
    // WHY: a loaded toolkit stays in the library. The unread line must not
    // replace a row the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === STORE_PATH) return Promise.resolve({ items: [storedToolkit()], nextCursor: null });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderLibrary();

    expect(await screen.findByText(TOOLKIT_TITLE)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
