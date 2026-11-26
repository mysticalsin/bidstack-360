// A paused or in-flight relationships read has no companies yet. A skeleton
// with no status looks like the diagram is off. A failed read must stay on
// the error, including when a stale company or person is still in memory.
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const diagramMocks = vi.hoisted(() => ({
  useInsightCompanies: vi.fn(),
  useCompany: vi.fn(),
}));

vi.mock('@/components/charts/sankey', () => ({
  SankeyChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SankeyLink: () => null,
  SankeyNode: () => null,
  SankeyTooltip: () => null,
}));

vi.mock('@/hooks/useInsightsData', () => ({
  useInsightCompanies: diagramMocks.useInsightCompanies,
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompany: diagramMocks.useCompany,
}));

import { RelationshipDiagram } from './RelationshipDiagram';

const CHECKING_COMPANIES = 'Checking relationships. The companies have not arrived.';
const FAILED_COMPANIES = 'Could not load relationships.';
const CHECKING_PEOPLE = 'Checking people for this company. The people have not arrived.';
const FAILED_PEOPLE = 'Could not load people for this company.';
const EMPTY_COMPANIES = 'No companies yet';
const EMPTY_PEOPLE = 'No contacts linked to this company';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';

interface ReadSnapshot {
  data?: unknown;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  status: string;
  error?: Error | null;
}

function read(partial: Partial<ReadSnapshot> & Pick<ReadSnapshot, 'status'>): ReadSnapshot {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    ...partial,
  };
}

const paused = read({ status: 'pending', isPending: true, isLoading: false });
const inflight = read({ status: 'pending', isPending: true, isLoading: true });
const failed = read({ status: 'error', isError: true, error: new Error('offline') });

function renderDiagram(companies: ReadSnapshot, company: ReadSnapshot = paused) {
  diagramMocks.useInsightCompanies.mockReturnValue({ ...companies, refetch: vi.fn() });
  diagramMocks.useCompany.mockReturnValue({ ...company, refetch: vi.fn() });
  return render(<RelationshipDiagram />);
}

const loadedCompanies = read({
  status: 'success',
  isSuccess: true,
  data: { items: [{ id: COMPANY_ID, name: 'Northwind' }], complete: true },
});

const loadedPerson = read({
  status: 'success',
  isSuccess: true,
  data: {
    name: 'Northwind',
    contacts: [{ id: CONTACT_ID, name: 'Ada Buyer', role: 'Buyer' }],
  },
});

describe('RelationshipDiagram read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused company list as empty', () => {
    // WHY: a paused first read has isLoading false and no companies. A
    // skeleton with no status looks off. The companies have not arrived.
    renderDiagram(paused);

    expect(screen.queryByText(EMPTY_COMPANIES)).toBeNull();
    expect(screen.getAllByText(CHECKING_COMPANIES).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED_COMPANIES)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight company list as empty', () => {
    // WHY: a slow read also has no companies. A skeleton with no status is
    // not a settled empty list, and it is not a failed load.
    renderDiagram(inflight);

    expect(screen.queryByText(EMPTY_COMPANIES)).toBeNull();
    expect(screen.getAllByText(CHECKING_COMPANIES).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED_COMPANIES)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed company list on the error', () => {
    // WHY: a failed read is not evidence that no companies exist. The error
    // stays, and an empty list does not stand in for the read.
    renderDiagram(failed);

    expect(screen.queryByText(EMPTY_COMPANIES)).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED_COMPANIES).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING_COMPANIES)).toBeNull();
  });

  it('lets a failed company list win over a stale company', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Northwind from a list that is no longer the read.
    renderDiagram(
      read({
        status: 'error',
        isError: true,
        error: new Error('offline'),
        data: { items: [{ id: COMPANY_ID, name: 'Northwind' }], complete: true },
      }),
    );

    expect(screen.queryByText('Northwind')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED_COMPANIES).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING_COMPANIES)).toBeNull();
    expect(screen.queryByText(EMPTY_COMPANIES)).toBeNull();
  });

  it('stays empty when a settled company list has no companies', () => {
    // WHY: a read that arrived with no companies stays empty. A slow network
    // must not be dressed up as an empty list, and this one must.
    renderDiagram(
      read({
        status: 'success',
        isSuccess: true,
        data: { items: [], complete: true },
      }),
    );

    expect(screen.getByText(EMPTY_COMPANIES)).toBeTruthy();
    expect(screen.queryByText(CHECKING_COMPANIES)).toBeNull();
    expect(screen.queryByText(FAILED_COMPANIES)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows the company when the list has arrived', () => {
    // WHY: a loaded company stays. The unread line must not replace a name
    // the read already returned.
    renderDiagram(loadedCompanies, loadedPerson);

    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.getByText('Ada Buyer')).toBeTruthy();
    expect(screen.queryByText(CHECKING_COMPANIES)).toBeNull();
    expect(screen.queryByText(CHECKING_PEOPLE)).toBeNull();
    expect(screen.queryByText(FAILED_COMPANIES)).toBeNull();
    expect(screen.queryByText(FAILED_PEOPLE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat a paused people read as missing', () => {
    // WHY: the company list arrived, and the people read has not. A paused
    // people read has isLoading false and no contacts. That is not an empty
    // link list.
    renderDiagram(loadedCompanies, paused);

    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.queryByText(EMPTY_PEOPLE)).toBeNull();
    expect(screen.getAllByText(CHECKING_PEOPLE).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED_PEOPLE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight people read as missing', () => {
    // WHY: a slow people read also has no contacts. A skeleton with no status
    // is not a settled empty link list, and it is not a failed load.
    renderDiagram(loadedCompanies, inflight);

    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.queryByText(EMPTY_PEOPLE)).toBeNull();
    expect(screen.getAllByText(CHECKING_PEOPLE).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED_PEOPLE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed people read on the error', () => {
    // WHY: a failed people read is not evidence that the company has no
    // contacts. The error stays.
    renderDiagram(loadedCompanies, failed);

    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.queryByText(EMPTY_PEOPLE)).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED_PEOPLE).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING_PEOPLE)).toBeNull();
  });

  it('lets a failed people read win over a stale person', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing Ada Buyer from a person that is no longer the read.
    renderDiagram(
      loadedCompanies,
      read({
        status: 'error',
        isError: true,
        error: new Error('offline'),
        data: {
          name: 'Northwind',
          contacts: [{ id: CONTACT_ID, name: 'Ada Buyer', role: 'Buyer' }],
        },
      }),
    );

    expect(screen.getByText('Northwind')).toBeTruthy();
    expect(screen.queryByText('Ada Buyer')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED_PEOPLE).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING_PEOPLE)).toBeNull();
    expect(screen.queryByText(EMPTY_PEOPLE)).toBeNull();
  });

  it('stays empty when a settled people read has no contacts', () => {
    // WHY: a read that arrived with no linked people stays empty. A slow
    // network must not be dressed up as an empty link list, and this one must.
    renderDiagram(
      loadedCompanies,
      read({
        status: 'success',
        isSuccess: true,
        data: { name: 'Northwind', contacts: [] },
      }),
    );

    expect(screen.getByText(EMPTY_PEOPLE)).toBeTruthy();
    expect(screen.queryByText(CHECKING_PEOPLE)).toBeNull();
    expect(screen.queryByText(FAILED_PEOPLE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
