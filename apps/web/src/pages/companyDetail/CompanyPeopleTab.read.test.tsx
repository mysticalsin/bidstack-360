// A paused or in-flight deal catalog has no pages yet. The tab offered the
// newest 200 deals, which is how a settled catalog of that size looks.
// The full list has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: hookMocks.useQuery,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const text = fallback ?? key;
      if (!values) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/components/people/AccountPeopleSection', () => ({
  AccountPeopleSection: ({ deals }: { deals: Array<{ id: string; name: string }> }) => (
    <ul>
      {deals.map((deal) => (
        <li key={deal.id}>{deal.name}</li>
      ))}
    </ul>
  ),
}));

import { CompanyPeopleTab } from './CompanyPeopleTab';
import { RELATED_CAP } from './relatedCount';

const CHECKING = 'Checking every deal. The full list has not arrived.';
const FAILED = `Could not load every deal. Only the ${RELATED_CAP} most recent are listed.`;
const COMPANY = '11111111-1111-4111-8111-111111111111';

function deal(index: number) {
  return { id: `opp-${index}`, name: `Deal ${index}` };
}

const capped = Array.from({ length: RELATED_CAP }, (_, index) => deal(index));

function renderTab(
  opportunities: Array<{ id: string; name: string }>,
  read: { data?: unknown; isError?: boolean; status?: string },
) {
  hookMocks.useQuery.mockReturnValue({
    data: read.data,
    isError: read.isError ?? false,
    isLoading: false,
    status: read.status ?? 'pending',
    refetch: vi.fn(),
  });
  render(<CompanyPeopleTab companyId={COMPANY} opportunities={opportunities} />);
}

function names() {
  return screen.queryAllByRole('listitem').map((item) => item.textContent);
}

describe('CompanyPeopleTab deal catalog read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused deal catalog as the newest deals', () => {
    // WHY: a paused first read has isLoading false and no pages. The newest
    // 200 deals are the cap, not the catalog. This one has not arrived.
    renderTab(capped, { data: undefined, isError: false, status: 'pending' });

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(names()).toEqual([]);
    expect(screen.queryByText('Deal 0')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight deal catalog as the newest deals', () => {
    // WHY: a slow read also has no pages, and isLoading can stay false.
    // The newest deals must not stand in for a read that is still running.
    renderTab(capped, { data: undefined, isError: false, status: 'pending' });

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(names()).toEqual([]);
    expect(screen.queryByText('Deal 0')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed deal catalog on the error', () => {
    // WHY: a failed read is not an unread pause and not a full catalog.
    // The newest deals stay only with the error that names the cap.
    renderTab(capped, { data: undefined, isError: true, status: 'error' });

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(names()).toEqual(capped.map((item) => item.name));
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed status win over a stale catalog', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // the previous full list.
    renderTab(capped, {
      data: { items: [{ id: 'stale', name: 'Stale expansion' }] },
      isError: false,
      status: 'error',
    });

    expect(screen.queryByText('Stale expansion')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(names()).toEqual(capped.map((item) => item.name));
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('drops a stale catalog when the read is in error', () => {
    // WHY: isError wins even when a previous page is still in data.
    // That page is not the settled catalog.
    renderTab(capped, {
      data: { items: [{ id: 'stale', name: 'Stale expansion' }] },
      isError: true,
      status: 'error',
    });

    expect(screen.queryByText('Stale expansion')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(names()).toEqual(capped.map((item) => item.name));
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays on the newest deals when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is
    // not a failed load, and it is not still checking.
    renderTab(capped, { data: null, isError: false, status: 'success' });

    expect(names()).toEqual(capped.map((item) => item.name));
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays empty when a settled catalog has no deals', () => {
    // WHY: an empty list has arrived. Unread must not replace that settled
    // miss with the newest deals, and the miss must not say the load failed.
    renderTab(capped, { data: { items: [] }, isError: false, status: 'success' });

    expect(names()).toEqual([]);
    expect(screen.queryByText('Deal 0')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps the detail deals when the catalog read is off', () => {
    // WHY: under the cap there is no catalog read. A disabled query has no
    // data. That must not say the full list is still loading.
    renderTab([deal(1), deal(2)], { data: undefined, isError: false, status: 'pending' });

    expect(names()).toEqual(['Deal 1', 'Deal 2']);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows a loaded catalog, including a blank name', () => {
    // WHY: a loaded catalog is the deal list. Unread must not drop it, and
    // a blank name is still a loaded deal.
    renderTab(capped, {
      data: {
        items: [
          { id: 'named', name: 'Northwind renewal' },
          { id: 'blank', name: '' },
        ],
      },
      isError: false,
      status: 'success',
    });

    expect(names()).toEqual(['Northwind renewal', '']);
    expect(screen.queryByText('Deal 0')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
