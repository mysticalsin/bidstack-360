// A paused or in-flight opportunity filter read has no rules yet. The section
// said the load failed. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useOpportunityFilters: vi.fn(),
  useUpdateOpportunityFilters: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useOpportunityFilters', () => ({
  useOpportunityFilters: hookMocks.useOpportunityFilters,
  useUpdateOpportunityFilters: hookMocks.useUpdateOpportunityFilters,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { OpportunityFiltersSection } from './OpportunityFiltersSection';

const CHECKING = 'Checking opportunity filters. The rules have not arrived.';
const FAILED = 'Could not load filter rules';
const NONE = 'No opportunity filters are saved.';
const EXPERTISE = 'Expertise types to include';
const SAVE = 'Save filter rules';

function rules(expertise: string[], excludeNonFramework = false) {
  return {
    includeExpertiseTypes: expertise,
    includeSolutionTypes: expertise.length === 0 ? ['Cloud'] : ['Data'],
    frameworkAgreementTypes: ['HEMA'],
    excludeNonFramework,
  };
}

function fieldValue(label: string): string {
  const labelEl = screen.getByText(label);
  const input = labelEl.parentElement?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`No input for ${label}`);
  }
  return input.value;
}

function renderFilters(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useOpportunityFilters.mockReturnValue(query);
  hookMocks.useUpdateOpportunityFilters.mockReturnValue({
    isPending: false,
    mutate: vi.fn(),
  });
  render(<OpportunityFiltersSection />);
}

describe('OpportunityFiltersSection read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused opportunity filter read as a failed load', () => {
    // WHY: a paused first read has isLoading false and no rules. Could not
    // load is the error. This read has not arrived.
    renderFilters({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again shortly.')).toBeNull();
    expect(screen.queryByText(EXPERTISE)).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight opportunity filter read as a failed load', () => {
    // WHY: a slow read also has no rules, and isLoading can stay false.
    // The load error must not stand in for a read that is still running.
    renderFilters({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again shortly.')).toBeNull();
    expect(screen.queryByText(EXPERTISE)).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed opportunity filter read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error.
    renderFilters({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('filters down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('filters down')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByText(EXPERTISE)).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
  });

  it('lets a failed read win over stale filter rules', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // form, and it must not show the stale expertise list.
    renderFilters({
      data: rules(['Cybersecurity'], true),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('filters down'),
    });

    expect(screen.queryByText(EXPERTISE)).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load.
    renderFilters({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(NONE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again shortly.')).toBeNull();
    expect(screen.queryByText(EXPERTISE)).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows loaded opportunity filters', () => {
    // WHY: a loaded payload stays. The unread line must not replace rules
    // the read already returned.
    renderFilters({
      data: rules(['Cybersecurity'], true),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(fieldValue(EXPERTISE)).toBe('Cybersecurity');
    expect(
      (screen.getByRole('checkbox') as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows loaded opportunity filters when the expertise list is empty', () => {
    // WHY: an empty expertise list is loaded data. Unread must not drop the
    // rules because one field is blank.
    renderFilters({
      data: rules([], false),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(fieldValue(EXPERTISE)).toBe('');
    expect(fieldValue('Solution types to include')).toBe('Cloud');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });
});
