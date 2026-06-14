// Sprint 1 — Krayin import.
// Kanban view of the Leads list. Columns = LeadStatus enum values. Drag a
// card between columns to change a lead's status — same audit log + Dust
// push fire as the list view's inline status edit. Cards show a "Rot"
// badge when the lead has sat in its status longer than the per-status
// threshold (configured in Settings → Lead rot rules, with defaults from
// @bidstack/shared/LEAD_ROT_DEFAULTS).

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { LeadPriorityBadge, LeadStatusBadge } from '@/components/lead/LeadStatusBadge';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { useLeadRotConfig, useRecoverySuggest } from '@/hooks/useLeadRot';
import { useUpdateLeadById } from '@/hooks/useLeads';
import {
  LEAD_ROT_DEFAULTS,
  type LeadStatus,
  type LeadSummary,
  type RecoveryPlay,
} from '@bidstack/shared';

const COLUMNS: { status: LeadStatus; label: string }[] = [
  { status: 'new', label: 'New' },
  { status: 'contacted', label: 'Contacted' },
  { status: 'qualified', label: 'Qualified' },
  { status: 'nurture', label: 'Nurture' },
  { status: 'disqualified', label: 'Disqualified' },
  { status: 'converted', label: 'Converted' },
];

interface Props {
  leads: LeadSummary[];
}

export function LeadKanbanView({ leads }: Props) {
  const { t } = useTranslation('crm');
  const { data: rotConfig } = useLeadRotConfig();
  const update = useUpdateLeadById();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const rotByStatus = useMemo(() => {
    const m = new Map<LeadStatus, number | null>(
      (Object.keys(LEAD_ROT_DEFAULTS) as LeadStatus[]).map((s) => [s, LEAD_ROT_DEFAULTS[s]]),
    );
    for (const r of rotConfig?.items ?? []) {
      m.set(r.status, r.rottenDays);
    }
    return m;
  }, [rotConfig?.items]);

  const byStatus = useMemo(() => {
    const m = new Map<LeadStatus, LeadSummary[]>();
    for (const col of COLUMNS) m.set(col.status, []);
    for (const lead of leads) {
      m.get(lead.status)?.push(lead);
    }
    // Sort each column by most-recent activity first (statusChangedAt desc).
    for (const arr of m.values()) {
      arr.sort((a, b) => b.statusChangedAt.localeCompare(a.statusChangedAt));
    }
    return m;
  }, [leads]);

  const applyMove = useCallback(
    (lead: LeadSummary, targetStatus: LeadStatus) => {
      if (lead.status === targetStatus) return;
      update.mutate(
        { id: lead.id, patch: { status: targetStatus } },
        {
          onSuccess: () =>
            toast.success(
              t('leadKanban.moveSuccess', 'Moved to {{status}}', { status: targetStatus }),
            ),
          onError: () => toast.error(t('leadKanban.moveError', 'Could not move lead')),
        },
      );
    },
    [update, t],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id ? String(event.over.id) : null;
    const targetStatus = overId ? COLUMNS.find((c) => c.status === overId)?.status : undefined;
    const lead = leads.find((l) => l.id === String(event.active.id));
    if (lead && targetStatus) applyMove(lead, targetStatus);
  };

  // Keyboard a11y (WCAG 2.1.1): move the focused card to the previous/next
  // column with the arrow keys, so the board is operable without a pointer.
  const moveLeadByKeyboard = useCallback(
    (leadId: string, dir: -1 | 1) => {
      const lead = leads.find((l) => l.id === leadId);
      if (!lead) return;
      const idx = COLUMNS.findIndex((c) => c.status === lead.status);
      const target = idx >= 0 ? COLUMNS[idx + dir] : undefined;
      if (target) applyMove(lead, target.status);
    },
    [leads, applyMove],
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div
        className="grid gap-3 overflow-x-auto pb-2"
        style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))` }}
        aria-label={t('leadKanban.boardAriaLabel', 'Lead pipeline kanban')}
      >
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            status={col.status}
            label={t(`leadKanban.column.${col.status}`, col.label)}
            leads={byStatus.get(col.status) ?? []}
            rottenDays={rotByStatus.get(col.status) ?? null}
            onMove={moveLeadByKeyboard}
          />
        ))}
      </div>
    </DndContext>
  );
}

const Column = memo(function Column({
  status,
  label,
  leads,
  rottenDays,
  onMove,
}: {
  status: LeadStatus;
  label: string;
  leads: LeadSummary[];
  rottenDays: number | null;
  onMove: (leadId: string, dir: -1 | 1) => void;
}) {
  const { t } = useTranslation('crm');
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={t('leadKanban.columnAriaLabel', '{{label}} column with {{count}} leads', {
        label,
        count: leads.length,
      })}
      className={cn(
        'flex min-h-[60vh] flex-col rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-2',
        isOver && 'ring-2 ring-[var(--brand-primary)]',
      )}
    >
      <header className="flex items-center justify-between px-1 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          {label} <span className="ml-1 text-[var(--fg-muted)]">({leads.length})</span>
        </h3>
      </header>
      {leads.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-xs text-[var(--fg-muted)]">
          {t('leadKanban.emptyColumn', 'No leads')}
        </div>
      ) : (
        <ul
          className="flex flex-col gap-2 overflow-y-auto"
          aria-label={t('leadKanban.columnLeadsAriaLabel', '{{label}} leads', { label })}
        >
          {leads.map((lead) => (
            <li key={lead.id}>
              <Card lead={lead} rottenDays={rottenDays} onMove={onMove} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});

function Card({
  lead,
  rottenDays,
  onMove,
}: {
  lead: LeadSummary;
  rottenDays: number | null;
  onMove: (leadId: string, dir: -1 | 1) => void;
}) {
  const { t } = useTranslation('crm');
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: lead.id });
  const days = daysSince(lead.statusChangedAt);
  const isRotten = rottenDays !== null && days >= rottenDays;

  return (
    <article
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // Focusable + arrow-key move so the board is keyboard-operable (WCAG
      // 2.1.1) without a pointer — the dnd-kit pointer path stays for mice.
      // These come AFTER the spreads so they win over dnd-kit's defaults.
      tabIndex={0}
      aria-roledescription="draggable lead"
      aria-label={t(
        'leadKanban.cardAriaLabel',
        '{{firstName}} {{lastName}}, {{company}}, in {{status}}. Use the left and right arrow keys to move between columns.',
        {
          firstName: lead.firstName,
          lastName: lead.lastName,
          company: lead.companyName,
          status: lead.status,
        },
      )}
      onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          onMove(lead.id, 1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onMove(lead.id, -1);
        }
      }}
      style={{
        transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
      }}
      className={cn(
        'group flex cursor-grab flex-col gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-input)] p-2.5 text-sm shadow-sm',
        'hover:border-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/leads/${lead.id}`}
          className="font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
          // Stop drag-start when the user genuinely wants to click the link.
          onPointerDown={(e) => e.stopPropagation()}
        >
          {lead.firstName} {lead.lastName}
        </Link>
        <LeadPriorityBadge priority={lead.priority} />
      </div>
      <p className="truncate text-xs text-[var(--fg-secondary)]">{lead.companyName}</p>

      <footer className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[10px] text-[var(--fg-tertiary)]">
          {t('leadKanban.daysInStage', '{{count}}d in stage', { count: days })}
        </span>
        {isRotten ? <RotBadge leadId={lead.id} daysOver={days - (rottenDays ?? 0)} /> : null}
      </footer>
    </article>
  );
}

