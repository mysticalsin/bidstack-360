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

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--success-tint)]">
          <Icon name="check" size={20} className="text-[var(--success)]" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('publishStep.heading', 'Published')}
          </h2>
          <p className="text-xs text-[var(--fg-secondary)]">
            {t(
              'publishStep.summary',
              '{{solutionCount}} solution{{solutionSuffix}} and {{productCount}} product{{productSuffix}} are now live on the account cockpit.',
              {
                solutionCount: solutions.length,
                solutionSuffix: solutions.length === 1 ? '' : 's',
                productCount: products.length,
                productSuffix: products.length === 1 ? '' : 's',
              },
            )}
          </p>
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
