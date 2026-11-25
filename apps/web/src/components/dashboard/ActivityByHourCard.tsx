// Org-wide "when does the team work its bids": the latest activities bucketed
// by hour of day in the viewer's zone. The chart is the count. The same hour
// lists the work and opens the bid it was filed on. Nothing is estimated.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { activityByHour } from '@/components/charts/bid-chart-data';
import { RadialDots } from '@/components/charts/tuffui/radial-dots';
import { ChartCard } from '@/components/viz/ChartCard';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useHasPermission } from '@/hooks/useCapabilities';
import { browserTimeZone } from '@/lib/timezone';

import { bidsInHour } from './activity-hour-bids';

const pad = (hour: number) => String(hour).padStart(2, '0');

function hourCounts(series: Array<{ values: number[] }>): number[] {
  const counts = new Array<number>(24).fill(0);
  for (const row of series) {
    row.values.forEach((value, index) => {
      counts[index] = (counts[index] ?? 0) + (value ?? 0);
    });
  }
  return counts;
}

/** Earliest hour wins a tie, matching the chart's busiest slot. */
function busiestHour(counts: number[]): number | null {
  let best = -1;
  let peak = 0;
  counts.forEach((count, hour) => {
    if (count > peak) {
      peak = count;
      best = hour;
    }
  });
  return best === -1 ? null : best;
}

export function ActivityByHourCard() {
  const canRead = useHasPermission('activities:read');
  const { data, isLoading, isError, refetch } = useActivityFeed(100, canRead);
  const tz = browserTimeZone();
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const hours = useMemo(() => activityByHour(items, tz), [items, tz]);
  const counts = useMemo(() => hourCounts(hours.series), [hours.series]);
  const [picked, setPicked] = useState<number | null>(null);

  if (!canRead) return null;

  const settled = !isLoading && !isError;
  const peak = busiestHour(counts);
  const active = picked !== null && (counts[picked] ?? 0) > 0 ? picked : peak;
  const atHour = settled && active !== null ? bidsInHour(items, active, tz) : null;
  const choices = counts.flatMap((count, hour) => (count > 0 ? [hour] : []));
  const summary = !settled
    ? isLoading
      ? 'Loading activity.'
      : 'Could not load activity.'
    : hours.total && peak !== null
      ? `${hours.total} activities, busiest at ${pad(peak)}:00 with ${counts[peak]}.`
      : 'No activity logged yet.';

  return (
    <ChartCard
      testId="dashboard-activity-hours"
      title="Activity by hour"
      meta={
        !settled
          ? isLoading
            ? 'Loading'
            : 'Could not load'
          : data && data.total > hours.total
            ? `Latest ${hours.total} of ${data.total}`
            : `${hours.total} logged`
      }
      interactive
      summary={summary}
      table={
        settled && hours.total
          ? {
              columns: ['Hour', ...hours.series.map((s) => s.label)],
              rows: hours.labels.map((h, i) => [`${h}:00`, ...hours.series.map((s) => s.values[i] ?? 0)]),
            }
          : undefined
      }
    >
      {isLoading ? (
        <p className="viz-empty">Loading activity.</p>
      ) : isError ? (
        <>
          <p className="viz-empty">Could not load activity.</p>
          <button type="button" className="btn btn-secondary" onClick={() => void refetch()}>
            Retry
          </button>
        </>
      ) : hours.total ? (
        <>
          <RadialDots
            title="Activity by hour"
            labels={hours.labels}
            series={hours.series}
            center={{ value: String(hours.total), caption: 'activities' }}
            axis={[0, 6, 12, 18]}
          />
          {choices.length > 1 ? (
            <ul
              className="dash-chips"
              aria-label="Hours with activity"
              style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}
            >
              {choices.map((hour) => {
                const count = counts[hour] ?? 0;
                return (
                  <li key={hour}>
                    <button
                      type="button"
                      className="dash-chip"
                      style={{ minHeight: 44 }}
                      aria-pressed={hour === active}
                      aria-label={`${pad(hour)}:00, ${count} ${count === 1 ? 'activity' : 'activities'}`}
                      onClick={() => setPicked(hour)}
                    >
                      {pad(hour)}:00
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {atHour && active !== null ? (
            <HourBids hour={active} links={atHour.links} unnamed={atHour.unnamed} />
          ) : null}
        </>
      ) : (
        <p className="viz-empty">No activity logged yet.</p>
      )}
    </ChartCard>
  );
}

function HourBids({
  hour,
  links,
  unnamed,
}: {
  hour: number;
  links: Array<{ subject: string; href: string | null }>;
  unnamed: number;
}) {
  return (
    <div>
      <p className="viz-caption">At {pad(hour)}:00</p>
      {links.length ? (
        <ul aria-label={`Bids logged at ${pad(hour)}:00`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {links.map((link, index) => (
            <li key={`${link.href ?? 'text'}-${link.subject}-${index}`}>
              {link.href ? (
                <Link
                  to={link.href}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--fg-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
                >
                  {link.subject}
                </Link>
              ) : (
                <span className="inline-flex min-h-11 items-center text-sm text-[var(--fg-secondary)]">{link.subject}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {unnamed > 0 ? (
        <p className="viz-caption">
          {unnamed === 1
            ? '1 logged activity is not on a bid.'
            : `${unnamed} logged activities are not on a bid.`}
        </p>
      ) : null}
    </div>
  );
}
