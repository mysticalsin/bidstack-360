import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountConversation } from '@bidstack/shared';

vi.mock('@/hooks/useAccountConversations', () => ({
  useAccountConversations: vi.fn(),
  useRefileMeeting: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

import { useAccountConversations, useRefileMeeting } from '@/hooks/useAccountConversations';
import { useHasPermission } from '@/hooks/useCapabilities';

import { AccountConversations } from './AccountConversations';

const COMPANY = '00000000-0000-4000-8000-000000000003';
const OPP_A = '00000000-0000-4000-8000-0000000000a1';
const OPP_B = '00000000-0000-4000-8000-0000000000b2';
const EVENT = '00000000-0000-4000-8000-0000000000e1';
const mutate = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(useHasPermission).mockReturnValue(true);
});

function item(over: Partial<AccountConversation>): AccountConversation {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    type: 'meeting',
    subject: 'Discovery with Acme',
    occurredAt: '2026-11-02T15:00:00.000Z',
    endAt: '2026-11-02T16:00:00.000Z',
    status: 'completed',
    direction: null,
    participantCount: 3,
    source: 'teams',
    sourceLabel: 'Teams',
    channel: 'teams',
    filing: 'automatic',
    needsOpportunity: true,
    opportunity: null,
    sourceRecord: { kind: 'calendar_event', id: EVENT },
    canRefile: true,
    ...over,
  };
}

function withItems(items: AccountConversation[]) {
  vi.mocked(useRefileMeeting).mockReturnValue({ mutate, isPending: false, isError: false } as never);
  vi.mocked(useAccountConversations).mockReturnValue({
    data: {
      pages: [
        {
          companyId: COMPANY,
          items,
          nextCursor: null,
          openOpportunities: [
            { id: OPP_A, name: 'Data platform' },
            { id: OPP_B, name: 'Cloud move' },
          ],
        },
      ],
    },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  } as never);
}

describe('AccountConversations', () => {
  it('shows a source chip and a filing hint on every synced row', () => {
    withItems([
      item({}),
      item({
        id: '00000000-0000-4000-8000-000000000102',
        type: 'email',
        subject: 'Re: scope',
        source: 'outlook',
        sourceLabel: 'Outlook',
        channel: null,
        direction: 'inbound',
        filing: 'manual',
        needsOpportunity: false,
        opportunity: { id: OPP_A, name: 'Data platform' },
        sourceRecord: { kind: 'email_message', id: '00000000-0000-4000-8000-0000000000f1' },
        canRefile: false,
      }),
      item({
        id: '00000000-0000-4000-8000-000000000103',
        subject: 'Lunch logged by hand',
        source: null,
        sourceLabel: 'Logged in Polo',
        channel: null,
        filing: null,
        needsOpportunity: false,
        sourceRecord: null,
        canRefile: false,
      }),
    ]);
    render(<AccountConversations companyId={COMPANY} />);

    expect(screen.getAllByTestId('conversation-source').map((c) => c.textContent)).toEqual([
      'Teams',
      'Outlook',
      'Logged in Polo',
    ]);
    expect(screen.getByText('Filed automatically')).toBeTruthy();
    expect(screen.getByText('Filed by you')).toBeTruthy();
    expect(screen.getByText('Needs opportunity')).toBeTruthy();
    expect(screen.getByText(/Received/)).toBeTruthy();
    // Only the meeting the viewer owns can be re-filed; emails have no re-file route.
    expect(screen.getAllByLabelText('File to opportunity')).toHaveLength(1);
  });

  it('re-files a meeting to another opportunity or back to the account', () => {
    withItems([item({ opportunity: { id: OPP_A, name: 'Data platform' }, needsOpportunity: false })]);
    render(<AccountConversations companyId={COMPANY} />);

    const select = screen.getByLabelText('File to opportunity') as HTMLSelectElement;
    expect(select.className).toContain('pointer-coarse:min-h-11');
    expect(select.className).toContain('pointer-coarse:min-w-11');
    expect(select.value).toBe(OPP_A);
    fireEvent.change(select, { target: { value: OPP_B } });
    expect(mutate).toHaveBeenLastCalledWith({ calendarEventId: EVENT, opportunityId: OPP_B });
    fireEvent.change(select, { target: { value: '' } });
    expect(mutate).toHaveBeenLastCalledWith({ calendarEventId: EVENT, opportunityId: null });
  });

  it('marks cancelled meetings and shows an empty state', () => {
    withItems([item({ status: 'cancelled', canRefile: false })]);
    render(<AccountConversations companyId={COMPANY} />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
    cleanup();

    withItems([]);
    render(<AccountConversations companyId={COMPANY} />);
    expect(screen.getByText('No synced meetings or emails yet.')).toBeTruthy();
  });

  it('shows a filed Teams message with its author and a link back to Teams', () => {
    withItems([
      item({
        type: 'teams_message',
        subject: 'Chat with Jane Doe',
        channel: null,
        filing: 'manual',
        needsOpportunity: false,
        sourceRecord: null,
        canRefile: false,
        author: 'Jane Doe',
        webUrl: 'https://teams.microsoft.com/l/message/19%3Aacme/m2',
      }),
    ]);
    render(<AccountConversations companyId={COMPANY} companyName="Acme" />);
    expect(screen.getByTestId('conversation-source').textContent).toBe('Teams');
    expect(screen.getByText(/Jane Doe · 3 people/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open in Teams' });
    expect(link.getAttribute('href')).toBe('https://teams.microsoft.com/l/message/19%3Aacme/m2');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByLabelText('File to opportunity')).toBeNull();
  });

  it('offers Import from Teams only to people who can write activities', () => {
    withItems([]);
    render(<AccountConversations companyId={COMPANY} />);
    expect(screen.getByRole('button', { name: 'Import from Teams' })).toBeTruthy();
    cleanup();

    vi.mocked(useHasPermission).mockImplementation((p: string) => p === 'activities:read');
    withItems([]);
    render(<AccountConversations companyId={COMPANY} />);
    expect(screen.queryByRole('button', { name: 'Import from Teams' })).toBeNull();
  });

  it('stays out of the page without activities:read', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    withItems([item({})]);
    const { container } = render(<AccountConversations companyId={COMPANY} />);
    expect(container.innerHTML).toBe('');
  });
});
