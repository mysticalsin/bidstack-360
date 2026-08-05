import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const referenceHookMocks = vi.hoisted(() => ({
  useReferences: vi.fn(),
  useCreateReference: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteReference: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUseReference: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

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

vi.mock('@/hooks/useReferences', () => referenceHookMocks);

// Write controls are irrelevant to the link-safety fix under test.
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => false }));

import { isSafeHttpUrl, ReferencesPage } from './ReferencesPage';

function baseReference(documentUrl: string | null) {
  return {
    id: 'ref-1',
    companyId: null,
    title: 'Acme case study',
    description: null,
    industry: null,
    valueMicros: null,
    contactName: null,
    contactEmail: null,
    usageCount: 0,
    lastUsedAt: null,
    documentUrl,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    company: null,
  };
}

function mockReferences(documentUrl: string | null) {
  referenceHookMocks.useReferences.mockReturnValue({
    data: { items: [baseReference(documentUrl)] },
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
  });
}

// The page reads its filters from the URL through nuqs, and table-kit's
// DataTable registers `expand`/`hide` the same way — so the render tree needs
// the same router + adapter the app mounts in main.tsx. react-query is here
// only because the NewReferenceDialog subtree touches it.
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
  return render(<ReferencesPage />, { wrapper: Wrapper });
}

describe('isSafeHttpUrl', () => {
  it('accepts http/https and rejects javascript:/data: schemes', () => {
    expect(isSafeHttpUrl('https://example.com/doc.pdf')).toBe(true);
    expect(isSafeHttpUrl('http://example.com/doc.pdf')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
  });
});

describe('ReferencesPage — document link scheme guard', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/references');
  });

  it('renders a clickable "View document" link for an http(s) documentUrl', () => {
    mockReferences('https://example.com/case-study.pdf');

    renderPage();

    const link = screen.getByRole('link', { name: 'View document' });
    expect(link.getAttribute('href')).toBe('https://example.com/case-study.pdf');
  });

  it('renders plain text instead of a clickable link for a javascript: documentUrl', () => {
    // WHY this matters: a stored javascript:/data: URL rendered as
    // href={ref.documentUrl} with no scheme check would execute on click —
    // this is the last line of defense if a non-http(s) URL ever reaches the
    // client (e.g. a row written before the API-side validation shipped).
    mockReferences('javascript:alert(1)');

    renderPage();

    expect(screen.queryByRole('link', { name: 'View document' })).toBeNull();
    expect(screen.getByText('Document link unavailable')).toBeTruthy();
  });
});

describe('ReferencesPage — the table is the view', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/references');
  });

  it('renders the reference as a table row, not a card', () => {
    mockReferences(null);

    renderPage();

    expect(screen.getByRole('columnheader', { name: 'Reference' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: /Acme case study/ })).toBeTruthy();
  });

  it('reads the search term and facet segments off the URL', () => {
    window.history.replaceState(null, '', '/references?q=acme&industry=healthcare&tag=ehr');
    mockReferences(null);

    renderPage();

    // The search box is a controlled view of the URL — no shadow useState.
    const search = screen.getByRole('searchbox', { name: 'Search references' });
    expect((search as HTMLInputElement).value).toBe('acme');
    // …and the URL values reached the API filter object.
    expect(referenceHookMocks.useReferences).toHaveBeenCalledWith({
      search: 'acme',
      industry: 'healthcare',
      tag: 'ehr',
    });
  });
});
