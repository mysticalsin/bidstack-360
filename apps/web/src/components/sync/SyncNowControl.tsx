import { CheckCircle2, CircleAlert, RefreshCw } from 'lucide-react';

import type { SyncSource } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { useSyncNow } from '@/hooks/useSyncNow';
import { cn } from '@/lib/cn';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

function relative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  for (const [unit, ms] of STEPS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

/**
 * Reusable "Sync now" control for pull sources: the button, when the source
 * last synced, a progress row while a run is going, and the run result.
 */
export function SyncNowControl({
  source,
  pollMs,
  className,
}: {
  source: SyncSource;
  pollMs?: number;
  className?: string;
}) {
  const { lastSyncedAt, run, busy, startError, start } = useSyncNow(source, pollMs);
  const going = busy || run?.state === 'queued' || run?.state === 'running';
  const showProgress = going && run !== null;
  const result = run?.state === 'completed' || run?.state === 'failed' ? run : null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={start}
          disabled={going}
          aria-busy={going || undefined}
        >
          <RefreshCw size={14} aria-hidden="true" className={cn(going && 'animate-spin')} />
          {going ? 'Syncing' : 'Sync now'}
        </Button>
        <span className="text-xs text-[var(--fg-tertiary)]">
          {lastSyncedAt ? (
            <time dateTime={lastSyncedAt} title={new Date(lastSyncedAt).toLocaleString()}>
              {`Last synced ${relative(lastSyncedAt)}`}
            </time>
          ) : (
            'Never synced'
          )}
        </span>
      </div>

      {showProgress && (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Sync progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={run.progress}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
          >
            <div
              className="h-full rounded-full bg-[var(--brand-primary)] transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(run.progress, 4)}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono text-xs text-[var(--fg-tertiary)] tabular-nums">
            {`${run.progress}%`}
          </span>
        </div>
      )}

      {startError && (
        <span role="alert" className="flex items-center gap-1.5 text-xs text-[var(--fg-error)]">
          <CircleAlert size={14} aria-hidden="true" />
          {startError instanceof Error ? startError.message : 'Sync did not start'}
        </span>
      )}

      {result && (
        <div className="flex flex-col gap-2">
          <ul
            aria-label="Sync result"
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--fg-secondary)]"
          >
            <li className="flex items-center gap-1.5">
              {result.state === 'failed' ? (
                <CircleAlert size={14} aria-hidden="true" className="text-[var(--fg-error)]" />
              ) : (
                <CheckCircle2 size={14} aria-hidden="true" className="text-[var(--fg-jade)]" />
              )}
              {result.state === 'failed' ? 'Failed' : 'Done'}
            </li>
            {(
              [
                ['New', result.result?.new],
                ['Updated', result.result?.updated],
                ['Skipped', result.result?.skipped],
                ['Failed', result.result?.failed],
              ] as const
            )
              .filter(([, value]) => value !== undefined)
              .map(([label, value]) => (
                <li key={label} className="flex items-baseline gap-1">
                  <span>{label}</span>
                  <span className="font-mono text-[var(--fg-primary)] tabular-nums">{value}</span>
                </li>
              ))}
          </ul>
          {result.reasons.length > 0 && (
            <ul
              aria-label="Sync notes"
              className="flex flex-col gap-0.5 text-xs text-[var(--fg-tertiary)]"
            >
              {result.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
