import { AnimatePresence, Reorder } from 'framer-motion';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { InlineTaskAdd } from '@/components/task/InlineTaskAdd';
import { SavedViewsBar } from '@/components/task/SavedViewsBar';
import { TaskRow } from '@/components/task/TaskRow';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { TaskCalendar } from '@/components/task/TaskCalendar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useTasks } from '@/hooks/useTasks';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { cn } from '@/lib/cn';
import { daysUntil, formatDate } from '@/lib/format';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import { useTaskOrder } from '@/stores/taskOrder';
import { Select } from '@/components/ui/Select';

import type { TaskStatus } from '@bidstack/shared';

type StatusFilter = 'all' | TaskStatus | 'overdue' | 'today';

const STATUS_LABELS: Record<Exclude<StatusFilter, 'all' | 'overdue' | 'today'>, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
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
  const { t } = useTranslation('crm');
  // Filter rides on the query string so the view is shareable + back/forward
  // navigable. Linking to "/tasks?filter=overdue" lands a coworker on the
  // exact same slice we were looking at.
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get('filter'));
  // The four concrete statuses are filtered server-side so the result spans the
  // whole tenant, not just the loaded page. 'overdue'/'today' are date filters
  // the route doesn't model, so those stay client-side (see filteredItems) and
  // therefore only reflect the pages currently loaded.
  const serverStatus =
    filter === 'all' || filter === 'overdue' || filter === 'today' ? undefined : filter;
  const pager = useCursorPagination(filter);
  const { data, isLoading, isError, error } = useTasks({
    ...(serverStatus ? { status: serverStatus } : {}),
    limit: 50,
    ...(pager.cursor ? { cursor: pager.cursor } : {}),
  });
  // useTransition keeps the filter-chip click snappy: the chip flips
  // immediately, the list re-filters as a non-urgent update so a slow
  // render won't block the press feedback.
  const [isFilterPending, startFilterTransition] = useTransition();
  const [taskOrderMessage, setTaskOrderMessage] = useState('');

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
      // Concrete statuses are already narrowed server-side; this is a no-op
      // guard for the loaded page.
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

  const moveTask = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (toIndex < 0 || toIndex >= items.length) return;
      const next = [...items];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return;
      next.splice(toIndex, 0, moved);
      setOrder(next.map((task) => task.id));
      setTaskOrderMessage(
        t('tasks.reorder.announce', 'Moved {{title}} to position {{position}} of {{total}}.', {
          title: moved.title,
          position: toIndex + 1,
          total: next.length,
        }),
      );
    },
    [items, setOrder, t],
  );

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
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            {t('tasks.title', 'Tasks')}
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {t('tasks.subtitle', '{{count}} active follow-ups.', {
              count: data?.items.length ?? 0,
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const rows = items.map((t) => ({
                title: t.title,
                status: t.status,
                dueDate: t.dueDate ? formatDate(t.dueDate) : '',
                assignee: t.assignee ?? '',
                oppId: t.oppId ?? '',
              }));
              const csv = rowsToCsv(rows, [
                { key: 'title', label: 'Title' },
                { key: 'status', label: 'Status' },
                { key: 'dueDate', label: 'Due Date' },
                { key: 'assignee', label: 'Assignee' },
                { key: 'oppId', label: 'Opportunity ID' },
              ]);
              downloadCsv(`tasks-${new Date().toISOString().slice(0, 10)}`, csv);
            }}
          >
            {t('tasks.actions.exportCsv', 'Export CSV')}
          </Button>
          <SavedViewsBar />
          <CreateTaskDialog />
        </div>
      </header>

      {/* Filter chips — CRM-style segmented control above the table */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div role="group" aria-label={t('tasks.filters.groupLabel', 'Filter tasks')} className="flex flex-wrap gap-2">
          <Chip active={filter === 'all'} onClick={() => switchFilter('all')}>
            {t('tasks.filters.all', 'All')}
          </Chip>
          <Chip active={filter === 'today'} onClick={() => switchFilter('today')}>
            {t('tasks.filters.today', 'Today')}
          </Chip>
          <Chip active={filter === 'overdue'} onClick={() => switchFilter('overdue')} tone="danger">
            {t('tasks.filters.overdue', 'Overdue')}
          </Chip>
          {(['open', 'in_progress', 'blocked', 'done'] as const).map((s) => (
            <Chip key={s} active={filter === s} onClick={() => switchFilter(s)}>
              {t(`tasks.status.${s}`, STATUS_LABELS[s])}
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
              aria-label={t('tasks.view.listLabel', 'List view')}
            >
              {t('tasks.view.list', 'List')}
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
              aria-label={t('tasks.view.calendarLabel', 'Calendar view')}
            >
              {t('tasks.view.calendar', 'Calendar')}
            </button>
          </div>
          {view === 'list' && (
            <div className="flex items-center gap-1.5 text-[var(--fg-tertiary)]">
              <span>{t('tasks.sort.label', 'Sort by')}</span>
              <Select
                aria-label={t('tasks.sort.ariaLabel', 'Sort tasks')}
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                size="sm"
                className="w-28"
              >
                <option value="natural">{t('tasks.sort.recent', 'Recent')}</option>
                <option value="due">{t('tasks.sort.dueDate', 'Due date')}</option>
                <option value="status">{t('tasks.sort.status', 'Status')}</option>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* sr-only live region — announces filter result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading
          ? `${t('tasks.srCount', '{{count}} task', { count: items.length })}${filter !== 'all' ? ` · ${filter.replace('_', ' ')}` : ''}`
          : ''}
      </p>

      {view === 'calendar' ? (
        <TaskCalendar tasks={data?.items ?? []} />
      ) : (
        <>
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {taskOrderMessage}
          </div>
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
                title={t('tasks.error.title', 'Could not load tasks')}
                message={
                  error instanceof Error
                    ? error.message
                    : t('tasks.error.generic', 'Something went wrong')
                }
              />
            ) : isLoading ? (
              <LoadingSkeleton />
            ) : items.length === 0 ? (
              <EmptyState
                icon={filter === 'all' ? 'tasks' : 'search'}
                title={
                  filter === 'all'
                    ? t('tasks.empty.headline', 'Nothing on the bid clock')
                    : t('tasks.empty.filteredTitle', 'No tasks match this filter')
                }
                message={
                  filter === 'all'
                    ? t(
                        'tasks.empty.body',
                        'Deadlines, follow-ups, and deliverables all land here. Add the next action on a live bid so nothing slips before submission day.',
                      )
                    : undefined
                }
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
                    <TaskRow
                      task={t}
                      draggable
                      canMoveUp={i > 0}
                      canMoveDown={i < items.length - 1}
                      onMoveUp={() => moveTask(i, i - 1)}
                      onMoveDown={() => moveTask(i, i + 1)}
                    />
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            ) : (
              <div role="list" className="divide-y divide-[var(--border-subtle)]">
                <AnimatePresence initial={false}>
                  {items.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </AnimatePresence>
              </div>
            )}
            {/* Inline quick-add — sits at the bottom of the list so power users
              don't need to open the dialog for a one-shot follow-up. */}
            <InlineTaskAdd />
            {/* Cursor pager — only meaningful on the list view. For the
              client-side 'overdue'/'today' filters it pages the underlying
              status-unfiltered set, so a page may render fewer rows than the
              page size; that's expected until the route grows a date filter. */}
            {!isLoading && !isError && (items.length > 0 || pager.hasPrevious) ? (
              <CursorPager
                currentPage={pager.page}
                hasNext={Boolean(data?.nextCursor)}
                hasPrevious={pager.hasPrevious}
                isLoading={isLoading}
                itemCount={items.length}
                label={t('tasks.pager.label', 'tasks')}
                onNext={() => pager.goNext(data?.nextCursor)}
                onPrevious={pager.goPrevious}
              />
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}

// Filter chip — local to this page; no other consumer warrants its own file.
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
      aria-pressed={active}
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
