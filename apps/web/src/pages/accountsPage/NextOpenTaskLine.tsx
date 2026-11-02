import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { NextOpenTask } from '@/hooks/useNextOpenTask';

/**
 * Earliest open task among the accounts in this view. The set is the same
 * company ids as the open book, not one page of cards.
 */
export const NEXT_OPEN_TASK_CAPTION =
  'Earliest open task for accounts in this view. A task counts when its account id is that company, or its deal\'s company id is that company. A matching customer name does not count. A task with no company does not count. Done tasks do not count. The next task is the earliest due date. A task with no due date comes after a dated one.';

export const NEXT_OPEN_TASK_PAGE_CAPTION =
  'Earliest open task on the latest page, not every task for these accounts. A task counts when its account id is that company, or its deal\'s company id is that company. A matching customer name does not count. A task with no company does not count. Done tasks do not count. The next task is the earliest due date. A task with no due date comes after a dated one.';

export function NextOpenTaskLine({
  status,
  hasAccounts,
  task,
  companyName,
  complete,
}: {
  status: 'loading' | 'error' | 'ready';
  hasAccounts: boolean;
  task: NextOpenTask | null;
  companyName?: string | null;
  complete: boolean;
}) {
  const { t } = useTranslation('crm');
  if (status === 'ready' && !hasAccounts) return null;
  if (status === 'loading') {
    return (
      <p className="text-xs text-[var(--fg-secondary)]" data-testid="next-open-task-status">
        {t('accounts.nextTask.loading', 'Loading the next open task for this view.')}
      </p>
    );
  }
  if (status === 'error') {
    return (
      <p className="text-xs text-[var(--fg-secondary)]" role="alert" data-testid="next-open-task-status">
        {t('accounts.nextTask.error', "The next open task didn't load.")}
      </p>
    );
  }

  const caption = complete ? NEXT_OPEN_TASK_CAPTION : NEXT_OPEN_TASK_PAGE_CAPTION;
  const due = task?.dueDate ? `due ${task.dueDate}` : 'no due date';
  const line = task
    ? t('accounts.nextTask.line', 'Next open task{{company}}: {{title}} · {{due}}', {
        company: companyName ? ` for ${companyName}` : '',
        title: task.title,
        due,
      })
    : complete
      ? t('accounts.nextTask.empty', 'No open task for the accounts in this view.')
      : t(
          'accounts.nextTask.emptyPage',
          'No open task on the latest page, not every task for these accounts.',
        );

  return (
    <div className="grid gap-2" data-testid="next-open-task">
      {task ? (
        <Link
          to={`/tasks/${task.id}`}
          data-testid="next-open-task-line"
          className="inline-flex min-h-11 max-w-full items-center rounded-sm text-sm text-[var(--fg-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
        >
          {line}
        </Link>
      ) : (
        <p className="text-sm text-[var(--fg-primary)]" data-testid="next-open-task-line">
          {line}
        </p>
      )}
      <p className="text-xs text-[var(--fg-secondary)]" data-testid="next-open-task-caption">
        {t(complete ? 'accounts.nextTask.caption' : 'accounts.nextTask.pageCaption', caption)}
      </p>
    </div>
  );
}
