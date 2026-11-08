import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ContactDetailPage } from './ContactDetailPage';
import { useOpportunities } from '@/hooks/useOpportunities';

vi.mock('@/hooks/useContacts', () => ({
  useContact: vi.fn(() => ({
    isLoading: false,
    isError: false,
    data: {
      id: 'c-1',
      customer: 'Globex',
      name: 'Hank Scorpio',
      role: 'CEO',
      email: null,
      phone: null,
      influence: null,
      sentiment: null,
      createdAt: new Date().toISOString(),
      companyId: null,
      linkState: 'needs_review',
    },
  })),
}));
vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({
    data: {
      items: [
        { id: 'o-1', code: 'OP-1', name: 'Globex deal', customer: 'Globex', stage: 'qualify', probability: 20 },
        { id: 'o-2', code: 'OP-2', name: 'Globex Labs deal', customer: 'Globex Labs', stage: 'qualify', probability: 20 },
      ],
      nextCursor: null,
    },
  })),
}));
vi.mock('@/hooks/useTasks', () => ({ useTasks: vi.fn(() => ({ data: { items: [] } })) }));
vi.mock('@/hooks/useNotes', () => ({ useNotes: vi.fn(() => ({ data: { items: [] } })) }));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'c-1' }) };
});

describe('ContactDetailPage related opportunities', () => {
  afterEach(() => cleanup());

  it('asks the server for this customer instead of filtering the first page of all deals', () => {
    render(
      <MemoryRouter>
        <ContactDetailPage />
      </MemoryRouter>,
    );
    const filters = vi.mocked(useOpportunities).mock.calls.map((c) => c[0]);
    expect(filters.some((f) => f?.search === 'Globex')).toBe(true);
    expect(screen.getByText('OP-1')).toBeTruthy();
    expect(screen.queryByText('OP-2')).toBeNull();
  });
});
