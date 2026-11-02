import { useTranslation } from 'react-i18next';

/**
 * Accounts in this view that have gone quiet.
 * Same company ids as the open book. One line.
 */
export function QuietAccountsLine({
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
      <p className="text-xs text-[var(--fg-secondary)]" data-testid="quiet-accounts-status">
        {t('accounts.quiet.loading', 'Counting accounts in this view that have gone quiet.')}
      </p>
    );
  }
  if (status === 'error') {
    return (
      <p
        className="text-xs text-[var(--fg-secondary)]"
        role="alert"
        data-testid="quiet-accounts-status"
      >
        {t('accounts.quiet.error', "The quiet account count didn't load.")}
      </p>
    );
  }

  const line = !complete
    ? accounts === 1
      ? t(
          'accounts.quiet.page_one',
          '1 account on the latest page has gone quiet, not every account in this view.',
        )
      : accounts === 0
        ? t(
            'accounts.quiet.page_none',
            'No account on the latest page has gone quiet, not every account in this view.',
          )
        : t(
            'accounts.quiet.page_other',
            '{{count}} accounts on the latest page have gone quiet, not every account in this view.',
            { count: accounts },
          )
    : accounts === 1
      ? t('accounts.quiet.count_one', '1 account in this view has gone quiet.')
      : accounts === 0
        ? t('accounts.quiet.none', 'No account in this view has gone quiet.')
        : t('accounts.quiet.count_other', '{{count}} accounts in this view have gone quiet.', {
            count: accounts,
          });

  return (
    <p className="text-sm text-[var(--fg-primary)]" data-testid="quiet-accounts">
      {line}
    </p>
  );
}
