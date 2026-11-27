const TASK_DETAIL_STATUSES = ['open', 'in_progress', 'done', 'blocked'] as const;

type TaskDetailStatus = (typeof TASK_DETAIL_STATUSES)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface TaskDetailRecord {
  title: string;
  status: string;
  dueDate: string | null;
}

export interface TaskDetailDraft {
  title: string;
  status: string;
  /** Empty string clears the due day. Anything else must be YYYY-MM-DD. */
  dueDate: string;
}

export interface TaskDetailPatch {
  title?: string;
  status?: TaskDetailStatus;
  dueDate?: string | null;
}

function isStatus(value: string): value is TaskDetailStatus {
  return (TASK_DETAIL_STATUSES as readonly string[]).includes(value);
}

/**
 * Fields the follow-up record should PATCH.
 *
 * The editor can rename, change status, and move the due day. A draft that
 * matches the record sends nothing, so a rename does not also reschedule.
 * An empty date clears the day. A value that is not a calendar day is not a
 * date change.
 */
export function taskDetailPatch(task: TaskDetailRecord, draft: TaskDetailDraft): TaskDetailPatch {
  const patch: TaskDetailPatch = {};
  if (draft.title !== task.title) patch.title = draft.title;
  if (draft.status !== task.status && isStatus(draft.status)) patch.status = draft.status;
  if (draft.dueDate === '') {
    if (task.dueDate !== null) patch.dueDate = null;
  } else if (DATE_ONLY.test(draft.dueDate) && draft.dueDate !== task.dueDate) {
    patch.dueDate = draft.dueDate;
  }
  return patch;
}
