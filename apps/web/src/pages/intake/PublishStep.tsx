/**
 * PublishStep — success screen confirming published extractions.
 * Step 4: shows counts of published solutions/products and offers restart.
 */
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useAccountIntel } from '@/hooks/useAccountIntel';

interface PublishStepProps {
  accountId: string;
  onBack: () => void;
  onDone: () => void;
}

export function PublishStep({ accountId, onBack, onDone }: PublishStepProps) {
  const { t } = useTranslation('crm');
  const intel = useAccountIntel(accountId || undefined);
  const solutions = intel.data?.solutions ?? [];
  const products = intel.data?.products ?? [];
  // A missing snapshot is not an empty publish. Pending and failed reads
  // have no counts yet; only a successful payload may say the catalog is live.
  const countsArrived = intel.isSuccess && intel.data != null;
  const summary = intel.isError
    ? t(
        'publishStep.failed',
        'Could not load the published counts. The saved counts have not arrived.',
      )
    : countsArrived
      ? t(
          'publishStep.summary',
          '{{solutionCount}} solution{{solutionSuffix}} and {{productCount}} product{{productSuffix}} are now live on the account cockpit.',
          {
            solutionCount: solutions.length,
            solutionSuffix: solutions.length === 1 ? '' : 's',
            productCount: products.length,
            productSuffix: products.length === 1 ? '' : 's',
          },
        )
      : t('publishStep.checking', 'Checking the published counts.');

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={
            countsArrived
              ? 'flex h-10 w-10 items-center justify-center rounded-full bg-[var(--success-tint)]'
              : 'flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-sunken)]'
          }
        >
          <Icon
            name={countsArrived ? 'check' : intel.isError ? 'warning' : 'loader'}
            size={20}
            className={countsArrived ? 'text-[var(--success)]' : 'text-[var(--fg-tertiary)]'}
          />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            {countsArrived
              ? t('publishStep.heading', 'Published')
              : intel.isError
                ? t('publishStep.failedHeading', 'Published counts are not loaded')
                : t('publishStep.checkingHeading', 'Checking the published counts')}
          </h2>
          <p className="text-xs text-[var(--fg-secondary)]">{summary}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={onBack}>
          {t('publishStep.backButton', '← Review')}
        </Button>
        <Button onClick={onDone}>{t('publishStep.startNewButton', 'Start new intake')}</Button>
      </div>
    </Card>
  );
}
