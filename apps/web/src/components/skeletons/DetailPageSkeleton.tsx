// Layout-matched skeleton for detail pages.
// Reduces layout shift by approximating the actual page structure:
// header card + grid columns + tab bars.

interface Props {
  /** Number of content cards below the header. Default 3. */
  cards?: number;
  /** Grid columns for the content cards. Default 2. */
  columns?: 1 | 2 | 3;
  /** Whether to show a tab bar skeleton. */
  tabs?: boolean;
}

function ShimmerBar({ width, height = 16 }: { width: string; height?: number }) {
  return <div className="bs-shimmer" style={{ width, height }} />;
}

export function DetailPageSkeleton({ cards = 3, columns = 2, tabs = false }: Props) {
  const colClass = columns === 3 ? 'lg:grid-cols-3' : columns === 2 ? 'lg:grid-cols-2' : 'grid-cols-1';

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {/* Breadcrumb placeholder */}
      <div className="flex items-center gap-2">
        <ShimmerBar width="60px" height={12} />
        <span className="text-[var(--fg-muted)]">/</span>
        <ShimmerBar width="120px" height={12} />
      </div>

      {/* Header card */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <ShimmerBar width="240px" height={28} />
              <ShimmerBar width="72px" height={20} />
              <ShimmerBar width="56px" height={20} />
            </div>
            <ShimmerBar width="180px" height={14} />
            <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
              <ShimmerBar width="140px" height={12} />
              <ShimmerBar width="120px" height={12} />
              <ShimmerBar width="100px" height={12} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ShimmerBar width="80px" height={32} />
            <ShimmerBar width="72px" height={32} />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      {tabs && (
        <div className="flex items-center gap-1 border-b border-[var(--border-subtle)]">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="px-3 py-2">
              <ShimmerBar width={`${60 + i * 12}px`} height={14} />
            </div>
          ))}
        </div>
      )}

      {/* Content grid */}
      <div className={`grid grid-cols-1 gap-6 ${colClass}`}>
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-5 space-y-4"
          >
            <ShimmerBar width="120px" height={16} />
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <ShimmerBar width="50px" height={10} />
                  <ShimmerBar width="100%" height={32} />
                </div>
                <div className="space-y-1">
                  <ShimmerBar width="50px" height={10} />
                  <ShimmerBar width="100%" height={32} />
                </div>
              </div>
              <div className="space-y-1">
                <ShimmerBar width="50px" height={10} />
                <ShimmerBar width="100%" height={60} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
