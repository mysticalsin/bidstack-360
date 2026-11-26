// A paused or in-flight proposal read has no record yet. The detail page
// used the same "Proposal not found." line as a settled miss, which tells
// the reader the proposal was deleted. The payload has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'p1' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/proposals/p1' }),
}));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { ProposalDetailPage } from './ProposalDetailPage';

const CAPABILITIES = {
  userId: 'u1',
  orgId: 'o1',
  legacyRole: 'admin',
  roles: ['Admin'],
  permissions: ['proposals:write'],
  isAdmin: true,
};

const PROPOSAL = {
  id: 'p1',
  orgId: 'o1',
  opportunityId: null,
  name: 'Northwind Demo Proposal',
  status: 'draft',
  version: 1,
  ownerId: null,
  complianceScore: null,
  dueDate: null,
  sections: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const NOT_FOUND = 'Proposal not found.';
const CHECKING = 'Checking this proposal';
const NOT_ARRIVED = 'The proposal has not arrived.';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ProposalDetailPage />
    </QueryClientProvider>,
  );
}

function statusText(): string {
  return screen.getByRole('status').textContent ?? '';
}

describe('ProposalDetailPage record read', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused proposal read a missing proposal', () => {
    // WHY: a paused first read has isLoading false and no proposal. The page
    // said "Proposal not found.", which reads as a deleted record while the
    // payload has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(statusText()).toContain(CHECKING);
    expect(statusText()).toContain(NOT_ARRIVED);
  });

  it('does not call an in-flight proposal read a missing proposal', async () => {
    // WHY: the skeleton alone does not say the proposal has not arrived.
    // A reader of a slow read was left with either silence or "not found".
    onlineManager.setOnline(true);
    apiMock.mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(statusText()).toContain(CHECKING);
    expect(statusText()).toContain(NOT_ARRIVED);
  });

  it('keeps a failed proposal read on the error, not on not-found', async () => {
    // WHY: a failed read is not evidence the proposal is gone. The error
    // line stays, including when the server message itself says not found.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === '/api/v1/proposals/p1') return Promise.reject(new Error(NOT_FOUND));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText('Failed to load proposal')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('still says the proposal is missing after a settled read with no record', async () => {
    // WHY: a read that arrives empty is a miss. That line stays "Proposal
    // not found." so a deleted id is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === '/api/v1/proposals/p1') return Promise.resolve(null);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.queryByText('Failed to load proposal')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still shows the proposal once the payload has arrived', async () => {
    // WHY: a loaded record stays on the page. The unread line must not
    // replace a proposal the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === '/api/v1/proposals/p1') return Promise.resolve(PROPOSAL);
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Northwind Demo Proposal' }),
    ).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
