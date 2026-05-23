import { describe, expect, it } from 'vitest';
import { Task, TaskStatus } from './task';

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
