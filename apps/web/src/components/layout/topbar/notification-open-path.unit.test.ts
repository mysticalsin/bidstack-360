import { describe, expect, it } from 'vitest';

import { notificationOpenPath } from './notification-open-path';

const DEMO_TASK_ID = '00000000-0000-4000-8000-000000010001';

describe('notificationOpenPath', () => {
  it('keeps a task record URL and a list filter', () => {
    // WHY: a scan that already stored the record path, and a shared overdue
    // filter, must not be rewritten into a second path.
    expect(notificationOpenPath(`/tasks/${DEMO_TASK_ID}?due=2026-11-25`)).toBe(
      `/tasks/${DEMO_TASK_ID}?due=2026-11-25`,
    );
    expect(notificationOpenPath('/tasks?filter=overdue')).toBe('/tasks?filter=overdue');
  });

  it('does not treat a non-uuid taskId as a record id', () => {
    // WHY: the query is only a dedupe marker when the id is a task uuid.
    // Anything else stays a path the server named.
    expect(notificationOpenPath('/tasks?taskId=../admin&due=2026-11-25')).toBe(
      '/tasks?taskId=../admin&due=2026-11-25',
    );
    expect(notificationOpenPath('/opportunities/opp_demo_1')).toBe('/opportunities/opp_demo_1');
    expect(notificationOpenPath(null)).toBeNull();
  });
});
