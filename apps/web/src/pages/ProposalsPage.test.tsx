// Regression: 'New Proposal' and the create-sheet submit both POST
// /api/v1/proposals, gated server-side behind proposals:write — the button
// and form rendered unconditionally enabled, a 403-on-click trap for a
// read-only RFP viewer. Mirrors ReferencesPage.test.tsx's render harness
// (nuqs + router + react-query) since this page reads its view off the URL.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    // table-kit's TablePagination builds an Intl.NumberFormat from
    // `i18n.language` — the stub needs it or every render throws.
    i18n: { language: 'en' },
  }),
}));

const apiMocks = vi.hoisted(() => ({
  api: vi.fn((path: string) => {
    if (path.startsWith('/api/v1/proposals')) return Promise.resolve({ items: [], total: 0 });
    if (path.startsWith('/api/users')) return Promise.resolve({ items: [], nextCursor: null });
    return Promise.resolve({});
  }),
}));
vi.mock('@/lib/api', () => apiMocks);

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

import { ProposalsPage } from './ProposalsPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <NuqsAdapter>{children}</NuqsAdapter>
        </BrowserRouter>
      </QueryClientProvider>
    );
  }
  return render(<ProposalsPage />, { wrapper: Wrapper });
}

describe('ProposalsPage — proposals:write gating', () => {
  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/proposals');
  });

  it('shows the New Proposal button for a user with proposals:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);

    renderPage();

    expect(screen.getByRole('button', { name: 'New Proposal' })).toBeTruthy();
  });

  it('hides the New Proposal button for a user without proposals:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    expect(screen.queryByRole('button', { name: 'New Proposal' })).toBeNull();
  });

  it('enables the create-sheet Create button for a user with proposals:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    window.history.replaceState(null, '', '/proposals?new=1');

    renderPage();

    // Empty name still disables it — permission is orthogonal to validation.
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('disables the create-sheet Create button for a user without proposals:write, even reached via a direct ?new=1 link', () => {
    // The trigger button is hidden above, but `?new=1` is a bookmarkable URL —
    // the sheet itself must still refuse to submit for a read-only viewer.
    capabilitiesMocks.useHasPermission.mockReturnValue(false);
    window.history.replaceState(null, '', '/proposals?new=1');

    renderPage();

    const createButton = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    expect(createButton.getAttribute('title')).toBe(
      'You need proposals write access to create a proposal.',
    );
  });
});
