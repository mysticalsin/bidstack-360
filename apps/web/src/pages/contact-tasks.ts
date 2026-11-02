/** Tasks shown for a contact. The list route returns one page, not a total. */
export const CONTACT_TASK_PAGE_LIMIT = 50;

/**
 * Task caption. `pageContinues` means the route loaded one extra row past this
 * page, so the related rows are not every follow-up. A short page keeps the
 * old count.
 */
export function contactTaskCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${count} related in the latest ${CONTACT_TASK_PAGE_LIMIT} tasks, not every task`;
  }
  return `${count} related`;
}

/** Empty task list. A continuing page is not proof that no follow-up exists. */
export function contactTaskEmpty(pageContinues: boolean): string {
  if (pageContinues) {
    return `No related tasks in the latest ${CONTACT_TASK_PAGE_LIMIT} tasks, not every task.`;
  }
  return 'No related tasks.';
}
