import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const companies = { current: {} as Record<string, unknown> };
const start = { current: {} as Record<string, unknown> };
const company = { current: {} as Record<string, unknown> };

vi.mock('@/hooks/useInsightsData', () => ({
  useInsightCompanies: () => companies.current,
}));
vi.mock('@/hooks/useCompanies', () => ({
  useCompany: () => company.current,
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => start.current,
}));
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
  return { ...actual, useReducedMotion: () => true };
});
vi.mock('@/components/charts/sankey', () => ({
  SankeyChart: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  SankeyLink: () => null,
  SankeyNode: () => null,
  SankeyTooltip: () => null,
}));

import { RelationshipDiagram } from './RelationshipDiagram';

const companyRow = { id: 'co-1', name: 'Acme' };

function query(partial: Record<string, unknown>) {
  return {
    isPending: false,
    isFetching: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    refetch: vi.fn(),
    ...partial,
  };
}

describe('relationship diagram frame', () => {
  afterEach(() => cleanup());

  it('keeps the existing diagram visible while the follow-up refetches', () => {
    companies.current = query({ isSuccess: true, data: { items: [companyRow] } });
    start.current = query({ isFetching: true, isSuccess: true, data: 'co-1' });
    company.current = query({
      isSuccess: true,
      data: { name: 'Acme', contacts: [{ id: 'p1', name: 'Ada', role: 'Buyer' }] },
    });
    render(<RelationshipDiagram />);
    expect(screen.getByRole('heading', { name: 'Relationships' }).closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.queryByText('Could not load this view')).toBeNull();
  });

  it('keeps the cached diagram and shows the follow-up error when a refresh fails', () => {
    companies.current = query({ isSuccess: true, data: { items: [companyRow] } });
    start.current = query({ isError: true, isSuccess: false, data: 'co-1', error: new Error('start failed') });
    company.current = query({
      isSuccess: true,
      data: { name: 'Acme', contacts: [{ id: 'p1', name: 'Ada', role: 'Buyer' }] },
    });
    render(<RelationshipDiagram />);
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('Could not refresh the company list')).toBeTruthy();
    expect(screen.getByText('start failed')).toBeTruthy();
    expect(screen.queryByText('Could not load this view')).toBeNull();
  });

  it('shows the follow-up error, not a company error, when the company list succeeded', () => {
    companies.current = query({ isSuccess: true, data: { items: [companyRow] } });
    start.current = query({ isError: true, error: new Error('start failed') });
    company.current = query({});
    render(<RelationshipDiagram />);
    expect(screen.getByText('start failed')).toBeTruthy();
    expect(screen.queryByText('companies failed')).toBeNull();
  });

  it('shows an empty company list instead of a loading skeleton when the follow-up is disabled', () => {
    companies.current = query({ isSuccess: true, data: { items: [] } });
    start.current = query({ isPending: true });
    company.current = query({});
    render(<RelationshipDiagram />);
    expect(screen.getByText('No companies yet')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
