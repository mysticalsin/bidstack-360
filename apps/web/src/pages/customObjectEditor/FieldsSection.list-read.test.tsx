// A paused or in-flight field list has no payload yet. The section used
// the same empty sentence as a settled list. The fields have not arrived,
// so that sentence is not a finding.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomObjectField } from '@bidstack/shared';
import type { useAddCustomObjectField, useCustomObjectFields } from '@/hooks/useCustomObjects';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

import { FieldsSection } from './FieldsSection';

const CHECKING = 'Checking fields. The list has not arrived.';
const EMPTY = 'No custom fields yet. Use "Add field" above to create your first one.';
const FAILED = 'Could not load fields. Please retry.';
const LABEL = 'Budget';

const FIELD: CustomObjectField = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  entityType: 'custom_object',
  customObjectDefId: '33333333-3333-4333-8333-333333333333',
  fieldKey: 'budget',
  label: LABEL,
  fieldType: 'currency',
  options: null,
  defaultValue: null,
  required: true,
  orderIndex: 0,
  active: true,
  createdAt: '2026-11-01T15:00:00.000Z',
  updatedAt: '2026-11-01T15:00:00.000Z',
};

type FieldsQuery = ReturnType<typeof useCustomObjectFields>;

function query(partial: Partial<FieldsQuery>): FieldsQuery {
  return partial as FieldsQuery;
}

function renderSection(fieldsQuery: FieldsQuery) {
  return render(
    <FieldsSection
      addField={{ isPending: false, mutateAsync: vi.fn() } as unknown as ReturnType<typeof useAddCustomObjectField>}
      fieldsQuery={fieldsQuery}
    />,
  );
}

function expectNoSettledEmpty() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(LABEL)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
}

describe('FieldsSection unread list', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a paused field read an empty list', async () => {
    // WHY: a paused first read has isLoading false and no payload. The
    // section said no custom fields yet, while the fields have not arrived.
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
    expectNoSettledEmpty();
  });

  it('does not call an in-flight field read an empty list', async () => {
    // WHY: a slow read said only that fields were loading. A list that has
    // not arrived is not an object with no custom fields.
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
    expectNoSettledEmpty();
    expect(screen.queryByText('Loading fields…')).toBeNull();
  });

  it('does not call a failed field read an empty list', async () => {
    // WHY: a failed read is not evidence that the object has no fields.
    // The error stays, and the section does not say the list is empty.
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

  it('still shows a settled object that has no fields', async () => {
    // WHY: an object that arrived with no fields is empty. That sentence
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

  it('still shows a field that has arrived', async () => {
    // WHY: a loaded field stays on the list. The unread line must not
    // replace a field the read already returned.
    renderSection(
      query({
        data: { items: [FIELD] },
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
