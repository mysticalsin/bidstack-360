import { describe, expect, it } from 'vitest';

import { opportunityActivity, taskActivity } from './summary-activity.js';

// The dashboard can only say a recent row is late if the summary keeps the
// due date. Dropping it leaves a May follow-up looking like ordinary activity.
describe('summary activity due date', () => {
  it('keeps an open follow-up due date and points at its record', () => {
    const row = taskActivity({
      id: '00000000-0000-4000-8000-000000010001',
      title: 'Submit revised pricing & SoW v2',
      status: 'in_progress',
      createdAt: new Date('2026-05-01T12:00:00.000Z'),
      dueDate: new Date('2026-05-15T00:00:00.000Z'),
    });
    expect(row).toMatchObject({
      type: 'task',
      subtitle: 'in_progress',
      dueDate: '2026-05-15',
      url: '/tasks/00000000-0000-4000-8000-000000010001',
    });
  });

  it('keeps a missing due date as null instead of inventing one', () => {
    const row = taskActivity({
      id: 'task-1',
      title: 'No date',
      status: 'open',
      createdAt: new Date('2026-05-01T12:00:00.000Z'),
      dueDate: null,
    });
    expect(row.dueDate).toBeNull();
  });

  it('keeps a decided bid stage next to its close date so the clock can stop', () => {
    const row = opportunityActivity({
      id: 'opp-won',
      name: 'Aritzia — Endpoint Refresh',
      stage: 'closed_won',
      updatedAt: new Date('2026-04-28T12:00:00.000Z'),
      dueDate: new Date('2026-04-28T00:00:00.000Z'),
    });
    expect(row).toMatchObject({
      type: 'opportunity',
      subtitle: 'closed_won',
      dueDate: '2026-04-28',
      url: '/opportunities/opp-won',
    });
  });
});
