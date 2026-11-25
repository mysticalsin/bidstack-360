// A blank amount box is not "equals zero". Demo deals store non-zero micros, so
// turning a cleared number filter into 0 makes the preview match nothing and
// look like the book is empty. A typed 0 still has to stay, because that is a
// real filter.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FilterCondition, FilterGroup } from '@/hooks/useAnalyticsReports';
import { buildQuery } from '@/lib/reportQuery';

import { FilterBuilder } from './FilterBuilder';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
}));

function Harness({ onChange }: { onChange: (filters: FilterGroup) => void }) {
  const [value, setValue] = useState<FilterGroup>({ logic: 'AND', conditions: [] });
  return (
    <FilterBuilder
      entity="opportunity"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function renderBuilder(onChange: (filters: FilterGroup) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness onChange={onChange} />
    </QueryClientProvider>,
  );
}

function amountCondition(filters: FilterGroup): FilterCondition {
  const condition = filters.conditions[0];
  if (!condition || 'logic' in condition) throw new Error('expected one amount condition');
  return condition;
}

function addAmountFilter() {
  fireEvent.click(screen.getByRole('button', { name: 'Condition' }));
  fireEvent.click(screen.getByRole('button', { name: 'Field…' }));
  fireEvent.click(screen.getByRole('option', { name: /value/i }));
  return screen.getByRole('spinbutton', { name: /filter numeric value/i });
}

function preview(filters: FilterGroup) {
  return buildQuery({
    entity: 'opportunity',
    filters,
    aggregates: [{ fn: 'SUM', field: 'valueMicros' }],
    groupBy: [{ field: 'stage' }],
    sort: [],
    limit: 100,
  });
}

describe('FilterBuilder numeric value', () => {
  afterEach(() => {
    cleanup();
  });

  it('drops a cleared amount so the preview is not limited to zero-value deals', () => {
    const seen: FilterGroup[] = [];
    renderBuilder((filters) => {
      seen.push(filters);
    });

    const input = addAmountFilter() as HTMLInputElement;
    fireEvent.change(input, { target: { value: '61520' } });
    fireEvent.change(input, { target: { value: '' } });

    const filters = seen.at(-1)!;
    const condition = amountCondition(filters);
    expect(condition.field).toBe('valueMicros');
    expect(condition.value).toBe('');
    expect(preview(filters).filters).toBeUndefined();
  });

  it('keeps a typed zero, which is a real filter and not a blank box', () => {
    const seen: FilterGroup[] = [];
    renderBuilder((filters) => {
      seen.push(filters);
    });

    const input = addAmountFilter() as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });

    const filters = seen.at(-1)!;
    expect(amountCondition(filters).value).toBe(0);
    expect(preview(filters).filters?.conditions).toEqual([
      expect.objectContaining({ field: 'valueMicros', operator: 'eq', value: 0 }),
    ]);
  });
});
