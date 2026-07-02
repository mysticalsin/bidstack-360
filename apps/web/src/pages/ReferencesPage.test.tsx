import { cleanup, render, screen } from '@testing-library/react';
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
  }),
}));

vi.mock('@/hooks/useReferences', () => referenceHookMocks);

vi.mock('@/hooks/useKeyAccounts', () => ({
  useAccountIndustries: () => ({ data: { items: [] }, isLoading: false }),
}));

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
    isLoading: false,
    isError: false,
    error: null,
  });
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
  });

  it('renders a clickable "View document" link for an http(s) documentUrl', () => {
    mockReferences('https://example.com/case-study.pdf');

    render(<ReferencesPage />);

    const link = screen.getByRole('link', { name: 'View document' });
    expect(link.getAttribute('href')).toBe('https://example.com/case-study.pdf');
  });

  it('renders plain text instead of a clickable link for a javascript: documentUrl', () => {
    // WHY this matters: a stored javascript:/data: URL rendered as
    // href={ref.documentUrl} with no scheme check would execute on click —
    // this is the last line of defense if a non-http(s) URL ever reaches the
    // client (e.g. a row written before the API-side validation shipped).
    mockReferences('javascript:alert(1)');

    render(<ReferencesPage />);

    expect(screen.queryByRole('link', { name: 'View document' })).toBeNull();
    expect(screen.getByText('Document link unavailable')).toBeTruthy();
  });
});
