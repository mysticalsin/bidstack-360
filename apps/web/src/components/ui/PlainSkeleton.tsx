/** CSS-only skeleton. The motion one lives with the pages that already load framer-motion. */
export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bs-shimmer h-12" />
      ))}
    </div>
  );
}
