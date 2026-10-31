// Compact org chart card on the account page; drills into the full chart.
import './orgchart.css';

import { Link } from 'react-router-dom';

import { useOrgChart } from '@/hooks/useOrgChart';
import { coverageFor } from '@/lib/orgchart/coverage';
import { childrenOf, initials } from '@/lib/orgchart/tree';
import type { OrgNode, PersonCoverage } from '@/lib/orgchart/types';

export function OrgChartCard({ companyId }: { companyId: string }) {
  const { chart, coverage, isLoading } = useOrgChart(companyId);
  const nodes = chart?.nodes ?? [];
  const root = nodes.find((n) => n.id === chart?.rootId);
  const reports = root ? (childrenOf(nodes).get(root.id) ?? []) : [];
  const met = nodes.filter((n) => coverageFor(coverage, n)?.meetings.length).length;
  const gaps = nodes.filter((n) => ['c_level', 'vp', 'director'].includes(n.seniority) && !coverageFor(coverage, n)?.meetings.length).length;
  return (
    <section className="en-section oc-card" aria-labelledby="oc-card-h" data-testid="account-orgchart-card" style={{ marginBottom: 24 }}>
      <div className="en-head">
        <h2 id="oc-card-h">Org chart</h2>
        {chart?.sample ? <span className="en-sample">Sample</span> : null}
      </div>
      {isLoading ? <p className="en-meta">Loading…</p> : (
        <>
          <p className="en-meta">{nodes.length} people · met {met} ({nodes.length ? Math.round((met / nodes.length) * 100) : 0}%) · {gaps} senior gap{gaps === 1 ? '' : 's'}</p>
          {root ? (
            <div className="oc-card-tree" aria-label={`Top of the chart: ${root.name} and ${reports.length} direct reports`}>
              <div className="oc-card-root"><CardPerson n={root} coverage={coverage} /></div>
              <div className="oc-card-row">{reports.slice(0, 6).map((n) => <CardPerson key={n.id} n={n} coverage={coverage} />)}{reports.length > 6 ? <span className="en-meta">+{reports.length - 6}</span> : null}</div>
            </div>
          ) : null}
          <p className="en-src">{chart?.sample ? 'People you have met are real; the rest is a placeholder structure.' : `Saved ${chart?.updatedBy ? `by ${chart.updatedBy}` : ''}.`} Green ring: met.</p>
        </>
      )}
      <div><Link className="en-link" to={`/accounts/${companyId}/org-chart`} data-testid="account-orgchart-open">Open org chart</Link></div>
    </section>
  );
}

function CardPerson({ n, coverage }: { n: OrgNode; coverage: Map<string, PersonCoverage> }) {
  return (
    <span className="oc-card-p">
      <span className="oc-ava" data-ring={coverageFor(coverage, n)?.meetings.length ? 'met' : 'gap'} aria-hidden="true"><span>{initials(n.name)}</span></span>
      <span className="n">{n.name}</span>
      <span className="t">{n.title}</span>
    </span>
  );
}
