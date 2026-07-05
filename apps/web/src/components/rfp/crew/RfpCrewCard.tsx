// A single crew-member card on the RFP crew board. Draggable (pointer +
// keyboard) so the user can re-station an agent at a different pipeline stage.
// Status reflects the live pipeline: waiting → working (spinner) → done (check);
// oversight members (Bid Director master, Executive Sponsor) read "overseeing".

import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import type { IconName } from '@/components/ui/Icon';
import type { RfpCrewMember } from './rfpCrew';

export type CrewStatus = 'waiting' | 'working' | 'done' | 'overseeing';

// Theme tokens only — --success/--warning resolve per theme (deep in light,
// pastel in dark), so no dark: mirrors and no raw palette classes.
const STATUS_META: Record<CrewStatus, { dot: string; text: string }> = {
  waiting: { dot: 'bg-[var(--fg-tertiary)]', text: 'text-[var(--fg-tertiary)]' },
  working: {
    dot: 'bg-[var(--brand-primary)]',
    text: 'text-[var(--brand-primary)]',
  },
  done: { dot: 'bg-[var(--success)]', text: 'text-[var(--success-fg)]' },
  overseeing: {
    dot: 'bg-[var(--warning)]',
    text: 'text-[var(--warning-fg)]',
  },
};

interface Props {
  member: RfpCrewMember;
  status: CrewStatus;
  draggable?: boolean;
  selected?: boolean;
  onSelect: (member: RfpCrewMember) => void;
  /** Keyboard re-station: -1 = previous stage, +1 = next stage. */
  onMove?: (key: string, dir: -1 | 1) => void;
}

export function RfpCrewCard({
  member,
  status,
  draggable = true,
  selected,
  onSelect,
  onMove,
}: Props) {
  const { t } = useTranslation('rfp');
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: member.key,
    disabled: !draggable,
  });
  const meta = STATUS_META[status];
  const statusLabel: Record<CrewStatus, string> = {
    waiting: t('rfpCrew.statusWaiting', 'Waiting'),
    working: t('rfpCrew.statusWorking', 'Working'),
    done: t('rfpCrew.statusDone', 'Done'),
    overseeing: t('rfpCrew.statusOverseeing', 'Overseeing'),
  };

  return (
    <article
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn(
        'group relative rounded-xl border bg-[var(--surface-card)] p-3 text-left transition-colors',
        'border-[var(--border-subtle)]',
        member.isMaster && 'border-[var(--warning)]/40',
        selected && 'ring-2 ring-[var(--brand-primary)]',
        isDragging && 'opacity-60 shadow-lg',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
            member.isMaster
              ? 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]'
              : 'bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]',
          )}
        >
          <Icon name={member.icon as IconName} size={18} ariaHidden />
        </span>

        <div className="min-w-0 flex-1">
          {/* Drag handle is the title row; the whole header is grabbable. */}
          <button
            type="button"
            onClick={() => onSelect(member)}
            className="block w-full truncate rounded-sm text-left text-sm font-semibold text-[var(--fg-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
            aria-label={t('rfpCrew.viewRoleDetailsAria', '{{role}} — view role details', {
              role: member.role,
            })}
          >
            {member.role}
          </button>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
              {member.department}
            </span>
            <span
              className={cn('inline-flex items-center gap-1 text-[11px] font-medium', meta.text)}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  meta.dot,
                  status === 'working' && 'animate-pulse',
                )}
              />
              {statusLabel[status]}
            </span>
          </div>
        </div>

        {/* Pointer/keyboard drag grip — own listeners so click-to-open still works. */}
        {draggable && (
          <div
            {...listeners}
            {...attributes}
            role="button"
            tabIndex={0}
            aria-label={t(
              'rfpCrew.moveToStageAria',
              'Move {{role}} to another stage. Use left and right arrow keys.',
              { role: member.role },
            )}
            onKeyDown={(e) => {
              if (!onMove) return;
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                onMove(member.key, 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                onMove(member.key, -1);
              }
            }}
            className="grid h-8 w-8 shrink-0 cursor-grab place-items-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-secondary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand-primary)] active:cursor-grabbing"
          >
            <Icon name="sliders" size={14} ariaHidden />
          </div>
        )}
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-[var(--fg-secondary)]">{member.goal}</p>

      <div className="mt-2 flex flex-wrap gap-1">
        {member.skills.slice(0, 3).map((skill) => (
          <span
            key={skill}
            className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] text-[var(--fg-tertiary)]"
          >
            {skill}
          </span>
        ))}
      </div>
    </article>
  );
}
