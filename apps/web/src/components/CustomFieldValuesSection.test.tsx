// A record's custom fields are the saved values for that company. A failed
// read has no payload. The block used to paint a blank input, or to vanish,
// which is how an empty field set looks.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useCustomFieldDefinitions: vi.fn(),
  useCustomFieldValues: vi.fn(),
  useUpsertCustomFieldValues: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/useCustomFields', () => ({
  useCustomFieldDefinitions: hookMocks.useCustomFieldDefinitions,
  useCustomFieldValues: hookMocks.useCustomFieldValues,
  useUpsertCustomFieldValues: hookMocks.useUpsertCustomFieldValues,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CustomFieldValuesSection } from './CustomFieldValuesSection';

const OFFICE = {
  id: 'field-sample-office',
  label: 'Sample office',
  fieldKey: 'sample_office',
  fieldType: 'text' as const,
  options: [] as string[],
  required: false,
  active: true,
  orderIndex: 0,
};

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <CustomFieldValuesSection entityType="company" entityId="company-demo-1" />,
    { wrapper: Wrapper },
  );
}

function idleSave() {
  hookMocks.useUpsertCustomFieldValues.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
}

describe('CustomFieldValuesSection failed read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not paint a blank field when the saved values did not load', () => {
    // WHY: demo records store a value such as Berlin. A failed values read
    // has no payload. A blank Sample office input says that value was empty,
    // and Save would write the blank over it.
    idleSave();
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: { items: [OFFICE] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    hookMocks.useCustomFieldValues.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });

    renderSection();

    expect(screen.getByRole('alert').textContent).toContain('Could not load saved field values');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByDisplayValue('')).toBeNull();
  });

  it('does not hide the block when the field list did not load', () => {
    // WHY: a missing definition list is not a record with no custom fields.
    // Returning nothing is the same screen as an empty catalog.
    idleSave();
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    hookMocks.useCustomFieldValues.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderSection();

    expect(screen.getByRole('alert').textContent).toContain('Could not load custom fields');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('still shows a saved value once both reads succeed', () => {
    // WHY: a loaded value has to stay on the field. The error copy is only
    // for a read that did not arrive.
    idleSave();
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: { items: [OFFICE] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    hookMocks.useCustomFieldValues.mockReturnValue({
      data: { items: [{ definitionId: OFFICE.id, value: 'Berlin' }] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderSection();

    expect(screen.getByRole('textbox')).toHaveProperty('value', 'Berlin');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still renders nothing when the loaded catalog has no fields', () => {
    // WHY: a settled empty catalog has no fields to fill. Hiding the block
    // is that empty catalog, not a failed read.
    idleSave();
    hookMocks.useCustomFieldDefinitions.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    hookMocks.useCustomFieldValues.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderSection();

    expect(screen.queryByText('Custom Fields')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
