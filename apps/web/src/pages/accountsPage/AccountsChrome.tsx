// Shared presentation primitives for the three Accounts segments (All / Key /
// Top). Extracted so the segment bodies read as ONE surface: the same header
// type scale, one stat-tile shell, one insight-panel chrome, one filter row.
// Each segment still owns its data hooks, money formatter, and pagination model
// — these primitives are display-only and NEVER receive a raw money amount: the
// caller formats every value to a string first (see StatTile's `value: string`).
// Kept framer-motion-free on purpose so both segment test suites — which mock
// only a subset of `motion.*` elements — render them unchanged.

import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/** Segment title + optional inline accessory, subtitle, and right-aligned
 *  actions. One type scale + spacing rhythm across All / Key / Top. */
export function SegmentHeader({
  title,
  titleAccessory,
  subtitle,
  actions,
}: {
  title: string;
  titleAccessory?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">{title}</h1>
          {titleAccessory}
        </div>
        {subtitle ? <div className="mt-1 text-sm text-[var(--fg-secondary)]">{subtitle}</div> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/** One stat-card shell: uppercase label, big pre-formatted value STRING, and an
 *  optional sublabel. Replaces All's SourceStat strip and Key/Top's local
 *  StatCard so every KPI tile shares radius, border, padding, and typography.
 *  `value` is always a string — money is formatted by the caller at the edge. */
export function StatTile({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div className="mt-2 truncate text-xl font-bold leading-tight text-[var(--fg-primary)]">
        {value}
      </div>
      {sublabel ? (
        <div className="mt-1.5 text-[11px] font-medium text-[var(--fg-tertiary)]">{sublabel}</div>
      ) : null}
    </div>
  );
}

/** Shared insight-panel chrome: eyebrow + heading (+ optional sub) with an
 *  optional right-aligned aside, over a body slot each segment fills with its
 *  own content (health bars, industry tiles, leaderboard KPIs, industry mix). */
export function InsightPanel({
  eyebrow,
  heading,
  sub,
  aside,
  ariaLabel,
  className,
  children,
}: {
  eyebrow: string;
  heading: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  ariaLabel?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        'rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
            {eyebrow}
          </p>
          <div className="mt-1 truncate text-lg font-semibold text-[var(--fg-primary)]">
            {heading}
          </div>
          {sub ? <div className="mt-1 text-sm text-[var(--fg-secondary)]">{sub}</div> : null}
        </div>
        {aside}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

/** Consistent filter row: an icon search field, a slot for selects/extras, and
 *  a reset button rendered with the shared `.btn` styling. Plain elements (no
 *  motion) so it renders identically inside every segment's test harness. */
export function FilterRow({
  ariaLabel,
  searchId,
  searchLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  onReset,
  resetLabel,
  showReset,
  children,
}: {
  ariaLabel: string;
  searchId: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onReset: () => void;
  resetLabel: string;
  showReset: boolean;
  children?: ReactNode;
}) {
  return (
    <div role="search" aria-label={ariaLabel} className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[200px] flex-1">
        <label htmlFor={searchId} className="sr-only">
          {searchLabel}
        </label>
        <Icon
          name="search"
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
          ariaHidden
        />
        <input
          id={searchId}
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="input w-full pl-9"
        />
      </div>
      {children}
      {showReset ? (
        <button type="button" className="btn btn-secondary" onClick={onReset}>
          <Icon name="refresh" size={14} ariaHidden />
          {resetLabel}
        </button>
      ) : null}
    </div>
  );
}

/** A select styled to match FilterRow's search field. Keeps the accessible
 *  name + describedby wiring the segments already relied on. */
export function FilterSelect({
  id,
  ariaLabel,
  ariaDescribedBy,
  value,
  onChange,
  children,
}: {
  id?: string;
  ariaLabel: string;
  ariaDescribedBy?: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input"
    >
      {children}
    </select>
  );
}
