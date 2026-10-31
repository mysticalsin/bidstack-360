// "Hiring now": open roles at a glance (total, new in 30 days, top functions);
// "Breakdown" opens function / seniority / region charts and the roles behind them.
import './enrichment.css';

import { useId, useState } from 'react';

import { useCompanyEnrichment } from '@/hooks/useCompanyEnrichment';
import { breakdown, DIMENSIONS, recentCount, type Dimension } from '@/lib/enrichment/aggregate';
import { fmtAsOf } from '@/lib/enrichment/client';

import { CountBars } from './CountBars';
import { SampleBadge, SourceNote } from './SourceNote';

const TOP_FUNCTIONS = 3;
const TOP_ROLES = 6;

export function HiringNowCard({ companyId }: { companyId: string }) {
  const q = useCompanyEnrichment(companyId);
  const [open, setOpen] = useState(false);
  const [dim, setDim] = useState<Dimension>('function');
  const [allRoles, setAllRoles] = useState(false);
  const id = useId();
  if (!q.data) return null;
  const { roles, source, asOf } = q.data.hiring;
  const fresh = recentCount(roles, asOf, 30);
  const byFn = breakdown(roles, 'function');
  const rows = breakdown(roles, dim);
  const dimLabel = DIMENSIONS.find((d) => d.id === dim)!.label.toLowerCase();
  const list = [...roles].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  const shown = allRoles ? list : list.slice(0, TOP_ROLES);
  return (
    <section className="en-section" aria-labelledby={`${id}-h`} data-testid="account-hiring-now">
      <header className="en-head">
        <h2 id={`${id}-h`}>Hiring now</h2>
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <SampleBadge show={q.data.sample} />
          {roles.length ? (
            <button type="button" className="en-link" aria-expanded={open} aria-controls={`${id}-d`} onClick={() => setOpen((v) => !v)} data-testid="hiring-breakdown">
              {open ? 'Hide breakdown' : 'Breakdown'}
            </button>
          ) : null}
        </span>
      </header>
      {roles.length === 0 ? (
        <p className="en-meta">No open roles found.</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
            <span className="en-big">{roles.length}</span>
            <span className="en-meta">open roles · {fresh} posted in the last 30 days</span>
          </div>
          <CountBars rows={byFn.slice(0, TOP_FUNCTIONS)} label={`Top ${TOP_FUNCTIONS} functions by open roles`} />
          <SourceNote source={source} asOf={asOf} />
        </>
      )}
      {open ? (
        <div id={`${id}-d`} className="en-drill" data-testid="hiring-drill">
          <div
            role="tablist"
            aria-label="Break down open roles by"
            className="en-tabs"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = DIMENSIONS.findIndex((d) => d.id === dim);
              const next = DIMENSIONS[(i + (e.key === 'ArrowRight' ? 1 : DIMENSIONS.length - 1)) % DIMENSIONS.length]!;
              setDim(next.id);
              (e.currentTarget.querySelector(`[data-dim="${next.id}"]`) as HTMLElement | null)?.focus();
            }}
          >
            {DIMENSIONS.map((d) => (
              <button key={d.id} type="button" role="tab" data-dim={d.id} className="en-tab" aria-selected={dim === d.id} tabIndex={dim === d.id ? 0 : -1} aria-controls={`${id}-p`} onClick={() => setDim(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
          <div id={`${id}-p`} role="tabpanel" aria-label={`Open roles by ${dimLabel}`}>
            <CountBars rows={rows} label={`Open roles by ${dimLabel}`} />
          </div>
          <h3 className="en-meta" style={{ fontWeight: 500, margin: 0 }}>Latest postings</h3>
          <ul className="en-list">
            {shown.map((r) => (
              <li key={r.id}>
                <span className="en-row-title">{r.title}</span>
                <span className="en-row-meta">
                  {r.function} · {r.seniority} · {r.location}
                </span>
                <p className="en-src">
                  {r.source} · posted <time dateTime={r.postedAt}>{fmtAsOf(r.postedAt)}</time>
                </p>
              </li>
            ))}
          </ul>
          {list.length > TOP_ROLES ? (
            <button type="button" className="en-link" style={{ justifySelf: 'start' }} onClick={() => setAllRoles((v) => !v)}>
              {allRoles ? 'Show fewer' : `Show all ${list.length} roles`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
