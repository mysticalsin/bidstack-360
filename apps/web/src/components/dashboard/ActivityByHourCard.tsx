// Org-wide "when does the team work its bids": the latest activities bucketed
// by hour of day in the viewer's zone. Counts only; nothing is estimated.
import { useMemo } from 'react';

import { activityByHour } from '@/components/charts/bid-chart-data';
import { RadialDots } from '@/components/charts/tuffui/radial-dots';
import { ChartCard } from '@/components/viz/ChartCard';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useHasPermission } from '@/hooks/useCapabilities';
import { browserTimeZone } from '@/lib/timezone';

export function ActivityByHourCard() {
  const canRead = useHasPermission('activities:read');
  const { data, isLoading, isError } = useActivityFeed(100, canRead);
  const tz = browserTimeZone();
  const hours = useMemo(() => activityByHour(data?.items ?? [], tz), [data, tz]);

  if (!canRead) return null;

  const busiest = hours.labels.reduce(
    (best, label, i) => {
      const n = hours.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
      return n > best.n ? { label, n } : best;
    },
    { label: '', n: 0 },
  );

  return (
    <ChartCard
      testId="dashboard-activity-hours"
      title="Activity by hour"
      meta={data && data.total > hours.total ? `Latest ${hours.total} of ${data.total}` : `${hours.total} logged`}
      interactive
      summary={hours.total ? `${hours.total} activities, busiest at ${busiest.label}:00 with ${busiest.n}.` : 'No activity logged yet.'}
      table={{
        columns: ['Hour', ...hours.series.map((s) => s.label)],
        rows: hours.labels.map((h, i) => [`${h}:00`, ...hours.series.map((s) => s.values[i] ?? 0)]),
      }}
    >
      {isLoading ? (
        <p className="viz-empty">Loading activity.</p>
      ) : isError ? (
        <p className="viz-empty">Could not load activity.</p>
      ) : hours.total ? (
        <RadialDots
          title="Activity by hour"
          labels={hours.labels}
          series={hours.series}
          center={{ value: String(hours.total), caption: 'activities' }}
          axis={[0, 6, 12, 18]}
        />
      ) : (
        <p className="viz-empty">No activity logged yet.</p>
      )}
    </ChartCard>
  );
}
