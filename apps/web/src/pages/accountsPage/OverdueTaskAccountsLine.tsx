import { useTranslation } from 'react-i18next';

/**
 * Accounts in this view that already have an overdue open task.
 * Same company ids as the next open task. One line.
 */
export function OverdueTaskAccountsLine({
  status,
  hasAccounts,
  accounts,
  complete,
}: {
  status: 'loading' | 'error' | 'ready';
  hasAccounts: boolean;
  accounts: number;
  complete: boolean;
}) {
  const { t } = useTranslation('crm');
  if (status === 'ready' && !hasAccounts) return null;
  if (status === 'loading') {
    return (
      <p className="text-xs text-[var(--fg-secondary)]" data-testid="overdue-task-accounts-status">
        {t(
          'accounts.overdueTasks.loading',
          'Counting accounts in this view with an overdue open task.',
        )}
      </p>
    );
  }
  if (status === 'error') {
    return (
      <p
        className="text-xs text-[var(--fg-secondary)]"
        role="alert"
        data-testid="overdue-task-accounts-status"
      >
        {t('accounts.overdueTasks.error', "The overdue open task count didn't load.")}
      </p>
    );
  }

  const line = !complete
    ? accounts === 1
      ? t(
          'accounts.overdueTasks.page_one',
          '1 account on the latest page already has an overdue open task, not every account in this view.',
        )
      : accounts === 0
        ? t(
            'accounts.overdueTasks.page_none',
            'No account on the latest page has an overdue open task, not every account in this view.',
          )
        : t(
            'accounts.overdueTasks.page_other',
            '{{count}} accounts on the latest page already have an overdue open task, not every account in this view.',
            { count: accounts },
          )
    : accounts === 1
      ? t(
          'accounts.overdueTasks.count_one',
          '1 account in this view already has an overdue open task.',
        )
      : accounts === 0
        ? t('accounts.overdueTasks.none', 'No account in this view has an overdue open task.')
        : t(
            'accounts.overdueTasks.count_other',
            '{{count}} accounts in this view already have an overdue open task.',
            { count: accounts },
          );

  return (
    <p className="text-sm text-[var(--fg-primary)]" data-testid="overdue-task-accounts">
      {line}
    </p>
  );
}
