import { describe, expect, it } from 'vitest';

import { taskDetailPatch } from './task-detail-patch';

// Demo follow-up "Submit revised pricing & SoW v2" is due 15 May 2026. The
// record's editor could rename it and cycle its status, and the save omitted
// the date, so the late day stayed put. A title-only save must not also send
// the date. An empty date clears it. A value that is not a calendar day is
// not a date change.
const PRICING = {
  title: 'Submit revised pricing & SoW v2',
  status: 'in_progress',
  dueDate: '2026-05-15',
};

describe('taskDetailPatch', () => {
  it('moves the May demo follow-up to a new due day and leaves the rest', () => {
    expect(
      taskDetailPatch(PRICING, {
        title: PRICING.title,
        status: PRICING.status,
        dueDate: '2026-12-01',
      }),
    ).toEqual({ dueDate: '2026-12-01' });
  });

  it('clears the due day when the date field is emptied', () => {
    expect(
      taskDetailPatch(PRICING, {
        title: PRICING.title,
        status: PRICING.status,
        dueDate: '',
      }),
    ).toEqual({ dueDate: null });
  });

  it('does not reschedule when the save only renames the follow-up', () => {
    expect(
      taskDetailPatch(PRICING, {
        title: 'Submit revised pricing & SoW v3',
        status: PRICING.status,
        dueDate: PRICING.dueDate,
      }),
    ).toEqual({ title: 'Submit revised pricing & SoW v3' });
  });

  it('sends nothing when the draft matches the record, including a missing date', () => {
    expect(
      taskDetailPatch(PRICING, {
        title: PRICING.title,
        status: PRICING.status,
        dueDate: PRICING.dueDate,
      }),
    ).toEqual({});
    expect(
      taskDetailPatch(
        { title: 'Call the buyer', status: 'open', dueDate: null },
        { title: 'Call the buyer', status: 'open', dueDate: '' },
      ),
    ).toEqual({});
  });

  it('ignores a due value that is not a calendar day', () => {
    expect(
      taskDetailPatch(PRICING, {
        title: PRICING.title,
        status: PRICING.status,
        dueDate: '15 May 2026',
      }),
    ).toEqual({});
  });
});
