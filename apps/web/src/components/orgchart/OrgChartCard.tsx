// Compact org chart card on the account page; drills into the full chart.
import './orgchart.css';

import { isOrgChartSenior } from '@bidstack/shared';
import { Link } from 'react-router-dom';

import { useOrgChart } from '@/hooks/useOrgChart';
import { childrenOf } from '@/lib/orgchart/tree';
import type { NodeCov, OrgNode } from '@/lib/orgchart/types';

import { OrgPhoto } from './OrgPhoto';


export function OrgChartCard({ companyId }: { companyId: string }) {
  const { chart, covOf, unmetSenior, live, isLoading, error } = useOrgChart(companyId);
  const nodes = chart?.nodes ?? [];
  const root = nodes.find((n) => n.id === chart?.rootId);
  const reports = root ? (childrenOf(nodes).get(root.id) ?? []) : [];
  const met = nodes.filter((n) => covOf(n)?.met).length;
  // Live charts use the API's senior-gap list so the card matches the full page.
  const gaps = live ? unmetSenior.size : nodes.filter((n) => isOrgChartSenior(n.seniority) && !covOf(n)?.met).length;
  return (
    <section className="en-section oc-card" aria-labelledby="oc-card-h" data-testid="account-orgchart-card" style={{ marginBottom: 24 }}>
      <div className="en-head">
        <h2 id="oc-card-h">Org chart</h2>
        {chart?.sample ? <span className="en-sample">Sample</span> : null}
      </div>
      {error ? <p className="en-meta">The org chart could not be loaded.</p> : isLoading ? <p className="en-meta">Loading…</p> : (
        <>
          <p className="en-meta">{nodes.length} people · met {met} ({nodes.length ? Math.round((met / nodes.length) * 100) : 0}%) · {gaps} senior gap{gaps === 1 ? '' : 's'}</p>
          {root ? (
            <div className="oc-card-tree" aria-label={`Top of the chart: ${root.name} and ${reports.length} direct reports`}>
              <div className="oc-card-root"><CardPerson n={root} cov={covOf(root)} /></div>
              <div className="oc-card-row">{reports.slice(0, 6).map((n) => <CardPerson key={n.id} n={n} cov={covOf(n)} />)}{reports.length > 6 ? <span className="en-meta">+{reports.length - 6}</span> : null}</div>
            </div>
          ) : null}
          <p className="en-src">{chart?.sample ? 'Nobody has charted this account yet. People you have met are real; the rest is a placeholder structure.' : `Saved chart, updated ${chart?.updatedAt ? new Date(chart.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'recently'}.`} Green ring: met.</p>
        </>
      )}
      <div><Link className="en-link" to={`/accounts/${companyId}/org-chart`} data-testid="account-orgchart-open">Open org chart</Link></div>
    </section>
  );
}

function CardPerson({ n, cov }: { n: OrgNode; cov: NodeCov | undefined }) {
  return (
    <span className="oc-card-p">
      <span className="oc-ava" data-ring={cov?.met ? 'met' : 'gap'} aria-hidden="true"><OrgPhoto url={n.photoUrl} name={n.name} /></span>
      <span className="n">{n.name}</span>
      <span className="t">{n.title}</span>
    </span>
  );
}
