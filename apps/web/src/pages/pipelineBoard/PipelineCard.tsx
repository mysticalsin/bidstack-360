// Memoized kanban card. Re-renders only when its own opp or drag/focus state
// changes — prevents the whole column from repainting when a sibling card moves.
import { memo, type KeyboardEvent } from 'react';

import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { DueDateChip, dueDateUrgency } from '@/components/ui/DueDateChip';
import { Icon } from '@/components/ui/Icon';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springLayout } from '@/lib/motion';
import { cn } from '@/lib/cn';
import type { Opportunity } from '@bidstack/shared';

import { getStageName } from './pipelineUtils';

interface PipelineCardProps {
  opp: Opportunity;
  isDragging: boolean;
  isFocused: boolean;
  /**
   * opportunities:write — false withholds drag/keyboard move affordances
   * (the card stays fully viewable and navigable, just not draggable).
   * Optional + defaults true so any other future caller without RBAC
   * context keeps today's behavior.
   */
  canWrite?: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onFocus: (id: string) => void;
  onBlur: (id: string) => void;
  onKey: (e: KeyboardEvent<HTMLAnchorElement>, opp: Opportunity) => void;
}

export const PipelineCard = memo(function PipelineCard({
  opp,
  isDragging,
  isFocused,
  canWrite = true,
  onDragStart,
  onDragEnd,
  onFocus,
  onBlur,
  onKey,
}: PipelineCardProps) {
  const { t } = useTranslation('crm');
  const reduced = useReducedMotion();
  const { formatMoney } = useFormatMoney();
  const stageName = getStageName(opp);
  // Derived from the chip's UTC-day-bucketed urgency — NOT a raw datetime
  // compare, which flagged "due today" as overdue for the whole day while the
  // DueDateChip below said "Due today". Tint/aria-label must agree with the chip.
  const isStalled =
    dueDateUrgency(opp.dueDate).urgency === 'danger' &&
    stageName !== 'Closed Won' &&
    stageName !== 'Closed Lost';

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{
        opacity: isDragging ? 0.5 : 1,
        y: 0,
        scale: isDragging ? 1.02 : 1,
      }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
      whileHover={reduced || isDragging ? undefined : { y: -2 }}
      transition={springLayout}
    >
      <Link
        to={`/opportunities/${opp.id}`}
        data-testid="pipeline-card"
        data-opportunity-id={opp.id}
        draggable={canWrite}
        onDragStart={(e) => {
          if (!canWrite) return;
          e.dataTransfer.setData('text/plain', opp.id);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(opp.id);
        }}
        onDragEnd={onDragEnd}
        onFocus={() => onFocus(opp.id)}
        onBlur={() => onBlur(opp.id)}
        onKeyDown={(e) => onKey(e, opp)}
        aria-roledescription={canWrite ? 'draggable opportunity' : undefined}
        aria-label={
          // Base label + an ", overdue" suffix so the past-due state reaches
          // screen-reader users — color alone fails WCAG 1.4.1 (Use of Color).
          // The "use arrows to move" hint only applies when the signed-in
          // user actually holds opportunities:write.
          (canWrite
            ? t(
                'crm.pipelineCardAriaLabel',
                '{{code}}: {{name}}, {{stage}}, {{value}}. Use left or right arrows to move stage.',
                {
                  code: opp.code,
                  name: opp.name,
                  stage: stageName,
                  value: formatMoney(opp.value, 'EUR'),
                },
              )
            : t('crm.pipelineCardAriaLabelReadOnly', '{{code}}: {{name}}, {{stage}}, {{value}}.', {
                code: opp.code,
                name: opp.name,
                stage: stageName,
                value: formatMoney(opp.value, 'EUR'),
              })) + (isStalled ? t('crm.pipelineCardOverdueSuffix', ', overdue') : '')
        }
        className={cn(
          'block rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 shadow-[var(--shadow-xs)] transition-shadow hover:shadow-[var(--shadow-sm)]',
          canWrite ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          isFocused &&
            'ring-2 ring-offset-1 ring-[var(--brand-primary)] ring-offset-[var(--surface-page)]',
          isStalled && 'border-red-300/40 bg-red-50/40 dark:border-red-900/30 dark:bg-red-950/20',
        )}
      >
        {/* Company name + value */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-semibold text-[var(--fg-primary)] truncate">
            {opp.customer}
          </span>
          <span className="tabular-nums text-[11px] font-bold text-[var(--fg-primary)] shrink-0">
            {formatMoney(opp.value, 'EUR')}
          </span>
        </div>

        {/* Opportunity title */}
        <div className="mt-1 text-xs font-medium text-[var(--fg-secondary)] line-clamp-2">
          {opp.name}
        </div>

        {/* Territory badge */}
        {opp.territoryName && (
          <div className="mt-1.5">
            <Badge tone="teal" className="text-[9px] px-1.5 py-0">
              {opp.territoryName}
            </Badge>
          </div>
        )}

        {/* Activity row */}
        <div className="mt-2 flex items-center gap-3 text-[var(--fg-tertiary)]">
          <span
            className="inline-flex items-center gap-0.5 text-[10px]"
            title={t('crm.pipelineCardViews', 'Views')}
          >
            <Icon name="eye" size={12} strokeWidth={2} />
            <span className="tabular-nums">{opp.viewCount ?? 0}</span>
          </span>
          <span
            className="inline-flex items-center gap-0.5 text-[10px]"
            title={t('crm.pipelineCardComments', 'Comments')}
          >
            <Icon name="messageCircle" size={12} strokeWidth={2} />
            <span className="tabular-nums">{opp.commentCount ?? 0}</span>
          </span>
          <span
            className="inline-flex items-center gap-0.5 text-[10px]"
            title={t('crm.pipelineCardTasks', 'Tasks')}
          >
            <Icon name="checkCircle" size={12} strokeWidth={2} />
            <span className="tabular-nums">{opp.taskCount ?? 0}</span>
          </span>
        </div>

        {/* Due-date urgency + code. Replaces the old bare date — a bid due in
            3 days looked identical to one due in 90 days before this. This is
            now the card's ONLY overdue signal (icon+text, not aria-hidden —
            WCAG 1.4.1) — a separate static "Overdue" badge used to render
            alongside it, duplicating the same state as two tomato pills. */}
        <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--fg-tertiary)]">
          <DueDateChip dueDate={opp.dueDate} size="sm" />
          <span className="font-mono">{opp.code}</span>
        </div>
      </Link>
    </motion.li>
  );
});
