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

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  nurture: 'Nurture',
  disqualified: 'Disqualified',
  converted: 'Converted',
};

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
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

interface LeadPriorityBadgeProps {
  priority: LeadPriority;
}

export function LeadPriorityBadge({ priority }: LeadPriorityBadgeProps) {
  return (
    <Badge tone={PRIORITY_TONE[priority]}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
}
