function isoDate(due: Date | null): string | null {
  return due ? due.toISOString().slice(0, 10) : null;
}

export function taskActivity(task: {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  dueDate: Date | null;
}) {
  return {
    type: 'task' as const,
    title: task.title,
    subtitle: task.status,
    date: task.createdAt.toISOString(),
    url: `/tasks/${task.id}`,
    dueDate: isoDate(task.dueDate),
  };
}

export function opportunityActivity(opportunity: {
  id: string;
  name: string;
  stage: string;
  updatedAt: Date;
  dueDate: Date | null;
}) {
  return {
    type: 'opportunity' as const,
    title: opportunity.name,
    subtitle: opportunity.stage,
    date: opportunity.updatedAt.toISOString(),
    url: `/opportunities/${opportunity.id}`,
    dueDate: isoDate(opportunity.dueDate),
  };
}
