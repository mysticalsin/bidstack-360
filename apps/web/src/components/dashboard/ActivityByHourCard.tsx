// Org-wide "when does the team work its bids": the latest activities bucketed
// by hour of day in the viewer's zone. Counts only; nothing is estimated.
import { useMemo } from 'react';

import { activityByHour } from '@/components/charts/bid-chart-data';
import { RadialDots } from '@/components/charts/tuffui/radial-dots';
import { ChartCard } from '@/components/viz/ChartCard';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useHasPermission } from '@/hooks/useCapabilities';
import { browserTimeZone } from '@/lib/timezone';

import { activityHourPhase } from './activity-hour-read';

const CHECKING = 'Checking activity by hour. The log has not arrived.';
const FAILED = 'Could not load activity.';
const EMPTY = 'No activity logged yet.';

export function ActivityByHourCard() {
  const canRead = useHasPermission('activities:read');
  const feed = useActivityFeed(100, canRead);
  const tz = browserTimeZone();
  const phase = activityHourPhase({
    data: feed.data,
    isError: feed.isError,
    status: feed.status,
  });
  const hours = useMemo(
    () => activityByHour(phase === 'ready' && feed.data ? feed.data.items : [], tz),
    [feed.data, phase, tz],
  );

  if (!canRead) return null;

  const busiest = hours.labels.reduce(
    (best, label, i) => {
      const n = hours.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
      return n > best.n ? { label, n } : best;
    },
    { label: '', n: 0 },
  );
  const summary =
    phase === 'unread'
      ? CHECKING
      : phase === 'failed'
        ? FAILED
        : hours.total
          ? `${hours.total} activities, busiest at ${busiest.label}:00 with ${busiest.n}.`
          : EMPTY;
  const meta =
    phase === 'ready'
      ? feed.data && feed.data.total > hours.total
        ? `Latest ${hours.total} of ${feed.data.total}`
        : `${hours.total} logged`
      : undefined;

  return (
    <ChartCard
      testId="dashboard-activity-hours"
      title="Activity by hour"
      meta={meta}
      interactive
      summary={summary}
      table={
        phase === 'ready'
          ? {
              columns: ['Hour', ...hours.series.map((s) => s.label)],
              rows: hours.labels.map((h, i) => [`${h}:00`, ...hours.series.map((s) => s.values[i] ?? 0)]),
            }
          : undefined
      }
    >
      {phase === 'unread' ? (
        <p role="status" className="viz-empty">
          {CHECKING}
        </p>
      ) : phase === 'failed' ? (
        <p role="alert" className="viz-empty">
          {FAILED}
        </p>
      ) : hours.total ? (
        <RadialDots
          title="Activity by hour"
          labels={hours.labels}
          series={hours.series}
          center={{ value: String(hours.total), caption: 'activities' }}
          axis={[0, 6, 12, 18]}
        />
      ) : (
        <p className="viz-empty">{EMPTY}</p>
      )}
    </ChartCard>
  );
}
