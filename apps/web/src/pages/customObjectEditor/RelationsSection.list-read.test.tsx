// A paused or in-flight relation list has no payload yet. The section used
// the same blank as a missing list. The relations have not arrived, so that
// blank is not a finding.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomObjectRelation } from '@bidstack/shared';
import type { useAddCustomObjectRelation, useCustomObjectRelations } from '@/hooks/useCustomObjects';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

import { RelationsSection } from './RelationsSection';

const CHECKING = 'Checking relations. The list has not arrived.';
const EMPTY = 'No relations defined yet.';
const FAILED = 'Could not load relations.';
const LABEL = 'Buying center';

const RELATION: CustomObjectRelation = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  customObjectDefId: '33333333-3333-4333-8333-333333333333',
  relationKey: 'buying_center',
  label: LABEL,
  relatedEntityType: 'contact',
  cardinality: 'ONE_TO_MANY',
  required: false,
  junctionTableSchema: null,
  createdAt: '2026-11-01T15:00:00.000Z',
  updatedAt: '2026-11-01T15:00:00.000Z',
};

type RelationsQuery = ReturnType<typeof useCustomObjectRelations>;

function query(partial: Partial<RelationsQuery>): RelationsQuery {
  return partial as RelationsQuery;
}

function renderSection(relationsQuery: RelationsQuery) {
  return render(
    <RelationsSection
      addRelation={{ isPending: false, mutateAsync: vi.fn() } as unknown as ReturnType<typeof useAddCustomObjectRelation>}
      relationsQuery={relationsQuery}
    />,
  );
}

function expectNoSettledMiss() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(LABEL)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
}

describe('RelationsSection unread list', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a paused relation read a missing list', async () => {
    // WHY: a paused first read has isLoading false and no payload. The
    // section rendered nothing, while the relations have not arrived.
    renderSection(
      query({
        data: undefined,
        isError: false,
        isLoading: false,
        status: 'pending',
        fetchStatus: 'paused',
      }),
    );

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call an in-flight relation read a missing list', async () => {
    // WHY: a slow read rendered nothing, the same blank as a missing list.
    // A list that has not arrived is not an object with no relations.
    renderSection(
      query({
        data: undefined,
        isError: false,
        isLoading: true,
        status: 'pending',
        fetchStatus: 'fetching',
      }),
    );

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a failed relation read a missing list', async () => {
    // WHY: a failed read is not evidence that the object has no relations.
    // The error stays, and the section does not go blank.
    renderSection(
      query({
        data: undefined,
        isError: true,
        isLoading: false,
        status: 'error',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('still shows a settled object that has no relations', async () => {
    // WHY: an object that arrived with no relations is empty. That sentence
    // stays, so a real empty list is not dressed up as a slow network.
    renderSection(
      query({
        data: { items: [] },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('still shows a relation that has arrived', async () => {
    // WHY: a loaded relation stays on the list. The unread line must not
    // replace a relation the read already returned.
    renderSection(
      query({
        data: { items: [RELATION] },
        isError: false,
        isLoading: false,
        status: 'success',
        fetchStatus: 'idle',
      }),
    );

    expect(await screen.findByText(LABEL)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
