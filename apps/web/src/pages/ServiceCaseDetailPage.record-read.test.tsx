// A paused or in-flight service case read has no record yet. The detail
// page used the same "Case not found" line as a settled miss, which tells
// the reader the case was deleted. The payload has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en' },
  }),
}));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { ServiceCaseDetailPage } from './ServiceCaseDetailPage';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const CAPABILITIES = {
  userId: 'u1',
  orgId: 'o1',
  legacyRole: 'admin',
  roles: ['Admin'],
  permissions: ['service-desk:write'],
  isAdmin: true,
};

const CASE = {
  id: CASE_ID,
  orgId: '22222222-2222-4222-8222-222222222222',
  number: 'CS-6152',
  subject: 'Northwind demo case',
  description: null,
  priority: 'high',
  status: 'open',
  accountId: null,
  contactId: null,
  ownerId: null,
  ownerName: null,
  source: 'email',
  satisfaction: null,
  resolvedAt: null,
  closedAt: null,
  slaDeadline: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const NOT_FOUND = 'Case not found';
const DELETED = 'This case may have been deleted.';
const CHECKING = 'Checking this case';
const NOT_ARRIVED = 'The case has not arrived.';
const LOAD_ERROR = 'Failed to load case';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/service-desk/${CASE_ID}`]}>
        <Routes>
          <Route path="/service-desk/:id" element={<ServiceCaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function statusText(): string {
  return screen.getByRole('status').textContent ?? '';
}

describe('ServiceCaseDetailPage record read', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused service case read a deleted case', () => {
    // WHY: a paused first read has isLoading false and no case. The page
    // said "Case not found" and that the case may have been deleted, while
    // the payload has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(statusText()).toContain(CHECKING);
    expect(statusText()).toContain(NOT_ARRIVED);
  });

  it('does not call an in-flight service case read a deleted case', () => {
    // WHY: the skeleton alone does not say the case has not arrived. A
    // reader of a slow read was left with either silence or "not found".
    onlineManager.setOnline(true);
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === `/api/service-cases/${CASE_ID}`) return new Promise(() => {});
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(statusText()).toContain(CHECKING);
    expect(statusText()).toContain(NOT_ARRIVED);
  });

  it('keeps a failed service case read on the error, not on not-found', async () => {
    // WHY: a failed read is not evidence the case is gone. The error line
    // stays, and it does not say the case may have been deleted.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === `/api/service-cases/${CASE_ID}`) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: LOAD_ERROR })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says the case is missing after a settled read with no record', async () => {
    // WHY: a read that arrives empty is a miss. That line stays "Case not
    // found" so a deleted id is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === `/api/service-cases/${CASE_ID}`) return Promise.resolve(null);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: NOT_FOUND })).toBeTruthy();
    expect(screen.getByText(DELETED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still shows the case once the payload has arrived', async () => {
    // WHY: a loaded record stays on the page. The unread line must not
    // replace a case the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === `/api/service-cases/${CASE_ID}`) return Promise.resolve(CASE);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'CS-6152' })).toBeTruthy();
    expect(screen.getByText('Northwind demo case')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
