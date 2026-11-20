import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      opts ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts[k] ?? '')) : fallback,
  }),
}));
vi.mock('@/components/ai/MeetingPrepCard', () => ({ MeetingPrepCard: () => null }));
vi.mock('./DeadlinesRow', () => ({ DeadlinesRow: () => null }));

import { AgendaList } from './AgendaList';
import { EventPanel } from './EventPanel';
import { TimeGrid } from './TimeGrid';
import type { CalendarEvent } from './types';

const TZ = 'UTC';

function event(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1',
    subject: 'Standup',
    startAt: '2026-03-10T09:00:00Z',
    endAt: '2026-03-10T09:15:00Z',
    location: null,
    isAllDay: false,
    syncState: 'SYNCED',
    provider: 'google_workspace',
    createdAt: '2026-03-01T00:00:00Z',
    contactId: null,
    companyId: null,
    opportunityId: null,
    localOnly: false,
    ...over,
  };
}

const conference = event({
  id: 'conf',
  subject: 'Conference',
  startAt: '2026-03-09T09:00:00Z',
  endAt: '2026-03-10T17:00:00Z',
});

afterEach(() => cleanup());

describe('TimeGrid event targets', () => {
  it('keeps short meetings selectable: 24px floor on fine pointers, 44px on coarse pointers', () => {
    render(
      <TimeGrid
        keys={['2026-03-10']}
        tz={TZ}
        events={[event({})]}
        todayKey="2026-03-09"
        showDeadlines={false}
        onSlot={() => {}}
        onSelect={() => {}}
      />,
    );
    const button = screen.getByTestId('calendar-event');
    expect(parseFloat(button.style.height)).toBeGreaterThanOrEqual(24);
    expect(button.className).toContain('pointer-coarse:min-h-11');
  });
});

describe('multi-day timed events', () => {
  it('shows real start and end times and the time zone in the panel', () => {
    render(
      <MemoryRouter>
        <EventPanel event={conference} tz={TZ} onClose={() => {}} />
      </MemoryRouter>,
    );
    const panel = screen.getByTestId('calendar-event-panel');
    expect(panel.textContent).toMatch(/0?9:00( AM)? to (17|5):00( PM)?, UTC/);
    expect(panel.textContent).not.toContain('All day');
  });

  it('shows real times in the agenda', () => {
    render(
      <AgendaList keys={['2026-03-09', '2026-03-10']} tz={TZ} events={[conference]} todayKey="2026-03-01" onSelect={() => {}} />,
    );
    const agenda = screen.getByTestId('calendar-agenda');
    expect(agenda.textContent).toMatch(/0?9:00( AM)? to (17|5):00( PM)?/);
    expect(agenda.textContent).not.toContain('All day');
  });

  it('still labels a true all-day event as all day', () => {
    render(
      <MemoryRouter>
        <EventPanel
          event={event({ isAllDay: true, startAt: '2026-03-10T00:00:00Z', endAt: '2026-03-11T00:00:00Z' })}
          tz={TZ}
          onClose={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('calendar-event-panel').textContent).toContain('All day');
  });
});
