// WHY: demo account notes are stored on the company id (accountId and companyId
// are the company UUID — see seedConsultingPartners). The contact page asked
// /api/notes for the customer display name, so Carmen at MAPFRE read "No notes"
// beside "Sample: MAPFRE IT steering debrief". A linked contact has to ask for
// that company, and the sentence under the title is what the note is for.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ContactDetailPage } from './ContactDetailPage';
import { useNotes } from '@/hooks/useNotes';

const MAPFRE = '11111111-1111-4111-8111-111111111111';
const STEERING =
  'The MAPFRE CIO office said our delivery quality is better than Accenture on the claims platform.';

vi.mock('@/hooks/useContacts', () => ({
  useContact: vi.fn(() => ({
    isLoading: false,
    isError: false,
    data: {
      id: 'c-mapfre',
      customer: 'MAPFRE',
      name: 'Carmen Sample',
      role: 'Identity Architect',
      email: null,
      phone: null,
      influence: null,
      sentiment: null,
      createdAt: '2026-01-15T00:00:00.000Z',
      companyId: MAPFRE,
      linkState: 'linked',
    },
  })),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({ data: { items: [], nextCursor: null } })),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: vi.fn(() => ({ data: { items: [] } })),
}));

vi.mock('@/hooks/useNotes', () => ({
  useNotes: vi.fn(() => ({
    data: {
      items: [
        {
          id: 'n-steering',
          accountId: MAPFRE,
          companyId: MAPFRE,
          title: 'Sample: MAPFRE IT steering debrief',
          bodyMd: STEERING,
          pinned: false,
          authorUserId: 'u-1',
          authorEmail: 'ada@example.com',
          createdAt: '2026-11-05T00:00:00.000Z',
          updatedAt: '2026-11-05T00:00:00.000Z',
        },
        {
          id: 'n-blank',
          accountId: MAPFRE,
          companyId: MAPFRE,
          title: 'Sample: title only',
          bodyMd: '   ',
          pinned: false,
          authorUserId: 'u-1',
          authorEmail: null,
          createdAt: '2026-11-04T00:00:00.000Z',
          updatedAt: '2026-11-04T00:00:00.000Z',
        },
      ],
    },
  })),
}));

vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));

vi.mock('react-router-dom', async () => {
  const actual = (await vi.importActual('react-router-dom')) as Record<string, unknown>;
  return { ...actual, useParams: () => ({ id: 'c-mapfre' }) };
});

describe('ContactDetailPage account notes', () => {
  afterEach(() => cleanup());

  it('asks for the linked company and shows the note body under the title', () => {
    render(
      <MemoryRouter>
        <ContactDetailPage />
      </MemoryRouter>,
    );

    expect(vi.mocked(useNotes).mock.calls[0]?.[0]).toBe(MAPFRE);
    expect(vi.mocked(useNotes).mock.calls[0]?.[1]).toEqual({ companyId: MAPFRE });
    expect(screen.getByText('Sample: MAPFRE IT steering debrief')).toBeTruthy();
    expect(screen.getByText(STEERING)).toBeTruthy();
    expect(screen.getByText('Sample: title only')).toBeTruthy();
    expect(screen.queryByText('   ')).toBeNull();
  });
});
