import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { ActivityTimelineCard } from './ActivityTimelineCard';

const TASK_ID = '00000000-0000-4000-8000-000000010001';

function cockpit(body: string): AccountCockpitSnapshot {
  return {
    recentActivity: [
      {
        id: TASK_ID,
        source: 'external_crm',
        subject: 'Submit revised pricing & SoW v2',
        body,
        kind: 'task',
        companyId: null,
        dealId: 'opp-1',
        personId: null,
        actorName: 'Jordan',
        occurredAt: '2026-05-01T12:00:00.000Z',
      },
    ],
  } as AccountCockpitSnapshot;
}

describe('ActivityTimelineCard follow-up', () => {
  afterEach(cleanup);

  it('opens a late follow-up on its own record and says it is late', () => {
    // WHY: the account cockpit listed "Submit revised pricing & SoW v2" as
    // plain text. The demo due date is 15 May 2026, so on a later day the
    // row has to say the follow-up is late and open /tasks/:id.
    render(
      <MemoryRouter>
        <ActivityTimelineCard
          cockpit={cockpit('Task is in progress. Overdue: 194d late.')}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /Submit revised pricing & SoW v2/ });
    expect(link.getAttribute('href')).toBe(`/tasks/${TASK_ID}`);
    expect(link.textContent).toContain('Overdue: 194d late.');
    expect(link.className).toContain('focus-visible:ring-2');
  });

  it('leaves a note that is not a follow-up as text', () => {
    render(
      <MemoryRouter>
        <ActivityTimelineCard
          cockpit={
            {
              recentActivity: [
                {
                  id: 'note-1',
                  source: 'external_crm',
                  subject: 'Kickoff notes',
                  body: 'Met the buying group.',
                  kind: 'note',
                  companyId: null,
                  dealId: null,
                  personId: null,
                  actorName: null,
                  occurredAt: '2026-05-02T12:00:00.000Z',
                },
              ],
            } as AccountCockpitSnapshot
          }
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Kickoff notes')).toBeTruthy();
  });
});
