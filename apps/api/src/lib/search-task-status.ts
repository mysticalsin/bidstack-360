// Status word under a task on workspace search. The tasks list names the four
// stored values. Anything else stays as stored so search does not invent one.

const TASK_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

export function searchTaskStatusLabel(status: string | null | undefined): string {
  const value = (status ?? '').trim();
  return TASK_STATUS_LABELS[value] ?? value;
}
