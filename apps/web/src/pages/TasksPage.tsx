import { AnimatePresence, motion, Reorder } from 'framer-motion';
import {
  memo,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { TaskCalendar } from '@/components/task/TaskCalendar';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useCreateTask, useTasks, useUpdateTask } from '@/hooks/useTasks';
import { cn } from '@/lib/cn';
import { daysUntil, formatDate } from '@/lib/format';
import { useSavedViews } from '@/stores/savedViews';
import { useTaskOrder } from '@/stores/taskOrder';

import type { Task, TaskStatus } from '@bidstack/shared';

type StatusFilter = 'all' | TaskStatus | 'overdue' | 'today';

const STATUS_LABELS: Record<Exclude<StatusFilter, 'all' | 'overdue' | 'today'>, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

// Click-to-cycle status order. Mirrors Apple Reminders: tap to complete /
// undo. Click on the row's status badge cycles forwards.
const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
  blocked: 'open',
};

const VALID_FILTERS: StatusFilter[] = [
  'all',
  'today',
  'overdue',
  'open',
  'in_progress',
  'blocked',
  'done',
];

function parseFilter(raw: string | null): StatusFilter {
  // Anything we don't recognize collapses back to 'all' so a stale or
  // hand-typed URL doesn't put the page into an invalid state.
  return raw && (VALID_FILTERS as string[]).includes(raw) ? (raw as StatusFilter) : 'all';
}

