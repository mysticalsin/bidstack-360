// Live-updating relative time. Recomputes the formatted string on a schedule
// that grows as the input ages: seconds resolution for the first minute,
// minute resolution for the first hour, hour resolution for the first day,
// then static. Means a "2m ago" label rolls over to "3m ago" without
// requiring the parent to refetch.
//
// We intentionally avoid `setInterval(1s)` for *every* node because a list
// with 200 timestamps would fire 200 timers per second. Each node schedules
// its own next-update based on its own age — the next tick is exactly when
// the formatted output would change.

import { useEffect, useState } from 'react';

import { relativeTime } from '@/lib/format';

function nextDelayMs(ageMs: number): number {
  if (ageMs < 60_000) return 1000; // < 1 min → tick every second
  if (ageMs < 60 * 60_000) return 60_000; // < 1 hr → every minute
  if (ageMs < 24 * 60 * 60_000) return 60 * 60_000; // < 1 day → every hour
  return 24 * 60 * 60_000; // older → daily refresh, mostly irrelevant
}

export function useLiveRelativeTime(iso: string | null | undefined): string {
  const [, force] = useState(0);

  useEffect(() => {
    if (!iso) return;
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return;
    let handle: number;
    const schedule = () => {
      const delay = nextDelayMs(Date.now() - ts);
      handle = window.setTimeout(() => {
        force((n) => n + 1);
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(handle);
  }, [iso]);

  return iso ? relativeTime(iso) : '—';
}
