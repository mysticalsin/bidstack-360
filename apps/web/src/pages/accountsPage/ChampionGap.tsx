import { useTranslation } from 'react-i18next';

/**
 * Accepted champions among the accounts in this view. The set is the filtered
 * view, the same company ids as the open book, not one page of cards.
 */
export const CHAMPION_GAP_CAPTION =
  'Accepted champions in this view. A champion is an accepted buying-role fact on a deal linked to that company, from a contact at that company. A matching customer name does not count. A contact with no company does not count. A suggested or dismissed fact does not count.';

export function ChampionGap({
  status,
  accounts,
  missing,
}: {
  status: 'loading' | 'error' | 'ready';
  accounts: number;
  missing: number;
}) {
  const { t } = useTranslation('crm');
  if (status === 'ready' && accounts === 0) return null;
  if (status === 'loading') {
    return (
      <p className="text-xs text-[var(--fg-secondary)]" data-testid="champion-gap-status">
        {t('accounts.championGap.loading', 'Counting accepted champions in this view.')}
      </p>
    );
  }
  if (status === 'error') {
    return (
      <p className="text-xs text-[var(--fg-secondary)]" role="alert" data-testid="champion-gap-status">
        {t('accounts.championGap.error', "The accepted-champion count didn't load.")}
      </p>
    );
  }

  const countLine =
    missing === 0
      ? t('accounts.championGap.none', 'Every account in this view has an accepted champion.')
      : missing === 1
        ? t(
            'accounts.championGap.missing_one',
            '{{count}} account in this view has no accepted champion.',
            { count: missing },
          )
        : t(
            'accounts.championGap.missing_other',
            '{{count}} accounts in this view have no accepted champion.',
            { count: missing },
          );

  return (
    <div className="grid gap-2" data-testid="champion-gap">
      <p className="text-sm text-[var(--fg-primary)]">{countLine}</p>
      <p className="text-xs text-[var(--fg-secondary)]" data-testid="champion-gap-caption">
        {t('accounts.championGap.caption', CHAMPION_GAP_CAPTION)}
      </p>
    </div>
  );
}
