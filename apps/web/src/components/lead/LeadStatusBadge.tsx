import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { LeadPriority, LeadStatus } from '@bidstack/shared';

const STATUS_TONE: Record<LeadStatus, BadgeTone> = {
  new: 'blue',
  contacted: 'purple',
  qualified: 'jade',
  nurture: 'teal',
  disqualified: 'gray',
  converted: 'rose',
};

function statusLabel(status: LeadStatus, t: TFunction): string {
  switch (status) {
    case 'new':
      return t('leadStatusBadge.statusNew', 'New');
    case 'contacted':
      return t('leadStatusBadge.statusContacted', 'Contacted');
    case 'qualified':
      return t('leadStatusBadge.statusQualified', 'Qualified');
    case 'nurture':
      return t('leadStatusBadge.statusNurture', 'Nurture');
    case 'disqualified':
      return t('leadStatusBadge.statusDisqualified', 'Disqualified');
    case 'converted':
      return t('leadStatusBadge.statusConverted', 'Converted');
  }
}

function priorityLabel(priority: LeadPriority, t: TFunction): string {
  switch (priority) {
    case 'low':
      return t('leadStatusBadge.priorityLow', 'Low');
    case 'medium':
      return t('leadStatusBadge.priorityMedium', 'Medium');
    case 'high':
      return t('leadStatusBadge.priorityHigh', 'High');
    case 'critical':
      return t('leadStatusBadge.priorityCritical', 'Critical');
  }
}

const PRIORITY_TONE: Record<LeadPriority, BadgeTone> = {
  low: 'gray',
  medium: 'blue',
  high: 'amber',
  critical: 'tomato',
};

interface LeadStatusBadgeProps {
  status: LeadStatus;
}

export function LeadStatusBadge({ status }: LeadStatusBadgeProps) {
  const { t } = useTranslation('crm');
  return <Badge tone={STATUS_TONE[status]}>{statusLabel(status, t)}</Badge>;
}

interface LeadPriorityBadgeProps {
  priority: LeadPriority;
}

export function LeadPriorityBadge({ priority }: LeadPriorityBadgeProps) {
  const { t } = useTranslation('crm');
  return <Badge tone={PRIORITY_TONE[priority]}>{priorityLabel(priority, t)}</Badge>;
}
