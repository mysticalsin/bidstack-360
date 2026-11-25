// Choosing Michael Johnson in the command palette used to navigate to
// /contacts?search=Michael%20Johnson. ContactsPage never reads `search` from
// the URL, so the palette dropped the reader on the full contact list.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';

import '@/i18n';
import type { Contact } from '@bidstack/shared';

import { CommandPalette } from './CommandPalette';

const MICHAEL_ID = '00000000-0000-4000-8000-000000000001';

const MICHAEL: Contact = {
  id: MICHAEL_ID,
  customer: 'CI Financial',
  name: 'Michael Johnson',
  role: 'Chief Information Officer',
  email: 'mjohnson@ci.com',
  phone: null,
  influence: 5,
  sentiment: 'warm',
  createdAt: '2026-01-01T00:00:00.000Z',
  companyId: '00000000-0000-4000-8000-0000000000aa',
  linkState: 'linked',
};

vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => ({ data: { companies: [] } }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: { items: [MICHAEL], nextCursor: null } }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => ({ data: { items: [] } }),
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

describe('CommandPalette contact hit', () => {
  it('opens Michael Johnson on his record instead of a search the list ignores', () => {
    renderPalette();
    const input = screen.getByRole('combobox', { name: /search across the workspace/i });
    fireEvent.change(input, { target: { value: 'Michael Johnson' } });

    const option = screen.getByRole('option', { name: /Michael Johnson/ });
    fireEvent.click(option);

    // The list ignores ?search=, so the address has to be the record.
    expect(screen.getByTestId('where').textContent).toBe(`/contacts/${MICHAEL_ID}`);
    // The row is keyboard-focusable. A 2px ring is the focus state.
    expect(option.className).toContain('focus-visible:ring-2');
    expect(option.className).toContain('min-h-11');
  });
});
