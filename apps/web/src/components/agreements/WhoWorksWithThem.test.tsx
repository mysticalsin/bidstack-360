// The relationship map is the "who works with them" read. An unread or failed
// payload is not an empty group. "No one in the group works with them yet" is
// only a read that arrived with no work rows.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RelationshipMap } from '@bidstack/shared';

const mapState = vi.hoisted(() => ({
  data: undefined as RelationshipMap | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

vi.mock('@/hooks/useMsaWhitespace', () => ({
  useRelationshipMap: () => mapState,
}));

import { WhoWorksWithThem } from './WhoWorksWithThem';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const AFFILIATE = '33333333-3333-4333-8333-333333333333';

function emptyMap(): RelationshipMap {
  return {
    companyId: COMPANY,
    companies: [
      { id: COMPANY, name: 'Northwind', relation: 'self', country: 'US' },
      { id: AFFILIATE, name: 'Northwind Labs', relation: 'affiliate', country: 'GB' },
    ],
    entities: [],
    people: [],
    rows: [],
    lines: [],
    countries: ['US'],
  };
}

function workedMap(): RelationshipMap {
  return {
    ...emptyMap(),
    rows: [
      {
        kind: 'msa',
        id: 'a0000000-0000-4000-8000-000000000001',
        label: 'Northwind master',
        companyId: COMPANY,
        companyName: 'Northwind',
        entity: 'Northwind Signing',
        line: 'digital',
        owner: { id: OWNER, name: 'Ada North' },
        lastActivityAt: '2026-10-01T00:00:00.000Z',
        valueMicros: null,
        currency: null,
        country: 'US',
      },
    ],
  };
}

function renderPanel() {
  return render(<WhoWorksWithThem companyId={COMPANY} />);
}

afterEach(() => {
  mapState.data = undefined;
  mapState.isLoading = false;
  mapState.isError = false;
  mapState.refetch.mockClear();
  cleanup();
});

describe('who works with them read', () => {
  it('does not call an unread relationship map an empty group', () => {
    // WHY: the payload has not arrived. isLoading can still be false while the
    // read is pending. "No one in the group" would say the account has no
    // owners when the map simply has not loaded.
    mapState.data = undefined;
    mapState.isLoading = false;
    mapState.isError = false;

    renderPanel();

    expect(screen.queryByText('No one in the group works with them yet.')).toBeNull();
    expect(screen.queryByText('Northwind Labs')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('has not arrived');
  });

  it('does not call a loading relationship map an empty group', () => {
    // WHY: a skeleton with the empty sentence still tells the reader the group
    // is empty. The sentence is only for a settled read.
    mapState.isLoading = true;

    renderPanel();

    expect(screen.queryByText('No one in the group works with them yet.')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('has not arrived');
  });

  it('does not call a failed relationship map an empty group', () => {
    // WHY: a failed read is not proof that nobody works with the account.
    // Retry asks for the same map. It does not invent an empty group.
    mapState.isError = true;

    renderPanel();

    expect(screen.queryByText('No one in the group works with them yet.')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't load who works with them.");
    expect(alert.textContent).toContain('has not arrived');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('min-h-11');
    expect(retry.className).toContain('focus-visible:outline-2');
    fireEvent.click(retry);
    expect(mapState.refetch).toHaveBeenCalledTimes(1);
  });

  it('says the group is empty only after a settled read with no work rows', () => {
    // WHY: empty is a result. It is the read that arrived and listed no MSA,
    // opportunity, project, or revenue. Affiliates can still be named.
    mapState.data = emptyMap();

    renderPanel();

    expect(screen.getByText('No one in the group works with them yet.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('who-works-with-them-family').textContent).toContain('Northwind Labs');
  });

  it('shows the people once the relationship map arrives', () => {
    mapState.data = workedMap();

    renderPanel();

    expect(screen.getByText('Ada North')).toBeTruthy();
    expect(screen.getByText('Northwind Signing')).toBeTruthy();
    expect(screen.queryByText('No one in the group works with them yet.')).toBeNull();
    expect(screen.queryByText(/has not arrived/)).toBeNull();
  });
});
