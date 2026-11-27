// A paused, in-flight, or failed custom-object catalog read has no
// definition yet. The list used the same "not found" line as a settled
// miss, which tells the reader the object is gone. The catalog has not
// arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return key;
      return Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { CustomObjectListPage } from './CustomObjectListPage';

const OBJECT_KEY = 'warranty';
const DEF_ID = '11111111-1111-4111-8111-111111111111';

const CAPABILITIES = {
  userId: 'u1',
  orgId: '22222222-2222-4222-8222-222222222222',
  legacyRole: 'admin',
  roles: ['Admin'],
  permissions: ['customObjects:write'],
  isAdmin: true,
};

const DEF = {
  id: DEF_ID,
  orgId: '22222222-2222-4222-8222-222222222222',
  key: OBJECT_KEY,
  labelSingular: 'Warranty',
  labelPlural: 'Warranties',
  description: null,
  icon: 'box',
  color: '#6366f1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  recordCount: 1,
};

const RECORD = {
  id: '33333333-3333-4333-8333-333333333333',
  orgId: DEF.orgId,
  customObjectDefId: DEF_ID,
  recordKey: 'WR-6152',
  valuesJson: { name: 'Northwind warranty desk' },
  createdById: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

const NOT_FOUND = `Custom object "${OBJECT_KEY}" not found.`;
const CHECKING = 'Checking this object';
const NOT_ARRIVED = 'The object has not arrived.';
const LOAD_ERROR = 'Could not load this object';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/o/${OBJECT_KEY}`]}>
        <Routes>
          <Route path="/o/:objectKey" element={<CustomObjectListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function statusText(): string {
  return screen.getByRole('status').textContent ?? '';
}

describe('CustomObjectListPage catalog read', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused custom object catalog a missing object', () => {
    // WHY: a paused first read has isLoading false and no definition. The
    // page said the object was not found, while the catalog has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText('404')).toBeNull();
    expect(statusText()).toContain(CHECKING);
    expect(statusText()).toContain(NOT_ARRIVED);
  });

  it('does not call an in-flight custom object catalog a missing object', () => {
    // WHY: the skeleton alone does not say the object has not arrived. A
    // reader of a slow catalog was left with either silence or "not found".
    onlineManager.setOnline(true);
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === '/api/custom-objects') return new Promise(() => {});
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText('404')).toBeNull();
    expect(statusText()).toContain(CHECKING);
    expect(statusText()).toContain(NOT_ARRIVED);
  });

  it('keeps a failed custom object catalog on the error, not on not-found', async () => {
    // WHY: a failed read is not evidence the object is gone. The error line
    // stays, and it does not say the object was not found.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === '/api/custom-objects') return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: LOAD_ERROR })).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText('404')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says the object is missing after a settled catalog with no match', async () => {
    // WHY: a catalog that arrives without this key is a miss. That line
    // stays "not found" so a deleted key is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === '/api/custom-objects') return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.getByText('404')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('heading', { name: LOAD_ERROR })).toBeNull();
  });

  it('still shows the object once the catalog has arrived', async () => {
    // WHY: a loaded definition stays on the page. The unread line must not
    // replace an object the catalog already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === '/api/custom-objects') return Promise.resolve({ items: [DEF] });
      if (path.startsWith(`/api/custom-objects/${DEF_ID}/records`)) {
        return Promise.resolve({ items: [RECORD], total: 1, page: 1, limit: 50 });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Warranties' })).toBeTruthy();
    expect(await screen.findByText('WR-6152')).toBeTruthy();
    expect(screen.getByText('Northwind warranty desk')).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
