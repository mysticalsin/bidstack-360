// Integrations → Data quality report. The /crm/data-quality endpoint
// inspects every company + deal in the snapshot and flags issues:
// duplicate domains, stale enrichments (>90 days), missing logos,
// missing deal owners, invalid domain syntax. We render a counts strip
// + a sortable issue list so an admin can triage during weekly cleanup.

import { Card, SectionHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useDataQuality } from '@/hooks/useCrmIntegrations';
import { relativeTime } from '@/lib/format';
import type { DataQualityIssue } from '@bidstack/shared';

const KIND_LABEL: Record<DataQualityIssue['kind'], string> = {
  duplicate_company: 'Duplicate company',
  stale_enrichment: 'Stale enrichment',
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

  return (
    <Card>
      <SectionHeader
        title="Data quality"
        caption={
          data
            ? `Report generated ${relativeTime(data.generatedAt)} · ${issues.length} issue${
                issues.length === 1 ? '' : 's'
              }`
            : 'Detects duplicate companies, stale enrichments, missing owners, and bad domains.'
        }
      />
      {isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : isError ? (
        <ErrorState
          title="Could not load data quality report"
          message={error instanceof Error ? error.message : undefined}
          action={
            <button
              type="button"
              className="text-xs text-[var(--brand-primary)] underline"
              onClick={() => refetch()}
            >
              Try again
            </button>
          }
        />
      ) : !data || issues.length === 0 ? (
        <EmptyState
          title="No data quality issues"
          message="Your CRM data is clean — duplicates, stale enrichments, and missing owners are all clear."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-5 pt-4 sm:grid-cols-5">
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
    </Card>
  );
}

function IssueRow({ issue }: { issue: DataQualityIssue }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
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

function byPriority(a: DataQualityIssue, b: DataQualityIssue) {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
}
