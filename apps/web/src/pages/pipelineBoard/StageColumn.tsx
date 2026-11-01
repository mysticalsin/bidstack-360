// Memoized stage column. Re-renders only when its own items change — prevents
// all 5-7 columns from repainting when a drag moves a card between two of them.
import { memo, type DragEvent, type KeyboardEvent } from 'react';

import { AnimatePresence } from 'framer-motion';

import { Badge, stageTone } from '@/components/ui/Badge';
import { GlassCard } from '@/components/ui/GlassCard';
import { unspecifiedMicrosLabel } from '@/components/dashboard/unspecified-currency';
import { cn } from '@/lib/cn';
import { springSnap } from '@/lib/motion';
import type { Opportunity } from '@bidstack/shared';

import { PipelineCard } from './PipelineCard';

interface StageColumnProps {
  stageId: string;
  stageName: string;
  /** Reserved for future per-stage colour theming. */
  stageColor: string | null;
  items: Opportunity[];
  /** Sum of the cards in this column, as integer micros. */
  totalMicros: string;
  isHoverTarget: boolean;
  draggingId: string | null;
  focusedId: string | null;
  /** opportunities:write — false hides drag/keyboard move affordances on every card. */
  canWrite: boolean;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onCardDragStart: (id: string) => void;
  onCardDragEnd: () => void;
  onCardFocus: (id: string) => void;
  onCardBlur: (id: string) => void;
  onCardKey: (e: KeyboardEvent<HTMLAnchorElement>, opp: Opportunity) => void;
}

export const StageColumn = memo(function StageColumn({
  stageId,
  stageName,
  stageColor: _stageColor,
  items,
  totalMicros,
  isHoverTarget,
  draggingId,
  focusedId,
  canWrite,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardDragStart,
  onCardDragEnd,
  onCardFocus,
  onCardBlur,
  onCardKey,
}: StageColumnProps) {
  return (
    <section
      aria-label={
        items.length === 1
          ? `${stageName} column with 1 opportunity`
          : `${stageName} column with ${items.length} opportunities`
      }
      data-testid="pipeline-column"
      data-stage-id={stageId}
      data-stage-name={stageName}
      className="min-w-0"
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <Badge tone={stageTone(stageName)}>{stageName}</Badge>
        </div>
        <span className="text-[10px] text-[var(--fg-tertiary)] tabular-nums">
          {items.length}
          {' · '}
          {unspecifiedMicrosLabel(totalMicros)}
        </span>
      </div>
      <GlassCard
        padding="none"
        data-testid="pipeline-column-dropzone"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        animate={{
          backgroundColor: isHoverTarget ? 'var(--brand-primary-tint)' : 'rgba(0,0,0,0)',
          borderColor: isHoverTarget ? 'var(--brand-primary)' : 'var(--border-subtle)',
        }}
        transition={springSnap}
        className={cn(
          'min-h-[200px] border border-[var(--border-subtle)] bg-[var(--surface-sunken-alpha)]',
          isHoverTarget &&
            'ring-2 ring-[var(--brand-primary)] ring-offset-2 ring-offset-[var(--surface-page)]',
        )}
      >
        <ul className="space-y-2 p-1.5">
          <AnimatePresence initial={false}>
            {items.map((o) => (
              <PipelineCard
                key={o.id}
                opp={o}
                isDragging={draggingId === o.id}
                isFocused={focusedId === o.id}
                canWrite={canWrite}
                onDragStart={onCardDragStart}
                onDragEnd={onCardDragEnd}
                onFocus={onCardFocus}
                onBlur={onCardBlur}
                onKey={onCardKey}
              />
            ))}
          </AnimatePresence>
          {items.length === 0 ? (
            <li className="flex h-32 items-center justify-center rounded-xl border border-dashed border-[var(--border-subtle)] p-4 text-[10px] font-medium text-[var(--fg-tertiary)] uppercase tracking-widest">
              Drop here
            </li>
          ) : null}
        </ul>
      </GlassCard>
    </section>
  );
});
