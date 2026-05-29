// Click-to-cycle status order. Mirrors Apple Reminders: tap to complete /
// undo. Click on the row's status badge cycles forwards.
// Kept in a plain .ts file so TaskRow.tsx remains component-only and
// satisfies react-refresh/only-export-components.
import type { TaskStatus } from '@bidstack/shared';

export const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
  blocked: 'open',
};
