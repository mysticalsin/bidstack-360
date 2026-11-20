// One row per recent import while its companies are enriched, then the result counts.
import { CircleCheck, LoaderCircle } from 'lucide-react';

import type { IntelImportBatchView } from '@bidstack/shared';

const ORIGIN: Record<IntelImportBatchView['origin'], string> = {
  csv: 'CSV import',
  hubspot: 'HubSpot import',
};

export function IntelImportProgress({ batches }: { batches: IntelImportBatchView[] }) {
  if (!batches.length) return null;
  return (
    <ul aria-label="Import enrichment" className="space-y-2">
      {batches.map((b) => {
        const running = b.status === 'running';
        const settled = b.done + b.failed;
        const pct = b.total ? Math.round((settled / b.total) * 100) : 100;
        return (
          <li
            key={b.id}
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-2 text-xs text-[var(--fg-secondary)]"
          >
            <span className="inline-flex items-center gap-2 font-medium text-[var(--fg-primary)]">
              {running ? (
                <LoaderCircle
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <CircleCheck className="size-3.5 text-[var(--success)]" aria-hidden />
              )}
              {ORIGIN[b.origin]}
            </span>
            <span className="tabular-nums">{`${settled} of ${b.total} enriched`}</span>
            {running ? (
              <span
                className="h-1.5 w-32 overflow-hidden rounded-full bg-[var(--surface-inset)]"
                aria-hidden
              >
                <span
                  className="block h-full rounded-full bg-[var(--brand-primary)]"
                  style={{ width: `${pct}%` }}
                />
              </span>
            ) : (
              <span className="tabular-nums">
                {`${b.summary.withRevenue ?? 0} with revenue, ${b.summary.withHeadcountGrowth ?? 0} with headcount growth, ${b.summary.withNewRoles30d ?? 0} with new roles (30d)`}
                {b.failed ? `, ${b.failed} failed` : ''}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
