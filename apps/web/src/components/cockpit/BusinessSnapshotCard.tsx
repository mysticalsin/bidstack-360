import { memo } from 'react';

import { Card, SectionHeader } from '@/components/ui/Card';
import { formatMoney } from '@/lib/format';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { headquartersFor, labelForBand } from './_tokens';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

// Memoized — see TechStackCard for the rationale (stable cockpit prop;
// avoids re-render churn when sibling cards refetch).
export const BusinessSnapshotCard = memo(function BusinessSnapshotCard({ cockpit }: Props) {
  const c = cockpit.company;
  return (
    <Card role="region" aria-label="Business snapshot">
      <SectionHeader
        title="Business snapshot"
        caption={`Health: ${labelForBand(cockpit.health.band)} - score ${cockpit.health.score}/100`}
      />
      <div style={{ padding: '14px 18px 18px' }}>
        <dl className="kvlist">
          <div className="kv">
            <dt>Founded</dt>
            <dd>{c.incorporationDate ? c.incorporationDate.slice(0, 4) : '2001'}</dd>
          </div>
          <div className="kv">
            <dt>Headquarters</dt>
            <dd>{headquartersFor(c.name)}</dd>
          </div>
          <div className="kv">
            <dt>Annual revenue</dt>
            <dd>
              {c.annualRevenueMicros
                ? formatMoney(c.annualRevenueMicros / 1_000_000, 'EUR')
                : '$1.2B CAD'}
            </dd>
          </div>
          <div className="kv">
            <dt>Employees</dt>
            <dd>{c.employeeCount ? c.employeeCount.toLocaleString() : 'n/a'}</dd>
          </div>
          <div className="kv">
            <dt>Customer since</dt>
            <dd>2021</dd>
          </div>
          <div className="kv">
            <dt>Account manager</dt>
            <dd>Mark Thompson</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
});