export function TasksPage() {
  const { data, isLoading, isError, error } = useTasks();
  // Filter rides on the query string so the view is shareable + back/forward
  // navigable. Linking to "/tasks?filter=overdue" lands a coworker on the
  // exact same slice we were looking at.
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get('filter'));
  // useTransition keeps the filter-chip click snappy: the chip flips
  // immediately, the list re-filters as a non-urgent update so a slow
  // render won't block the press feedback.
  const [isFilterPending, startFilterTransition] = useTransition();

  const filteredItems = useMemo(() => {
    const all = data?.items ?? [];
    return all.filter((t) => {
      if (filter === 'all') return true;
      if (filter === 'today') {
        const d = daysUntil(t.dueDate);
        return d !== null && d === 0 && t.status !== 'done';
      }
      if (filter === 'overdue') {
        const d = daysUntil(t.dueDate);
        return d !== null && d < 0 && t.status !== 'done';
      }
      return t.status === filter;
    });
  }, [data?.items, filter]);

  // Sort. Default 'natural' = server order (createdAt desc on the backend).
  // 'due' sorts asc with nulls last so overdue surfaces at the top of the
  // filter result; 'status' clusters open → in_progress → blocked → done.
  type Sort = 'natural' | 'due' | 'status';
  const STATUS_ORDER: Record<TaskStatus, number> = {
    open: 0,
    in_progress: 1,
    blocked: 2,
    done: 3,
  };
  const sort = (searchParams.get('sort') as Sort | null) ?? 'natural';
  // Personal client-side order. Only applies when sort is 'natural' (the
  // user's manual ordering); explicit sort modes ignore it.
  const ordinalOf = useTaskOrder((s) => s.ordinalOf);
  const setOrder = useTaskOrder((s) => s.setOrder);
  const items = useMemo(() => {
    if (sort === 'natural') {
      // Stable sort by (clientOrdinal, naturalIndex). Tasks the user has
      // never reordered keep their original server order — ordinalOf
      // returns Infinity for them so they fall after explicit picks.
      const indexed = filteredItems.map((t, i) => ({ t, i }));
      indexed.sort((a, b) => {
        const oa = ordinalOf(a.t.id);
        const ob = ordinalOf(b.t.id);
        if (oa !== ob) return oa - ob;
        return a.i - b.i;
      });
      return indexed.map((x) => x.t);
    }
    const next = [...filteredItems];
    if (sort === 'due') {
      next.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    } else {
      next.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    }
    return next;
    // STATUS_ORDER is a literal-shaped constant, no need to depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredItems, sort, ordinalOf]);

  const view = (searchParams.get('view') as 'list' | 'calendar') ?? 'list';
  const setView = (next: 'list' | 'calendar') => {
    const params = new URLSearchParams(searchParams);
    if (next === 'list') params.delete('view');
    else params.set('view', next);
    setSearchParams(params, { replace: true });
  };

  const setSort = (next: Sort) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'natural') params.delete('sort');
    else params.set('sort', next);
    setSearchParams(params, { replace: true });
  };

  const switchFilter = (next: StatusFilter) => {
    startFilterTransition(() => {
      const params = new URLSearchParams(searchParams);
      // Default filter "all" is the implicit one — omit it from the URL to
      // keep clean links ("/tasks") for the most common entry point.
      if (next === 'all') params.delete('filter');
      else params.set('filter', next);
      setSearchParams(params, { replace: true });
    });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Tasks</h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {data?.items.length ?? 0} active follow-ups.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SavedViewsBar />
          <CreateTaskDialog />
        </div>
      </header>

      {/* Filter chips — Twenty-style segmented control above the table */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div role="tablist" aria-label="Filter tasks" className="flex flex-wrap gap-2">
          <Chip active={filter === 'all'} onClick={() => switchFilter('all')}>
            All
          </Chip>
          <Chip active={filter === 'today'} onClick={() => switchFilter('today')}>
            Today
          </Chip>
          <Chip active={filter === 'overdue'} onClick={() => switchFilter('overdue')} tone="danger">
            Overdue
          </Chip>
          {(['open', 'in_progress', 'blocked', 'done'] as const).map((s) => (
            <Chip key={s} active={filter === s} onClick={() => switchFilter(s)}>
              {STATUS_LABELS[s]}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] overflow-hidden">
            <button
              type="button"
              onClick={() => setView('list')}
              className={cn(
                'px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]',
                view === 'list'
                  ? 'bg-[var(--surface-hover)] text-[var(--fg-primary)] font-medium'
                  : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
              )}
              aria-pressed={view === 'list'}
              aria-label="List view"
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setView('calendar')}
              className={cn(
                'px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]',
                view === 'calendar'
                  ? 'bg-[var(--surface-hover)] text-[var(--fg-primary)] font-medium'
                  : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
              )}
              aria-pressed={view === 'calendar'}
              aria-label="Calendar view"
            >
              Calendar
            </button>
          </div>
          {view === 'list' && (
            <label className="flex items-center gap-1.5 text-[var(--fg-tertiary)]">
              <span>Sort by</span>
              <select
                aria-label="Sort tasks"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-primary)]"
              >
                <option value="natural">Recent</option>
                <option value="due">Due date</option>
                <option value="status">Status</option>
              </select>
            </label>
          )}
        </div>
      </div>

      {view === 'calendar' ? (
        <TaskCalendar tasks={data?.items ?? []} />
      ) : (
        <Card
          className={cn(
            'overflow-hidden transition-opacity',
            // Subtle dimming while the deferred re-filter runs. Gives users a
            // hint that the filter is in flight without blocking input.
            isFilterPending && 'opacity-70',
          )}
        >
          {isError ? (
            <ErrorState
              title="Could not load tasks"
              message={error instanceof Error ? error.message : 'Something went wrong'}
            />
          ) : isLoading ? (
            <LoadingSkeleton />
          ) : items.length === 0 ? (
            <EmptyState
              title={filter === 'all' ? 'No tasks yet' : 'No tasks match this filter'}
              message={filter === 'all' ? 'Create a follow-up to get started.' : undefined}
              action={filter === 'all' ? <CreateTaskDialog /> : null}
            />
          ) : sort === 'natural' ? (
            // Manual ordering — use framer-motion's Reorder primitive so
            // each row has built-in drag handling. We use div containers
            // (with role="list") so the inner TaskRow's motion.div doesn't
            // produce nested li elements. Drag only enabled when sort is
            // 'natural'; explicit sort modes would conflict with manual
            // position.
            <Reorder.Group
              axis="y"
              values={items}
              onReorder={(next) => setOrder(next.map((t) => t.id))}
              as="div"
              role="list"
              className="divide-y divide-[var(--border-subtle)]"
            >
              {items.map((t, i) => (
                <Reorder.Item key={t.id} value={t} as="div">
                  <TaskRow task={t} index={i} draggable />
                </Reorder.Item>
              ))}
            </Reorder.Group>
          ) : (
            <div role="list" className="divide-y divide-[var(--border-subtle)]">
              <AnimatePresence initial={false}>
                {items.map((t, i) => (
                  <TaskRow key={t.id} task={t} index={i} />
                ))}
              </AnimatePresence>
            </div>
          )}
          {/* Inline quick-add — sits at the bottom of the list so power users
              don't need to open the dialog for a one-shot follow-up. Press
              Enter to submit, Esc to clear. Errors fall through to a toast
              without disturbing the field. */}
          <InlineTaskAdd />
        </Card>
      )}
    </div>
  );
}

function InlineTaskAdd() {
  const [title, setTitle] = useState('');
  // Optional due date — empty string means no due date. We keep the date
  // input adjacent to the title so a power user can type-tab-pick-enter
  // without leaving the row.
  const [dueDate, setDueDate] = useState('');
  const create = useCreateTask();
  // Hold a ref so we can re-focus after a successful add — keeps the
  // Reminders-app rhythm of "add → add → add" without remourcing the
  // input on every keystroke (typing target stays the same DOM node).
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const value = title.trim();
    if (!value) return;
    create.mutate(
      {
        title: value,
        oppId: null,
        dueDate: dueDate || null,
        assignee: null,
        status: 'open',
      },
      {
        onSuccess: () => {
          setTitle('');
          // Intentionally keep the date — a user adding three tasks all
          // due "tomorrow" shouldn't have to re-pick the date each time.
          // They can clear it when they want a new default.
          toast.success('Task added', { duration: 1600 });
          requestAnimationFrame(() => inputRef.current?.focus());
        },
        onError: (err) =>
          toast.error('Could not add task', {
            description: err instanceof Error ? err.message : 'The server rejected the request.',
          }),
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)]/40 px-5 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-[var(--fg-tertiary)]">
          +
        </span>
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setTitle('');
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Add a quick task — Enter to save"
          aria-label="Quick-add task title"
          disabled={create.isPending}
          className="flex-1 bg-transparent text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none disabled:opacity-60"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Optional due date"
          disabled={create.isPending}
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-1.5 py-0.5 text-[10px] text-[var(--fg-secondary)]"
        />
        {title.trim() ? (
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md px-2 py-0.5 text-xs font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-primary-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
          >
            Add
          </button>
        ) : null}
      </div>
    </form>
  );
}

