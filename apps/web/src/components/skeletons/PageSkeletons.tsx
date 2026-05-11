// Per-page skeleton components that mirror the real layout — same heights,
// same number of columns, same hierarchy. Generic shimmer rows feel cheap;
// layout-matched skeletons feel like the page is "loading itself" rather
// than being replaced. Standard Apple HIG move (Stocks, Mail).
//
// Conventions:
// - Use the `.bs-shimmer` utility (defined in index.css) for the moving sheen.
// - Stagger blocks with framer-motion so they don't all light up at once
//   (matches real list staggers we use post-load).
// - Mark every block aria-hidden — they're chrome, not content.

import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';

import { staggerChild, staggerParent } from '@/lib/motion';

const Bar = ({ w, h = 12 }: { w: string; h?: number }) => (
  <span aria-hidden className="bs-shimmer block" style={{ width: w, height: h, borderRadius: 6 }} />
);

function ShimmerGrid({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      variants={reduced ? undefined : staggerParent}
      initial="initial"
      animate="animate"
      aria-busy="true"
      aria-live="polite"
      className="contents"
    >
      {children}
    </motion.div>
  );
}

function Block({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div variants={reduced ? undefined : staggerChild} className={className} aria-hidden>
      {children}
    </motion.div>
  );
}

// ── Dashboard / cockpit ─────────────────────────────────────────────────
export const DashboardSkeleton = memo(function DashboardSkeleton() {
  return (
    <ShimmerGrid>
      {/* Page head — title + subtitle */}
      <Block className="mb-4">
        <Bar w="240px" h={28} />
        <div className="mt-2">
          <Bar w="320px" h={14} />
        </div>
      </Block>
      {/* KPI row — 6 tiles */}
      <Block className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3"
          >
            <Bar w="60px" h={10} />
            <div className="mt-2">
              <Bar w="80%" h={22} />
            </div>
          </div>
        ))}
      </Block>
      {/* Main + side columns */}
      <Block className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* Snapshot card */}
          <CardSkel rows={3} />
          {/* 3-up row */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <CardSkel rows={2} />
            <CardSkel rows={2} />
            <CardSkel rows={2} />
          </div>
          <CardSkel rows={4} />
          <CardSkel rows={5} />
        </div>
        <aside className="space-y-4">
          <CardSkel rows={3} />
          <CardSkel rows={2} />
          <CardSkel rows={3} />
          <CardSkel rows={2} />
        </aside>
      </Block>
    </ShimmerGrid>
  );
});

function CardSkel({ rows }: { rows: number }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <Bar w="140px" h={14} />
        <Bar w="60px" h={10} />
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Bar w="32px" h={32} />
            <div className="flex-1 space-y-1">
              <Bar w="70%" h={12} />
              <Bar w="40%" h={10} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Contacts / opportunities table ──────────────────────────────────────
// `headless`: when the host page already renders the title + actions
// outside the Card, pass `headless` so we only render the table chrome.
export const TableSkeleton = memo(function TableSkeleton({
  rows = 8,
  columns = 6,
  headless = false,
}: {
  rows?: number;
  columns?: number;
  headless?: boolean;
}) {
  return (
    <ShimmerGrid>
      {!headless ? (
        <Block className="mb-4 flex items-center justify-between">
          <Bar w="200px" h={28} />
          <Bar w="120px" h={32} />
        </Block>
      ) : null}
      <Block
        className={
          headless
            ? 'overflow-hidden'
            : 'overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]'
        }
      >
        {/* Header strip */}
        <div className="flex gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-5 py-3">
          {Array.from({ length: columns }).map((_, i) => (
            <Bar key={i} w={i === 1 ? '200px' : '80px'} h={10} />
          ))}
        </div>
        {/* Rows */}
        <div>
          {Array.from({ length: rows }).map((_, r) => (
            <div
              key={r}
              className="flex items-center gap-4 border-b border-[var(--border-subtle)] px-5 py-3 last:border-b-0"
            >
              {Array.from({ length: columns }).map((_, c) => (
                <Bar key={c} w={c === 1 ? '200px' : '80px'} h={14} />
              ))}
            </div>
          ))}
        </div>
      </Block>
    </ShimmerGrid>
  );
});

// ── Pipeline kanban ─────────────────────────────────────────────────────
export const KanbanSkeleton = memo(function KanbanSkeleton() {
  return (
    <ShimmerGrid>
      <Block className="mb-4">
        <Bar w="200px" h={28} />
        <div className="mt-2">
          <Bar w="320px" h={12} />
        </div>
      </Block>
      <Block className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, col) => (
          <div key={col} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <Bar w="64px" h={16} />
              <Bar w="40px" h={10} />
            </div>
            {Array.from({ length: 2 + (col % 3) }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3"
              >
                <Bar w="40px" h={10} />
                <div className="mt-1.5">
                  <Bar w="100%" h={12} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Bar w="60%" h={10} />
                  <Bar w="20%" h={10} />
                </div>
                <div className="mt-3">
                  <Bar w="100%" h={4} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </Block>
    </ShimmerGrid>
  );
});

// ── Settings / Integrations ─────────────────────────────────────────────
export const SettingsSkeleton = memo(function SettingsSkeleton() {
  return (
    <ShimmerGrid>
      <Block className="mb-4">
        <Bar w="180px" h={28} />
      </Block>
      {Array.from({ length: 3 }).map((_, i) => (
        <Block key={i} className="mb-4">
          <CardSkel rows={3} />
        </Block>
      ))}
    </ShimmerGrid>
  );
});
