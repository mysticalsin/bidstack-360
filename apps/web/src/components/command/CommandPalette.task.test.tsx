// Choosing "Submit revised pricing & SoW v2" in the command palette used to
// navigate to /tasks?search=Submit%20revised%20pricing%20%26%20SoW%20v2.
// TasksPage reads filter, sort, and view. It does not read `search`, so the
// palette dropped the reader on the full follow-up list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';

import '@/i18n';
import type { Task } from '@bidstack/shared';

import { CommandPalette } from './CommandPalette';

// Demo follow-up on OP-2041. Synthetic assignee is not a real person.
const PRICING_ID = '00000000-0000-4000-8000-000000010001';

const PRICING: Task = {
  id: PRICING_ID,
  oppId: '00000000-0000-4000-8000-000000000041',
  title: 'Submit revised pricing & SoW v2',
  dueDate: '2026-05-15',
  status: 'in_progress',
  assignee: null,
  createdAt: '2026-05-01T00:00:00.000Z',
};

vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => ({ data: { companies: [] } }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: { items: [], nextCursor: null } }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => ({ data: { items: [PRICING], nextCursor: null } }),
}));

vi.mock('@/components/company/CompanyLogo', () => ({
  CompanyLogo: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ items: [], total: 0, query: '' })),
}));

vi.mock('@/hooks/useAppModules', () => ({
  useAppModules: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => false,
}));

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CommandPalette open onOpenChange={() => undefined} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe('CommandPalette task hit', () => {
  it('opens the demo follow-up on its record instead of a search the list ignores', () => {
    renderPalette();
    const input = screen.getByRole('combobox', { name: /search across the workspace/i });
    fireEvent.change(input, { target: { value: 'Submit revised pricing' } });

    const option = screen.getByRole('option', { name: /Submit revised pricing & SoW v2/ });
    fireEvent.click(option);

    // The list ignores ?search=, so the address has to be the record.
    expect(screen.getByTestId('where').textContent).toBe(`/tasks/${PRICING_ID}`);
    expect(screen.getByTestId('where').textContent).not.toContain('search=');
    // The row is a 44px target. The shared palette shell already sets that.
    expect(option.className).toContain('min-h-11');
  });
});
