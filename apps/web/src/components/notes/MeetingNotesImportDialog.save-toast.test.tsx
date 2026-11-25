// The synthetic example lists six products. Those names are folded into one
// enrichment blob. The save toast counted each name as a record, so a note
// that created no contacts, risks, tasks, or compliance still said six
// records were created. The note itself was saved and was not in that count.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeetingNotesImportDialog } from './MeetingNotesImportDialog';
import { toast } from '@/components/ui/Toast';
import type { MeetingNotesImportResponse } from '@bidstack/shared';

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      values
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''))
        : fallback,
  }),
}));

vi.mock('@/hooks/useNotes', () => ({
  useImportMeetingNotes: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const MAPFRE = '11111111-1111-4111-8111-111111111111';

const STACK_ONLY: MeetingNotesImportResponse = {
  note: {
    id: '33333333-3333-4333-8333-333333333333',
    accountId: MAPFRE,
    companyId: MAPFRE,
    title: 'Sample: MAPFRE stack paste',
    bodyMd: 'Tech stack: Microsoft 365, Azure, Okta, CrowdStrike, Jamf Pro, Salesforce',
    pinned: false,
    authorUserId: '44444444-4444-4444-8444-444444444444',
    authorEmail: 'ada@example.com',
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
  },
  extracted: {
    techStack: [],
    contacts: [],
    risks: [],
    compliance: [],
    tasks: [],
    sourceAttribution: [],
  },
  created: {
    contacts: 0,
    risks: 0,
    compliance: 0,
    tasks: 0,
    techStackItems: 6,
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Meeting notes import save line', () => {
  it('does not count extracted tech-stack names as records when only the note was saved', async () => {
    mutateAsync.mockResolvedValue(STACK_ONLY);

    render(
      <MeetingNotesImportDialog accountId={MAPFRE} companyName="MAPFRE" domain="mapfre.example" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import meeting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Process and save' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(
      'Meeting notes imported',
      expect.objectContaining({ description: 'Note saved.' }),
    );
    expect(screen.getByText('Note saved')).toBeTruthy();
    expect(screen.queryByText('6 records')).toBeNull();
    expect(screen.queryByText('6 records were created or refreshed.')).toBeNull();
  });
});