function RotBadge({ leadId, daysOver }: { leadId: string; daysOver: number }) {
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState(false);
  const [plays, setPlays] = useState<RecoveryPlay[]>([]);
  const suggest = useRecoverySuggest();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const onOpen = async () => {
    setOpen(true);
    if (plays.length === 0) {
      const res = await suggest.mutateAsync(leadId);
      setPlays(res.plays);
    }
  };

  // Real dismissible menu: Escape + outside-click close it, focus moves into the
  // menu on open and back to the trigger on close, items are role="menuitem".
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, plays.length]);

  return (
    <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : void onOpen())}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-5 items-center gap-1 rounded-full bg-[var(--danger)] px-2 text-[10px] font-semibold text-white"
        aria-label={t(
          'leadKanban.rotBadgeAriaLabel',
          'Rotting: {{count}} days past threshold. Open recovery plays.',
          { count: daysOver },
        )}
      >
        <Icon name="warning" size={10} ariaHidden />
        {t('leadKanban.rotBadgeLabel', 'Rot · +{{count}}d', { count: daysOver })}
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('leadKanban.recoveryMenuAriaLabel', 'Suggested recovery plays')}
          className="absolute right-0 top-6 z-20 w-64 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2 shadow-xl"
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            {t('leadKanban.recoveryHeading', 'Suggested recovery')}
          </div>
          {suggest.isPending ? (
            <p className="px-2 py-1 text-xs text-[var(--fg-secondary)]">
              {t('leadKanban.recoveryLoading', 'Thinking…')}
            </p>
          ) : plays.length === 0 ? (
            <p className="px-2 py-1 text-xs text-[var(--fg-secondary)]">
              {t('leadKanban.recoveryEmpty', 'No suggestions.')}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {plays.map((play) => (
                <li key={play.kind}>
                  {/* Open the lead with the suggested play as a hint, where the
                      user can actually act on it — instead of a dead toast. */}
                  <Link
                    role="menuitem"
                    to={`/leads/${leadId}?recovery=${play.kind}`}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                    title={play.rationale}
                    onClick={() => setOpen(false)}
                  >
                    <div className="font-medium text-[var(--fg-primary)]">
                      {labelFor(play.kind, t)}
                    </div>
                    <div className="text-[10px] text-[var(--fg-tertiary)]">{play.rationale}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function labelFor(kind: RecoveryPlay['kind'], t: TFunction): string {
  switch (kind) {
    case 'send_reengagement_email':
      return t('leadKanban.play.sendReengagementEmail', 'Send re-engagement email');
    case 'schedule_call':
      return t('leadKanban.play.scheduleCall', 'Schedule a call');
    case 'add_to_nurture':
      return t('leadKanban.play.addToNurture', 'Add to nurture cadence');
    case 'mark_lost':
      return t('leadKanban.play.markLost', 'Mark as lost');
  }
}

// Avoid the noisy "_" var path used elsewhere — explicit unused suppression.

const _unused = LeadStatusBadge;
