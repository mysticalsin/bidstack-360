// Integrations → Data quality report. The /crm/data-quality endpoint
// inspects every company + deal in the snapshot and flags issues:
// duplicate domains, stale data (>90 days), missing logos,
// missing deal owners, invalid domain syntax. We render a counts strip
// + a sortable issue list so an admin can triage during weekly cleanup.

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useDataQuality } from '@/hooks/useCrmIntegrations';
import { relativeTime } from '@/lib/format';
import type { DataQualityIssue } from '@bidstack/shared';

const KIND_LABEL: Record<DataQualityIssue['kind'], string> = {
  duplicate_company: 'Duplicate company',
  stale_data: 'Stale data',
  missing_owner: 'Missing owner',
  invalid_domain: 'Invalid domain',
  missing_logo: 'Missing logo',
};

const SEVERITY_TONE: Record<DataQualityIssue['severity'], BadgeTone> = {
  low: 'gray',
  medium: 'amber',
  high: 'tomato',
};

const SEVERITY_ORDER: Record<DataQualityIssue['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function DataQualitySection() {
  const { data, isLoading, isError, error, refetch } = useDataQuality();

  const issues = data ? [...data.issues].sort(byPriority) : [];
  const highCount = issues.filter((issue) => issue.severity === 'high').length;
  const mediumCount = issues.filter((issue) => issue.severity === 'medium').length;
  const score = qualityScore(issues);

  return (
    <Card className="overflow-hidden border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <SectionHeader
        title="Data quality"
        caption={
          data
            ? `Report generated ${relativeTime(data.generatedAt)} · ${issues.length} issue${
                issues.length === 1 ? '' : 's'
              }`
            : 'Detects duplicate companies, stale data, missing owners, and bad domains.'
        }
        action={
          <Badge tone={score >= 90 ? 'jade' : score >= 70 ? 'amber' : 'tomato'}>
            {score}/100
          </Badge>
        }
      />
      {isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={4} />
        </div>
      ) : isError ? (
        <ErrorState
          title="Could not load data quality report"
          message={error instanceof Error ? error.message : undefined}
          action={
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      ) : !data ? (
        <EmptyState
          title="No data quality scan"
          message="Run the data quality scan to see duplicate domains, stale records, missing owners, invalid domains, and logo coverage."
        />
      ) : (
        <>
          <div className="grid gap-3 p-5 md:grid-cols-4">
            <DataQualityStat
              icon="shield"
              label="Quality score"
              value={`${score}/100`}
              tone={score >= 90 ? 'jade' : score >= 70 ? 'amber' : 'tomato'}
            />
            <DataQualityStat
              icon="warning"
              label="High severity"
              value={String(highCount)}
              tone={highCount > 0 ? 'tomato' : 'gray'}
            />
            <DataQualityStat
              icon="clock"
              label="Medium severity"
              value={String(mediumCount)}
              tone={mediumCount > 0 ? 'amber' : 'gray'}
            />
            <DataQualityStat
              icon="reports"
              label="Total issues"
              value={String(issues.length)}
              tone="blue"
            />
          </div>
          {issues.length === 0 ? (
            <div className="border-t border-[var(--border-subtle)]">
              <EmptyState
                title="No data quality issues"
                message="No duplicate domains, stale data, missing owners, invalid domains, or missing logos were detected in this scan."
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)] px-5 pt-4 sm:grid-cols-5">
                {(Object.keys(KIND_LABEL) as DataQualityIssue['kind'][]).map((kind) => (
                  <KindStat
                    key={kind}
                    label={KIND_LABEL[kind]}
                    count={data.counts[kind] ?? 0}
                    kind={kind}
                  />
                ))}
              </div>
              <ul className="mt-3 divide-y divide-[var(--border-subtle)]">
                {issues.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function DataQualityStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: IconName;
  label: string;
  value: string;
  tone: BadgeTone;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {label}
        </span>
        <span className="grid size-8 place-items-center rounded-xl bg-[var(--surface-primary)] text-[var(--text-secondary)]">
          <Icon name={icon} className="size-4" />
        </span>
      </div>
      <div className="mt-4 text-xl font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      <Badge tone={tone} className="mt-2">
        data
      </Badge>
    </div>
  );
}

function IssueRow({ issue }: { issue: DataQualityIssue }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 transition hover:bg-[var(--surface-secondary)]/70">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-9 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
            <Icon name={issue.severity === 'high' ? 'warning' : 'info'} className="size-4" />
          </span>
          <span className="text-sm font-medium text-[var(--fg-primary)]">{issue.title}</span>
          <Badge tone="gray">{KIND_LABEL[issue.kind]}</Badge>
        </div>
        {issue.detail ? (
          <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">{issue.detail}</p>
        ) : null}
        {issue.companyName ? (
          <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">Company: {issue.companyName}</p>
        ) : null}
      </div>
      <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
    </li>
  );
}

function KindStat({
  label,
  count,
  kind,
}: {
  label: string;
  count: number;
  kind: DataQualityIssue['kind'];
}) {
  // Highlight the severe categories (duplicates, missing owners) when they're
  // non-zero so the eye lands there first.
  const isHot = count > 0 && (kind === 'duplicate_company' || kind === 'missing_owner');
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-semibold tabular-nums ${
          isHot ? 'text-[var(--danger)]' : 'text-[var(--fg-primary)]'
        }`}
      >
        {count}
      </div>
    </div>
  );
}

function qualityScore(issues: DataQualityIssue[]) {
  const penalty = issues.reduce((total, issue) => {
    if (issue.severity === 'high') return total + 14;
    if (issue.severity === 'medium') return total + 7;
    return total + 3;
  }, 0);
  return Math.max(0, 100 - penalty);
}

function byPriority(a: DataQualityIssue, b: DataQualityIssue) {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
}
