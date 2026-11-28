import { describe, expect, it } from 'vitest';
import { Task, TaskStatus, TaskSummary } from './task';

describe('Task schema', () => {
  it('accepts a valid task', () => {
    const result = Task.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      oppId: null,
      title: 'Follow up',
      dueDate: '2024-12-31',
      status: 'open',
      assignee: null,
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  // The list and the record read this name off the task. Create and older
  // payloads omit it. A blank name must not pass, or the UI would render an
  // empty bid link.
  it('keeps the bid name optional and rejects a blank one', () => {
    const base = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      oppId: '00000000-0000-4000-8000-000000020041',
      title: 'Submit revised pricing & SoW v2',
      dueDate: '2026-05-15',
      status: 'in_progress' as const,
      assignee: null,
      createdAt: '2026-05-01T00:00:00.000Z',
    };
    const named = Task.safeParse({
      ...base,
      opportunityName: 'CI Financial — IT Modernization & MSP',
    });
    const omitted = Task.safeParse(base);
    const none = Task.safeParse({ ...base, opportunityName: null });
    const blank = Task.safeParse({ ...base, opportunityName: '   ' });

    expect(named.success).toBe(true);
    if (named.success) {
      expect(named.data.opportunityName).toBe('CI Financial — IT Modernization & MSP');
    }
    expect(omitted.success).toBe(true);
    expect(none.success).toBe(true);
    if (none.success) expect(none.data.opportunityName).toBeNull();
    expect(blank.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = Task.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      title: 'Follow up',
      status: 'unknown',
    });
    expect(result.success).toBe(false);
  });
});

describe('TaskStatus enum', () => {
  it('includes expected values', () => {
    expect(TaskStatus.enum.open).toBe('open');
    expect(TaskStatus.enum.done).toBe('done');
    expect(TaskStatus.enum.in_progress).toBe('in_progress');
    expect(TaskStatus.enum.blocked).toBe('blocked');
  });
});

describe('TaskSummary schema', () => {
  it('keeps navigation badges numeric and non-negative', () => {
    const result = TaskSummary.safeParse({
      total: 12,
      open: 8,
      overdue: 2,
      dueSoon: 4,
    });

    expect(result.success).toBe(true);
  });
});
