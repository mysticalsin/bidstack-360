import { memo } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateMessages';

import type { ComplianceCheck, RiskItem } from '@bidstack/shared';

import { severityBg, severityShort, severityTone } from './_tokens';

interface Props {
  risks: RiskItem[];
  compliance: ComplianceCheck[];
}

// Memoized — render is pure on risks+compliance arrays, both stable per
// snapshot fetch. Avoids re-render when sibling cards refetch.
export const OpenIssuesCard = memo(function OpenIssuesCard({ risks, compliance }: Props) {
  const openRisks = risks.filter((r) => r.status === 'open' || r.status === 'in_progress');
  const openCompliance = compliance.filter(
    (c) => c.status === 'blocked' || c.status === 'in_progress' || c.status === 'not_started',
  );
  const total = openRisks.length + openCompliance.length;
  // Severity buckets are computed against the full risk list (not just open)
  // so the bar reflects the registry total rather than "what's left today".
  const buckets = [
    {
      label: 'Critical',
      count: risks.filter((risk) => risk.severity === 'critical').length,
      tone: 'tomato',
    },
    {
      label: 'High',
      count: risks.filter((risk) => risk.severity === 'high').length,
      tone: 'amber',
    },
    {
      label: 'Medium',
      count: risks.filter((risk) => risk.severity === 'medium').length,
      tone: 'blue',
    },
    { label: 'Low', count: risks.filter((risk) => risk.severity === 'low').length, tone: 'gray' },
  ] as const;

  return (
    <Card role="region" aria-label="Open issues by severity">
      <SectionHeader
        title="Open issues"
        caption={total === 0 ? 'All clear' : `${total} item${total === 1 ? '' : 's'} to action`}
      />
      <div style={{ padding: '8px 18px 14px' }}>
        <div className="issue-buckets" aria-label="Severity buckets">
          {buckets.map((bucket) => (
            <div key={bucket.label} className="issue-bucket">
              <Badge tone={bucket.tone}>{bucket.label}</Badge>
              <strong>{bucket.count}</strong>
            </div>
          ))}
        </div>
        {total === 0 ? (
          <EmptyState title="No open issues" message="Everything is green here." />
        ) : (
          <ul className="open-issues">
            {openRisks.slice(0, 4).map((r) => (
              <li key={r.id}>
                <span className="oi-count" style={{ background: severityBg(r.severity) }}>
                  {severityShort(r.severity)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-primary)' }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-tertiary)' }}>
                    {r.owner ?? 'Unassigned'}
                    {r.dueDate ? ` - due ${r.dueDate}` : ''}
                  </div>
                </div>
                <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
              </li>
            ))}
            {openCompliance.slice(0, 2).map((c) => (
              <li key={c.id}>
                <span className="oi-count" style={{ background: 'var(--tag-amber-bg)' }}>
                  C
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-primary)' }}>
                    {c.label}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-tertiary)' }}>
                    {c.owner ?? 'No owner'}
                  </div>
                </div>
                <Badge tone="amber">{c.status.replace('_', ' ')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
});
