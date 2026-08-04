// Ported from D:\CRM\packages\ui\src\components\dashboard.tsx (223 lines).
// Light-rewrite tier (ROUND2-ULTRAPLAN manifest #13).
//
// Token rewrites:
//   text-muted-foreground → text-fg-secondary        (×4)
//   bare `border` / `border-l` / `border-t` / `border-b`
//                         → the same utility + `border-border-subtle`
//
// WHY every border names its colour: Tailwind v4's preflight sets
// `border: 0 solid` — no colour — so an unqualified `border-l` inherits
// currentColor and paints a text-coloured hairline. The CRM got away with bare
// borders because its globals.css declares a universal border-color; BidStack
// does not, by design (ADR 0002 keeps borders on named tokens).
//
// The layout grammar: bordered panels butted edge to edge, no gaps between the
// KPI cells and no per-card shadow. The strip reads as ONE instrument, which is
// what makes four numbers scan as a row instead of four floating cards.

import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { Skeleton } from './skeleton';

function StatGroup({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="stat-group"
      className={cn('@container/stats overflow-hidden border border-border-subtle', className)}
      {...props}
    >
      <div
        className={cn(
          'grid grid-cols-2 @2xl/stats:grid-cols-4',
          '[&>*]:border-border-subtle',
          // DEVIATION from source: upstream writes `[&:nth-child(2n)]:border-l`,
          // which selects the grid wrapper itself, not the cells — so the
          // narrow two-column layout ships with no internal dividers. The child
          // combinator is restored; the wide (@2xl) rules below were already
          // correct and are unchanged.
          '[&>*:nth-child(2n)]:border-l [&>*:nth-child(n+3)]:border-t',
          '@2xl/stats:[&>*]:border-t-0 @2xl/stats:[&>*]:border-l @2xl/stats:[&>*:first-child]:border-l-0',
        )}
      >
        {children}
      </div>
    </div>
  );
}

const GRID_COLS = {
  2: '@md/dashboard:grid-cols-2',
  3: '@md/dashboard:grid-cols-2 @4xl/dashboard:grid-cols-3',
  4: '@md/dashboard:grid-cols-2 @4xl/dashboard:grid-cols-4',
} as const;

function DashboardGrid({
  className,
  columns = 4,
  ...props
}: ComponentProps<'div'> & { columns?: keyof typeof GRID_COLS }) {
  return (
    <div className="@container/dashboard">
      <div
        data-slot="dashboard-grid"
        className={cn('grid grid-cols-1 gap-4', GRID_COLS[columns], className)}
        {...props}
      />
    </div>
  );
}

function DashboardRow({
  className,
  split = 'hero',
  ...props
}: ComponentProps<'div'> & { split?: 'hero' | 'even' }) {
  return (
    <div className="@container/dashboard">
      <div
        data-slot="dashboard-row"
        className={cn(
          'grid grid-cols-1 gap-4',
          split === 'hero'
            ? '@3xl/dashboard:grid-cols-[2fr_1fr]'
            : '@3xl/dashboard:grid-cols-2',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function ChartCard({
  className,
  title,
  description,
  action,
  footer,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      data-slot="chart-card"
      className={cn('flex flex-col border border-border-subtle', className)}
      {...props}
    >
      {title || description || action ? (
        <div className="flex items-start justify-between gap-4 p-5 md:p-6">
          <div className="flex min-w-0 flex-col gap-1">
            {title ? <h3 className="truncate font-medium text-sm">{title}</h3> : null}
            {description ? (
              <p className="text-fg-secondary text-xs/relaxed">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col justify-center pb-5 md:pb-6">{children}</div>
      {footer ? (
        <div className="border-t border-border-subtle px-5 py-3 text-fg-secondary text-xs md:px-6">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function KpiCard({
  className,
  title,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  title: ReactNode;
}) {
  return (
    <div
      data-slot="kpi-card"
      className={cn('flex flex-col gap-4 border border-border-subtle p-5 md:p-6', className)}
      {...props}
    >
      <h3 className="truncate font-medium text-fg-secondary text-sm">{title}</h3>
      {children}
    </div>
  );
}

function DashboardSection({
  className,
  title,
  description,
  action,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const hasHeader = title || description || action;
  return (
    <section data-slot="dashboard-section" className={cn('flex flex-col gap-4', className)} {...props}>
      {hasHeader ? (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="flex flex-col gap-1">
            {title ? <h2 className="font-medium text-base tracking-tight">{title}</h2> : null}
            {description ? <p className="text-fg-secondary text-sm">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function DashboardSkeleton({ stats = 4, className }: { stats?: number; className?: string }) {
  return (
    <div
      data-slot="dashboard-skeleton"
      className={cn('flex flex-col gap-6', className)}
      aria-hidden
    >
      <StatGroup>
        {Array.from({ length: stats }).map((_, i) => (
          // Index key is correct here: the cells are interchangeable placeholders
          // with no identity, and the list never reorders.
          <div key={i} className="flex flex-col gap-3 p-4 md:p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </StatGroup>
      <DashboardRow>
        <div className="flex flex-col gap-4 border border-border-subtle p-5 md:p-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-[200px] w-full" />
        </div>
        <div className="flex flex-col items-center gap-4 border border-border-subtle p-5 md:p-6">
          <Skeleton className="h-4 w-32 self-start" />
          <Skeleton className="size-[200px] rounded-full" />
        </div>
      </DashboardRow>
    </div>
  );
}

export {
  ChartCard,
  DashboardGrid,
  DashboardRow,
  DashboardSection,
  DashboardSkeleton,
  KpiCard,
  StatGroup,
};
