/**
 * ui/DueDateChip.tsx — shared bid-clock urgency indicator (A1).
 *
 * WHY: dueDate exists on every Opportunity but no surface signalled urgency —
 * a bid due tomorrow looked identical to one due in 90 days. Deadline
 * slippage is the #1 preventable bid loss. Every surface that shows an
 * opportunity's dueDate should render THIS instead of a bare formatted date.
 *
 * Non-interactive by design: this is a high-frequency surface (kanban board,
 * table rows) so it carries no animation and no click target. Editing due
 * dates stays on the existing inline-edit controls (DateCell / InlineEditDate)
 * — mount this chip alongside them, not instead of them, wherever the date is
 * still editable.
 */
import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';

export type DueDateUrgency = 'none' | 'neutral' | 'warning' | 'danger';

export interface DueDateUrgencyInfo {
  urgency: DueDateUrgency;
  tone: BadgeTone;
  /** Whole days until due (negative = overdue). Null when there is no dueDate. */
  days: number | null;
}

// Warning window matches the widest threshold the bid-deadline-alerts worker
// already alerts on (apps/worker/src/queues/bid-deadline-alerts.helpers.ts's
// DEADLINE_THRESHOLD_DAYS) — the UI chip and the background alert agree on
// what "soon" means.
const WARNING_WINDOW_DAYS = 7;

/**
 * Whole calendar days from `now` to `dueDateIso`, UTC-bounded. dueDate is a
 * Postgres `date` (midnight UTC, no zone) — comparing on the UTC day (not raw
 * elapsed ms) keeps "today" / "7 days out" stable across the viewer's local
 * timezone and time-of-day. Mirrors
 * apps/worker/src/queues/bid-deadline-alerts.helpers.ts's daysUntilDue;
 * duplicated (not imported) because apps/web cannot depend on apps/worker.
 */
export function daysUntilDueUtc(dueDateIso: string, now: Date = new Date()): number {
  const due = new Date(dueDateIso);
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((dueDay - nowDay) / 86_400_000);
}

/**
 * Urgency tone + day count for a dueDate. Exported so tests assert the
 * boundary math directly instead of parsing rendered/localized DOM text —
 * a mis-tinted urgency (e.g. an overdue bid reading "neutral") reads to a
 * bid lead as "we're fine" when the deadline has already passed, which is
 * exactly the missed-submission failure mode this feature exists to prevent.
 */
export function dueDateUrgency(
  dueDateIso: string | null,
  now: Date = new Date(),
): DueDateUrgencyInfo {
  if (!dueDateIso) return { urgency: 'none', tone: 'gray', days: null };
  const days = daysUntilDueUtc(dueDateIso, now);
  if (days < 0) return { urgency: 'danger', tone: 'tomato', days };
  if (days <= WARNING_WINDOW_DAYS) return { urgency: 'warning', tone: 'amber', days };
  return { urgency: 'neutral', tone: 'gray', days };
}

export interface DueDateChipProps {
  dueDate: string | null;
  /** sm = kanban card / dense table cell. md = default. lg = detail-page header. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASS: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'gap-0.5 px-1.5 py-0 text-[9px]',
  md: 'gap-1 px-2 py-0.5 text-[11px]',
  lg: 'gap-1.5 px-3 py-1 text-xs',
};

const ICON_SIZE: Record<'sm' | 'md' | 'lg', number> = { sm: 10, md: 12, lg: 13 };

export function DueDateChip({ dueDate, size = 'md', className }: DueDateChipProps) {
  const { t } = useTranslation('crm');
  const { tone, days } = dueDateUrgency(dueDate);

  const label =
    days === null
      ? t('dueDateChip.noDate', 'No date')
      : days < 0
        ? t('dueDateChip.overdueBy', '{{count}}d overdue', { count: Math.abs(days) })
        : days === 0
          ? t('dueDateChip.dueToday', 'Due today')
          : t('dueDateChip.daysLeft', '{{count}}d left', { count: days });

  // Absolute date carried in aria-label — the visible relative label ("4d
  // left") is itself text (not color alone, WCAG 1.4.1), but it drifts in
  // meaning between when the page was rendered and when it's read aloud;
  // the absolute date does not.
  const ariaLabel = dueDate
    ? t('dueDateChip.ariaLabel', 'Due {{date}}', { date: formatDate(dueDate) })
    : t('dueDateChip.ariaLabelNoDate', 'No due date set');

  return (
    <Badge tone={tone} aria-label={ariaLabel} className={cn('font-medium', SIZE_CLASS[size], className)}>
      <Icon name="clock" size={ICON_SIZE[size]} strokeWidth={2} />
      {label}
    </Badge>
  );
}
