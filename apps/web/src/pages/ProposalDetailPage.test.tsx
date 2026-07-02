import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  name: 'Acme Proposal',
  status: 'draft',
  version: 1,
  ownerId: null,
  complianceScore: null,
  dueDate: '2026-12-01',
  sections: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProposalDetailPage />
    </QueryClientProvider>,
  );
}

describe('ProposalDetailPage — due date mutation', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('sends the native date input value as-is (YYYY-MM-DD), not an ISO timestamp', async () => {
    // WHY this matters: the API's dueDate field is z.string().date()
    // (YYYY-MM-DD only). Wrapping the already-correct input value in
    // `new Date(...).toISOString()` produced a full timestamp that 400'd on
    // every save.
    apiMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === '/api/v1/proposals/p1' && !opts?.method) return Promise.resolve(PROPOSAL);
      if (path === '/api/v1/proposals/p1' && opts?.method === 'PATCH') {
        return Promise.resolve({ ...PROPOSAL, dueDate: '2026-12-31' });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    const dateInput = await screen.findByLabelText('Due date');
    fireEvent.change(dateInput, { target: { value: '2026-12-31' } });

    await waitFor(() => {
      const patchCall = apiMock.mock.calls.find(
        ([, opts]) => (opts as { method?: string } | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeTruthy();
      expect(patchCall![1]).toMatchObject({ body: { dueDate: '2026-12-31' } });
    });
  });

  it('renders an error alert when the due-date save fails, matching the sibling status/delete mutations', async () => {
    apiMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/api/me/capabilities') return Promise.resolve(CAPABILITIES);
      if (path === '/api/v1/proposals/p1' && !opts?.method) return Promise.resolve(PROPOSAL);
      if (path === '/api/v1/proposals/p1' && opts?.method === 'PATCH') {
        return Promise.reject(new Error('Bad Request'));
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPage();

    const dateInput = await screen.findByLabelText('Due date');
    fireEvent.change(dateInput, { target: { value: '2026-12-31' } });

    expect(
      await screen.findByText('Could not update due date. Please try again.'),
    ).toBeTruthy();
  });
});