// Each row is memoized so toggling one task's status doesn't re-render the
// other 49 rows — the only deps are the task object itself and its index
// (used for the entry-stagger delay).
const TaskRow = memo(function TaskRow({
  task,
  index,
  draggable = false,
}: {
  task: Task;
  index: number;
  /** When wrapped in Reorder.Item, show a drag handle. */
  draggable?: boolean;
}) {
  const update = useUpdateTask();
  const d = daysUntil(task.dueDate);
  const overdue = d !== null && d < 0;

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

  return (
    <motion.div
      // `motion.div` (not motion.li) so this same body works whether the
      // parent is an AnimatePresence <ul> (non-draggable) OR a Reorder.Item
      // <li> (draggable) — no nested-list invalid HTML. We restore the
      // semantics with role="listitem" so screen readers still grok it as
      // a list of items.
      role="listitem"
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: {
          type: 'spring',
          stiffness: 200,
          damping: 28,
          delay: Math.min(index, 16) * 0.028,
        },
      }}
      exit={{ opacity: 0, x: -8, transition: { duration: 0.16 } }}
      className="group flex items-center justify-between gap-4 px-5 py-3"
    >
      {draggable ? (
        // Six-dot drag affordance. Reorder.Item handles the drag itself;
        // this is purely a visual cue + "where to grab" hint. cursor-grab
        // / cursor-grabbing comes from the active state on the parent.
        <span
          aria-hidden
          className="select-none text-[var(--fg-tertiary)] opacity-0 transition-opacity group-hover:opacity-100"
          title="Drag to reorder"
        >
          ⋮⋮
        </span>
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
            <span className={overdue ? 'text-[var(--danger)] ml-2' : 'ml-2'}>
              {overdue ? `${Math.abs(d)}d late` : `in ${d}d`}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {task.status !== 'done' ? (
          <select
            aria-label={`Snooze ${task.title}`}
            // Native select dropdown — minimal weight, matches platform
            // affordances on mobile. The first option is a label that
            // never fires (we reset value to "" after a pick).
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const opt = snoozeOptions().find((o) => o.value === v);
              if (opt) snoozeTo(opt.label, opt.value);
              e.target.value = '';
            }}
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-1.5 py-0.5 text-[10px] text-[var(--fg-secondary)] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          >
            <option value="">Snooze…</option>
            {snoozeOptions().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : null}
        <motion.button
          type="button"
          onClick={cycle}
          disabled={update.isPending}
          whileTap={{ scale: 0.94 }}
          aria-label={`Status: ${task.status.replace('_', ' ')}. Click to cycle.`}
          title="Click to cycle status"
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

function Chip({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: 'danger';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] ${
        active
          ? tone === 'danger'
            ? 'border-[var(--danger)] bg-[var(--danger-tint)] text-[var(--danger)]'
            : 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
          : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)]'
      }`}
    >
      {children}
    </button>
  );
}

// Save / recall named filter+sort combos. The query string is the source
// of truth; we just bookmark it. Picker keeps to the right of the page
// header so it doesn't crowd the chip row below.
function SavedViewsBar() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const all = useSavedViews((s) => s.views);
  const save = useSavedViews((s) => s.save);
  const remove = useSavedViews((s) => s.remove);
  const views = all.tasks ?? [];

  const onSave = () => {
    const name = window.prompt('Name this view (e.g., "My overdue today")');
    if (!name?.trim()) return;
    save('tasks', name.trim(), search);
    toast.success(`Saved view "${name.trim()}"`, { duration: 1800 });
  };

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {views.length > 0 ? (
        <select
          aria-label="Recall saved view"
          defaultValue=""
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            const v = views.find((x) => x.id === id);
            if (v) navigate(`/tasks${v.query}`);
            e.target.value = '';
          }}
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-primary)]"
        >
          <option value="">Saved views…</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        onClick={onSave}
        className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
      >
        Save view
      </button>
      {views.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            const v = views[0];
            if (v && window.confirm(`Remove most-recent view "${v.name}"?`)) {
              remove('tasks', v.id);
            }
          }}
          className="text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
          title="Remove most-recent saved view"
          aria-label="Remove most-recent saved view"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
