/**
 * Colored badge for all 7 SignatureStatus values.
 *
 * WHY: Centralises tone mapping so every surface (list, detail, timeline)
 * stays consistent without duplicating the colour logic.
 */

import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { SignatureStatus } from '@bidstack/shared';

type TFunction = ReturnType<typeof useTranslation>['t'];

const STATUS_TONE: Record<SignatureStatus, BadgeTone> = {
  DRAFT: 'gray',
  SENT: 'blue',
  VIEWED: 'purple',
  SIGNED: 'jade',
  DECLINED: 'tomato',
  VOIDED: 'amber',
  EXPIRED: 'rose',
};

function getStatusLabel(status: SignatureStatus, t: TFunction): string {
  const labels: Record<SignatureStatus, string> = {
    DRAFT: t('signatureStatusBadge.statusDraft', 'Draft'),
    SENT: t('signatureStatusBadge.statusSent', 'Sent'),
    VIEWED: t('signatureStatusBadge.statusViewed', 'Viewed'),
    SIGNED: t('signatureStatusBadge.statusSigned', 'Signed'),
    DECLINED: t('signatureStatusBadge.statusDeclined', 'Declined'),
    VOIDED: t('signatureStatusBadge.statusVoided', 'Voided'),
    EXPIRED: t('signatureStatusBadge.statusExpired', 'Expired'),
  };
  return labels[status];
}

interface SignatureStatusBadgeProps {
  status: SignatureStatus;
  className?: string;
}

export function SignatureStatusBadge({ status, className }: SignatureStatusBadgeProps) {
  const { t } = useTranslation('signatures');
  return (
    <Badge tone={STATUS_TONE[status]} className={className}>
      {getStatusLabel(status, t)}
    </Badge>
  );
}
