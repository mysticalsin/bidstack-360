// Visual distinction between the two account concepts (demo-feedback M5):
// Top account  = manually curated global top-10  → trophy + amber.
// Key account  = regional strategic account      → star + purple (brand tone).
// Use these everywhere both concepts can appear so they are never confused.

import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';

export function TopAccountBadge({ rank }: { rank?: number | null }) {
  const { t } = useTranslation('crm');
  return (
    <Badge tone="amber">
      <Icon name="trophy" size={11} ariaHidden />
      {rank
        ? t('accountTierBadges.topRanked', 'Top #{{rank}}', { rank })
        : t('accountTierBadges.top', 'Top')}
    </Badge>
  );
}

export function KeyAccountBadge() {
  const { t } = useTranslation('crm');
  return (
    <Badge tone="purple">
      <Icon name="star" size={11} ariaHidden />
      {t('accountTierBadges.key', 'Key')}
    </Badge>
  );
}
