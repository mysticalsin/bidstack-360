// The tasks list reads filter, sort, and view from the URL. It does not read
// `search`, so `/tasks?search=<title>` opens the unfiltered book. A follow-up
// opens on its own record. The title is not an address.
import { describe, expect, it } from 'vitest';

import { taskRecordPath } from './task-record-path';

// Demo follow-up on OP-2041 (packages/db/src/seed-data.tasks-leads.ts).
const PRICING = '00000000-0000-4000-8000-000000010001';

describe('taskRecordPath', () => {
  it('opens the demo follow-up on /tasks/:id, not a search the list ignores', () => {
    // WHY: "Submit revised pricing & SoW v2" is a synthetic demo task. Choosing
    // it from the palette must land on that record. A title search is not an
    // address, and two follow-ups can share a title.
    expect(taskRecordPath(PRICING)).toBe(`/tasks/${PRICING}`);
    expect(taskRecordPath(PRICING)).not.toContain('search=');
    expect(taskRecordPath(PRICING)).not.toContain('Submit');
  });

  it('keeps a slash inside one path segment', () => {
    // WHY: the id is data. A raw slash would address a different route.
    expect(taskRecordPath('a/b')).toBe('/tasks/a%2Fb');
    expect(taskRecordPath('../admin')).toBe('/tasks/..%2Fadmin');
  });
});
