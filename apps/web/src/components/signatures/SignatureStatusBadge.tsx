/**
 * Colored badge for all 7 SignatureStatus values.
 *
 * WHY: Centralises tone mapping so every surface (list, detail, timeline)
 * stays consistent without duplicating the colour logic.
 */

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { SignatureStatus } from '@bidstack/shared';

const STATUS_TONE: Record<SignatureStatus, BadgeTone> = {
  DRAFT: 'gray',
  SENT: 'blue',
  VIEWED: 'purple',
  SIGNED: 'jade',
  DECLINED: 'tomato',
  VOIDED: 'amber',
  EXPIRED: 'rose',
};

const STATUS_LABEL: Record<SignatureStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  VIEWED: 'Viewed',
  SIGNED: 'Signed',
  DECLINED: 'Declined',
  VOIDED: 'Voided',
  EXPIRED: 'Expired',
};

interface SignatureStatusBadgeProps {
  status: SignatureStatus;
  className?: string;
}

export function SignatureStatusBadge({ status, className }: SignatureStatusBadgeProps) {
  return (
    <Badge tone={STATUS_TONE[status]} className={className}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
