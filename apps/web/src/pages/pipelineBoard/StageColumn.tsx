// Memoized stage column. Re-renders only when its own items change — prevents
// all 5-7 columns from repainting when a drag moves a card between two of them.
import { memo, type DragEvent, type KeyboardEvent } from 'react';

import { AnimatePresence } from 'framer-motion';

import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { Badge, stageTone } from '@/components/ui/Badge';
import { GlassCard } from '@/components/ui/GlassCard';
import { useFormatMoney } from '@/hooks/useFormatMoney';
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
  total: number;
  /** % of opps that have advanced past this stage (excludes closed_lost). */
  conversion: number | null;
  isHoverTarget: boolean;
  draggingId: string | null;
  focusedId: string | null;
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
  stageId: _stageId,
  stageName,
  stageColor: _stageColor,
  items,
  total,
  conversion,
  isHoverTarget,
  draggingId,
  focusedId,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardDragStart,
  onCardDragEnd,
  onCardFocus,
  onCardBlur,
  onCardKey,
}: StageColumnProps) {
  const { formatMoney } = useFormatMoney();
  return (
    <section
      aria-label={`${stageName} column with ${items.length} opportunities`}
      className="min-w-0"
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <Badge tone={stageTone(stageName)}>{stageName}</Badge>
          {conversion !== null ? (
            <span
              title={`${conversion}% of opps in this stage or later have advanced past it`}
              aria-label={`Conversion rate: ${conversion}%`}
              className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-[var(--fg-secondary)]"
            >
              <span aria-hidden>→</span>
              {conversion}%
            </span>
          ) : null}
        </div>
        <span className="text-[10px] text-[var(--fg-tertiary)] tabular-nums">
          <AnimatedNumber value={items.length} duration={0.6} />
          {' · '}
          <AnimatedNumber
            value={total}
            duration={0.7}
            // Use the app's money formatter (source = EUR, like PipelineCard)
            // so the column total honors the selected display currency instead
            // of always rendering euros. Round to whole units so the cents
            // portion doesn't jitter during the tween.
            format={(n) => formatMoney(Math.round(n), 'EUR')}
          />
        </span>
      </div>
      <GlassCard
        padding="none"
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
