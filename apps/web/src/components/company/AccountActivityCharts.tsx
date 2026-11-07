import { CalendarRange, Clock } from 'lucide-react';
import type { ReactNode } from 'react';

import { ACTIVITY_SUMMARY_DEFAULT_WEEKS } from '@bidstack/shared';

import { DivergingBars } from '@/components/charts/tuffui/diverging-bars';
import { RadialDots } from '@/components/charts/tuffui/radial-dots';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useCompanyActivitySummary } from '@/hooks/useCompanyActivitySummary';
import { browserTimeZone } from '@/lib/timezone';

const TYPES = [
  { id: 'call', label: 'Calls' },
  { id: 'email', label: 'Emails' },
  { id: 'meeting', label: 'Meetings' },
  { id: 'note', label: 'Notes' },
  { id: 'stage_change', label: 'Stage changes' },
] as const;

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

const weekLabel = (isoDay: string) =>
  new Date(`${isoDay}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

function ChartCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] p-4">
        <span aria-hidden="true" className="text-[var(--fg-tertiary)]">
          {icon}
        </span>
        <h2 className="text-base font-semibold text-[var(--fg-primary)]">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

const COMPANY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The summary route takes a company UUID and needs `activities:read`. Without
 * either, the request would be a 4xx (the browser logs those as console
 * errors), so the section stays out of the page and nothing is fetched.
 */
export function AccountActivityCharts({ companyId }: { companyId: string }) {
  const tz = browserTimeZone();
  const canRead = useHasPermission('activities:read');
  const eligible = canRead && COMPANY_ID_RE.test(companyId);
  const { data, isLoading, isError, refetch } = useCompanyActivitySummary(
    eligible ? companyId : undefined,
    tz,
  );

  if (!eligible) return null;

  if (isLoading) {
    return (
      <Card>
        <LoadingSkeleton rows={3} />
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <div role="alert" className="flex items-center justify-between gap-3 p-4 text-sm">
          <span className="text-[var(--fg-secondary)]">Account activity did not load.</span>
          <Button variant="secondary" size="sm" onClick={() => void refetch?.()}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (data.total === 0 && data.overdue.count === 0) {
    return (
      <Card>
        <div className="p-4 text-sm text-[var(--fg-secondary)]">
          {`No activity in the last ${ACTIVITY_SUMMARY_DEFAULT_WEEKS} weeks.`}
        </div>
      </Card>
    );
  }

  const present = TYPES.filter(
    (t) => data.byHour.some((h) => h[t.id] > 0) || data.weekly.some((w) => w[t.id] > 0),
  );
  const shown = present.length > 0 ? present : TYPES.slice(0, 1);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <ChartCard icon={<Clock size={16} />} title="Activity by hour">
        <RadialDots
          title="Activity by hour"
          labels={HOURS}
          series={shown.map((t) => ({
            id: t.id,
            label: t.label,
            values: data.byHour.map((h) => h[t.id]),
          }))}
          center={{ value: data.total.toLocaleString('en-US'), caption: 'activities' }}
        />
      </ChartCard>
      <ChartCard icon={<CalendarRange size={16} />} title="Activity per week">
        <DivergingBars
          title="Activity per week"
          labels={data.weekly.map((w) => weekLabel(w.weekStart))}
          series={shown.map((t) => ({
            id: t.id,
            label: t.label,
            values: data.weekly.map((w) => w[t.id]),
          }))}
          below={{
            id: 'overdue',
            label: 'Overdue',
            values: data.weekly.map((w) => w.overdue),
          }}
        />
      </ChartCard>
    </div>
  );
}
