// Extracted from TasksPage.tsx — memoized task list row with snooze menu and
// status-cycle button. Kept in a dedicated file so TasksPage stays under 400
// lines while this component can grow its own tests independently.

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { useUpdateTask } from '@/hooks/useTasks';
import { cn } from '@/lib/cn';
import { daysUntil, formatDate } from '@/lib/format';

import type { Task } from '@bidstack/shared';

import { STATUS_CYCLE } from './taskConstants';

// Each row is memoized so toggling one task's status doesn't re-render the
// other 49 rows — the only deps are the task object itself and optional
// reorder callbacks.
export const TaskRow = memo(function TaskRow({
  task,
  draggable = false,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
}: {
  task: Task;
  /** When wrapped in Reorder.Item, show a drag handle. */
  draggable?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const update = useUpdateTask();
  const d = daysUntil(task.dueDate);
  const overdue = d !== null && d < 0;

  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);
  const snoozeTriggerRef = useRef<HTMLButtonElement>(null);
  const [highlightedSnoozeIndex, setHighlightedSnoozeIndex] = useState(-1);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!snoozeOpen) return;
    function onClick(e: MouseEvent) {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) {
        setSnoozeOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [snoozeOpen]);

  // WHY useLayoutEffect: clears snooze-menu highlight before paint so the
  // next open cycle starts clean. setState-in-effect is intentional — pure
  // React UI state, no external system.
  useLayoutEffect(() => {
    if (!snoozeOpen) {
      setHighlightedSnoozeIndex(-1);
    }
  }, [snoozeOpen]);

  const cycle = () => {
    const next = STATUS_CYCLE[task.status];
    update.mutate(
      { id: task.id, patch: { status: next } },
      {
        onSuccess: () => {
          if (next === 'done') toast.success(`Marked "${task.title}" done`);
        },
        onError: (err) =>
          toast.error('Could not update task', {
            description: err instanceof Error ? err.message : 'The server rejected the request.',
          }),
      },
    );
  };

  // Snooze — patch dueDate forward. Three quick presets mirroring iOS
  // Reminders' "Remind me later". `null` would clear the date entirely;
  // we don't expose that here because clearing is already a click-to-edit
  // action on the date cell of opportunities — this menu is for *pushing
  // out*, not clearing.
  const snoozeTo = (label: string, isoDate: string) => {
    update.mutate(
      { id: task.id, patch: { dueDate: isoDate } },
      {
        onSuccess: () => toast.success(`Snoozed "${task.title}" to ${label}`, { duration: 2200 }),
        onError: (err) =>
          toast.error('Snooze failed', {
            description: err instanceof Error ? err.message : 'The server rejected the request.',
          }),
      },
    );
  };

  const snoozeOptions = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const nextWeek = new Date(now);
    nextWeek.setDate(now.getDate() + 7);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return [
      { label: 'Tomorrow', value: iso(tomorrow) },
      { label: 'In 3 days', value: iso(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)) },
      { label: 'Next week', value: iso(nextWeek) },
    ];
  };

  const handleSnoozeKeyDown = (e: React.KeyboardEvent) => {
    const snoozeOpts = snoozeOptions();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!snoozeOpen) {
          setSnoozeOpen(true);
          setHighlightedSnoozeIndex(0);
        } else {
          setHighlightedSnoozeIndex((prev) => (prev + 1) % snoozeOpts.length);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!snoozeOpen) {
          setSnoozeOpen(true);
          setHighlightedSnoozeIndex(snoozeOpts.length - 1);
        } else {
          setHighlightedSnoozeIndex((prev) => (prev - 1 + snoozeOpts.length) % snoozeOpts.length);
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!snoozeOpen) {
          setSnoozeOpen(true);
        } else if (highlightedSnoozeIndex >= 0 && highlightedSnoozeIndex < snoozeOpts.length) {
          const opt = snoozeOpts[highlightedSnoozeIndex];
          if (opt) {
            snoozeTo(opt.label, opt.value);
          }
          setSnoozeOpen(false);
          snoozeTriggerRef.current?.focus();
        }
        break;
      case 'Escape':
        e.preventDefault();
        setSnoozeOpen(false);
        snoozeTriggerRef.current?.focus();
        break;
      case 'Tab':
        setSnoozeOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <motion.div
      // `motion.div` (not motion.li) so this same body works whether the
      // parent is an AnimatePresence <ul> (non-draggable) OR a Reorder.Item
      // <li> (draggable) — no nested-list invalid HTML. We restore the
      // semantics with role="listitem" so screen readers still grok it as
      // a list of items.
      role="listitem"
      layout
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -8, transition: { duration: 0.16 } }}
      className="group flex items-center justify-between gap-4 px-5 py-3"
    >
      {draggable ? (
        <div className="flex shrink-0 items-center gap-1" aria-label="Reorder task">
          <span
            aria-hidden
            className="select-none text-[var(--fg-tertiary)]"
            title="Drag to reorder"
          >
            ::
          </span>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="rounded-md border border-[var(--border-subtle)] px-1.5 py-1 text-[10px] font-medium text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Move ${task.title} up`}
          >
            Up
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="rounded-md border border-[var(--border-subtle)] px-1.5 py-1 text-[10px] font-medium text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Move ${task.title} down`}
          >
            Down
          </button>
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'text-sm font-medium text-[var(--fg-primary)]',
            // Strike-through completed tasks — visual confirmation that
            // matches Reminders.app.
            task.status === 'done' && 'line-through text-[var(--fg-tertiary)]',
          )}
        >
          <Link to={`/tasks/${task.id}`} className="hover:text-[var(--brand-primary)]">
            {task.title}
          </Link>
        </div>
        <div className="text-xs text-[var(--fg-tertiary)]">
          Due {formatDate(task.dueDate)}
          {d !== null && task.status !== 'done' ? (
            <span
              className={
                overdue
                  ? 'text-[var(--danger)] ml-2 inline-flex items-center gap-1 font-semibold'
                  : 'ml-2'
              }
            >
              {overdue ? (
                <>
                  <span role="img" aria-label="warning">
                    ⚠️
                  </span>
                  Overdue: {Math.abs(d)}d late
                </>
              ) : (
                `in ${d}d`
              )}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {task.status !== 'done' ? (
          <div ref={snoozeRef} className="relative">
            <button
              ref={snoozeTriggerRef}
              type="button"
              onClick={() => setSnoozeOpen((v) => !v)}
              onKeyDown={handleSnoozeKeyDown}
              aria-label={`Snooze ${task.title}`}
              aria-haspopup="listbox"
              aria-expanded={snoozeOpen}
              className={cn(
                'rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)] flex items-center gap-1 hover:bg-[var(--surface-hover)] focus-visible:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] focus:outline-none transition-all duration-150',
                snoozeOpen
                  ? 'opacity-100 ring-2 ring-[var(--brand-primary)]'
                  : 'opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100 focus:opacity-100 focus-visible:opacity-100',
              )}
            >
              <Icon name="clock" size={10} ariaHidden />
              <span>Snooze…</span>
            </button>

            <AnimatePresence>
              {snoozeOpen && (
                <motion.div
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-[calc(100%+6px)] z-30 w-36 rounded-lg glass-menu p-1.5 focus:outline-none"
                  role="listbox"
                  aria-label="Snooze presets"
                >
                  <div className="flex flex-col gap-0.5">
                    {snoozeOptions().map((o, index) => {
                      const isHighlighted = index === highlightedSnoozeIndex;
                      return (
                        <button
                          key={o.value}
                          role="option"
                          aria-selected={false}
                          onClick={() => {
                            snoozeTo(o.label, o.value);
                            setSnoozeOpen(false);
                          }}
                          onMouseEnter={() => setHighlightedSnoozeIndex(index)}
                          className="relative flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs rounded-md transition-colors text-[var(--fg-primary)] bg-transparent focus:outline-none cursor-pointer"
                        >
                          {isHighlighted && (
                            <motion.div
                              layoutId={`snooze-highlight-${task.id}`}
                              className="absolute inset-0 bg-[var(--surface-hover)] rounded-md -z-10"
                              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                            />
                          )}
                          <span className="truncate">{o.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : null}
        <motion.button
          type="button"
          onClick={cycle}
          disabled={update.isPending}
          whileTap={{ scale: 0.94 }}
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={`Status: ${task.status.replace('_', ' ')}. Activate to change to ${STATUS_CYCLE[
            task.status
          ].replace('_', ' ')}.`}
          title={`Activate to change status to ${STATUS_CYCLE[task.status].replace('_', ' ')}`}
        >
          <Badge
            tone={
              task.status === 'done'
                ? 'jade'
                : task.status === 'in_progress'
                  ? 'blue'
                  : task.status === 'blocked'
                    ? 'tomato'
                    : 'gray'
            }
          >
            {task.status.replace('_', ' ')}
          </Badge>
        </motion.button>
      </div>
    </motion.div>
  );
});
