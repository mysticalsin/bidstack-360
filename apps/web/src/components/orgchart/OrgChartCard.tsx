// Compact org chart card on the account page; drills into the full chart.
// The preview is a two-level tree (top role, then direct reports) with real
// connectors. A wide level scrolls; anything past the preview cap is counted.
import './orgchart.css';

import { isOrgChartSenior } from '@bidstack/shared';
import { Link } from 'react-router-dom';

import { useOrgChart } from '@/hooks/useOrgChart';
import { childrenOf } from '@/lib/orgchart/tree';
import type { NodeCov, OrgNode } from '@/lib/orgchart/types';

import { OrgPhoto } from './OrgPhoto';

const PREVIEW_LIMIT = 8;

export function OrgChartCard({ companyId }: { companyId: string }) {
  const { chart, covOf, unmetSenior, live, isLoading, error } = useOrgChart(companyId);
  const nodes = chart?.nodes ?? [];
  const root = nodes.find((n) => n.id === chart?.rootId);
  const reports = root ? (childrenOf(nodes).get(root.id) ?? []) : [];
  const shown = reports.slice(0, PREVIEW_LIMIT);
  const extra = reports.length - shown.length;
  const met = nodes.filter((n) => covOf(n)?.met).length;
  // Live charts use the API's senior-gap list so the card matches the full page.
  const gaps = live ? unmetSenior.size : nodes.filter((n) => isOrgChartSenior(n.seniority) && !covOf(n)?.met).length;
  return (
    <section className="en-section oc-card" aria-labelledby="oc-card-h" data-testid="account-orgchart-card" style={{ marginBottom: 24 }}>
      <div className="en-head">
        <h2 id="oc-card-h">Org chart</h2>
        {chart?.sample ? <span className="en-sample">Sample</span> : null}
      </div>
      {error ? <p className="en-meta">The org chart could not be loaded.</p> : isLoading ? (
        <div className="oc-card-status" role="status" data-testid="orgchart-loading">
          <p className="en-meta">Loading…</p>
          <div className="oc-skel-tree" aria-hidden="true">
            <span className="oc-skel" />
            <i />
            <div className="oc-skel-row"><span className="oc-skel" /><span className="oc-skel" /><span className="oc-skel" /></div>
          </div>
        </div>
      ) : (
        <>
          <p className="en-meta">{nodes.length} people · met {met} ({nodes.length ? Math.round((met / nodes.length) * 100) : 0}%) · {gaps} senior gap{gaps === 1 ? '' : 's'}</p>
          {root ? (
            <div className="oc-card-scroll">
              <ul className="oc-tree" aria-label={`Top of the chart: ${root.name} and ${reports.length} direct reports`}>
                <li>
                  <CardPerson n={root} cov={covOf(root)} />
                  {shown.length > 0 ? (
                    <ul>
                      {shown.map((n) => (
                        <li key={n.id}><CardPerson n={n} cov={covOf(n)} /></li>
                      ))}
                      {extra > 0 ? (
                        <li>
                          <span className="oc-card-more" title={`${extra} more direct reports on the full chart`}>+{extra}</span>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </li>
              </ul>
            </div>
          ) : (
            <div className="oc-card-status" data-testid="orgchart-empty">
              <span className="oc-empty-mark" aria-hidden="true" />
              <p className="en-meta">{nodes.length ? 'People are on file, but nobody is at the top of the chart yet.' : 'No people on this chart yet.'}</p>
            </div>
          )}
          <p className="en-src">{chart?.sample ? 'Nobody has charted this account yet. People you have met are real; the rest is a placeholder structure.' : `Saved chart, updated ${chart?.updatedAt ? new Date(chart.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'recently'}.`} Green ring: met.</p>
        </>
      )}
      <div><Link className="en-link" to={`/accounts/${companyId}/org-chart`} data-testid="account-orgchart-open">Open org chart</Link></div>
    </section>
  );
}

function CardPerson({ n, cov }: { n: OrgNode; cov: NodeCov | undefined }) {
  const role = n.title ?? 'No title';
  return (
    <span className="oc-card-p" data-name={n.name}>
      <span className="oc-ava" data-ring={cov?.met ? 'met' : 'gap'} aria-hidden="true"><OrgPhoto url={n.photoUrl} name={n.name} /></span>
      <span className="n" title={n.name}>{n.name}</span>
      <span className="t" title={role}>{role}</span>
    </span>
  );
}
