// Slice 12 panels: direction, hiring, financials, news and posts. Every line
// names its basis and links the evidence it came from.
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react';

import {
  compactAmount,
  POST_KIND_LABEL,
  postingSourceLabel,
  type AccountDirection,
  type AccountFinancialsIntel,
  type AccountHiringIntel,
  type AccountNewsIntel,
  type IntelBasis,
  type IntelEvidence,
  type InvestmentThemeItem,
} from '@bidstack/shared';

import { fmtDate } from './intel-format';

const money = (n: number | null, currency: string | null) => (n === null ? null : `${compactAmount(n)}${currency ? ` ${currency}` : ''}`);
const pct = (n: number | null) => (n === null ? null : `${n > 0 ? '+' : ''}${Math.round(n)}%`);

function Basis({ basis }: { basis: IntelBasis }) {
  if (basis !== 'inferred') return null;
  return <span className="ci-basis">Inferred</span>;
}

function Trend({ value }: { value: number | null }) {
  if (value === null || value === 0) return null;
  const Icon = value > 0 ? ArrowUp : ArrowDown;
  return (
    <span className="ci-trend" data-tone={value > 0 ? 'pos' : 'neg'}>
      <Icon size={12} aria-hidden />
      {pct(value)}
    </span>
  );
}

function Cites({ ids, evidence }: { ids: string[]; evidence: Map<string, IntelEvidence> }) {
  const items = ids.map((id) => evidence.get(id)).filter((e): e is IntelEvidence => Boolean(e));
  if (!items.length) return null;
  return (
    <span className="ci-cites">
      {items.map((e) => {
        const text = `${e.sourceLabel}${e.locator ? ` ${e.locator}` : ''}`;
        const tip = `${e.excerpt} (fetched ${fmtDate(e.fetchedAt)})`;
        return e.url ? (
          <a key={e.id} className="ci-cite" href={e.url} target="_blank" rel="noopener noreferrer" title={tip}>
            {text}
          </a>
        ) : (
          <span key={e.id} className="ci-cite" title={tip} tabIndex={0}>
            {text}
          </span>
        );
      })}
    </span>
  );
}

function PlanColumn({ title, items, evidence }: { title: string; items: InvestmentThemeItem[]; evidence: Map<string, IntelEvidence> }) {
  return (
    <div className="ci-col">
      <h4 className="ci-k">{title}</h4>
      {items.length ? (
        <ul className="ci-list">
          {items.map((t) => (
            <li key={t.id} className="ci-line" data-testid={`plan-${t.id}`}>
              <span className="ci-line-head">
                <span className="ci-line-label">{t.label}</span>
                {t.amount !== null ? <span className="ci-num">{money(t.amount, t.currency)}</span> : null}
                <Trend value={t.trendPct} />
                <Basis basis={t.basis} />
              </span>
              <span className="ci-line-text">{t.summary}</span>
              <Cites ids={t.evidenceIds} evidence={evidence} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="ci-none">None found</p>
      )}
    </div>
  );
}

/** Direction: headline, cited claims, investment plan and bid relevance. */
export function DirectionPanel({ d }: { d: AccountDirection }) {
  const evidence = new Map(d.evidence.map((e) => [e.id, e]));
  return (
    <div className="ci-panel">
      {d.headline ? (
        <p className="ci-headline">
          <span>{d.headline.text}</span> <Basis basis={d.headline.basis} />
          <Cites ids={d.headline.evidenceIds} evidence={evidence} />
        </p>
      ) : (
        <p className="ci-none">No facts stored yet</p>
      )}
      {d.claims.length ? (
        <ul className="ci-list">
          {d.claims.map((c) => (
            <li key={c.id} className="ci-line" data-testid={`claim-${c.id}`}>
              <span className="ci-line-text">
                {c.text} <Basis basis={c.basis} />
              </span>
              <Cites ids={c.evidenceIds} evidence={evidence} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ci-plan">
        <PlanColumn title="Investing" items={d.investing} evidence={evidence} />
        <PlanColumn title="Cutting" items={d.cutting} evidence={evidence} />
        <PlanColumn title="Next 12 months" items={d.next12} evidence={evidence} />
      </div>
      {d.bidRelevance.length ? (
        <div className="ci-block">
          <h4 className="ci-k">Bid relevance</h4>
          <ul className="ci-list">
            {d.bidRelevance.map((b) => (
              <li key={b.theme} className="ci-line">
                <span className="ci-line-head">
                  <span className="ci-line-label">{b.offering}</span>
                  <span className="ci-tag">{b.label}</span>
                </span>
                <span className="ci-line-text">{b.pitch}</span>
                <span className="ci-line-text ci-step">{b.nextStep}</span>
                <Cites ids={b.evidenceIds} evidence={evidence} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Hiring: open roles, trend, monthly strip, function mix, skills, postings. */
export function HiringPanel({ h }: { h: AccountHiringIntel }) {
  const s = h.summary;
  const max = Math.max(1, ...s.monthly);
  return (
    <div className="ci-panel">
      <div className="ci-stats">
        <div className="ci-stat" data-testid="intel-open-roles">
          <span className="ci-k">Open roles</span>
          <span className="ci-big">{s.openRoles}</span>
        </div>
        <div className="ci-stat">
          <span className="ci-k">Posted, 30 days</span>
          <span className="ci-big">{s.posted30}</span>
          <Trend value={s.trend30Pct} />
        </div>
        <div className="ci-stat">
          <span className="ci-k">Posted, 90 days</span>
          <span className="ci-big">{s.posted90}</span>
          <Trend value={s.trend90Pct} />
        </div>
        <div className="ci-stat">
          <span className="ci-k">Last 6 months</span>
          <span className="ci-bars" role="img" aria-label={`Postings per month: ${s.monthly.join(', ')}`}>
            {s.monthly.map((n, i) => (
              <span key={i} className="ci-bar" style={{ height: `${Math.max(4, (n / max) * 100)}%` }} />
            ))}
          </span>
        </div>
      </div>
      <div className="ci-plan">
        <div className="ci-col">
          <h4 className="ci-k">Function mix</h4>
          <ul className="ci-list ci-compact">
            {s.byFunction.map((f) => (
              <li key={f.key} className="ci-row">
                <span>{f.label}</span>
                <span className="ci-num">{f.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="ci-col">
          <h4 className="ci-k">Skills</h4>
          <ul className="ci-chips">
            {s.skills.map((k) => (
              <li key={k.skill} className="ci-chip">
                {k.skill}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="ci-block">
        <h4 className="ci-k">Recent postings</h4>
        {h.postings.length ? (
          <ul className="ci-list ci-compact">
            {h.postings.map((p) => (
              <li key={p.id} className="ci-row">
                <span className="ci-line-label">
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      {p.title}
                    </a>
                  ) : (
                    p.title
                  )}
                </span>
                <span className="ci-meta">
                  {[p.department, p.location, postingSourceLabel(p.source), fmtDate(p.postedAt)].filter(Boolean).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ci-none">No open roles found</p>
        )}
      </div>
    </div>
  );
}

/** Financials: one row per fiscal year with its source, registry facts and fallback. */
export function FinancialsPanel({ f }: { f: AccountFinancialsIntel }) {
  return (
    <div className="ci-panel">
      {f.years.length ? (
        <div className="ci-table-wrap">
          <table className="ci-table">
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col">Revenue</th>
                <th scope="col">Operating margin</th>
                <th scope="col">Capex</th>
                <th scope="col">R&amp;D</th>
                <th scope="col">Acquisitions</th>
                <th scope="col">Headcount</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {f.years.map((y) => (
                <tr key={y.fiscalYear} data-testid={`intel-fin-year-${y.fiscalYear}`}>
                  <th scope="row">FY{y.fiscalYear}</th>
                  <td>{money(y.revenue, y.currency) ?? '-'}</td>
                  <td>{y.operatingMargin === null ? '-' : `${y.operatingMargin.toFixed(1)}%`}</td>
                  <td>{money(y.capex, y.currency) ?? '-'}</td>
                  <td>{money(y.rnd, y.currency) ?? '-'}</td>
                  <td>{money(y.acquisitions, y.currency) ?? '-'}</td>
                  <td>{y.headcount === null ? '-' : y.headcount.toLocaleString('en-GB')}</td>
                  <td>
                    {y.sourceUrl ? (
                      <a href={y.sourceUrl} target="_blank" rel="noopener noreferrer">
                        {y.source}
                      </a>
                    ) : (
                      y.source
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ci-none">No filed figures</p>
      )}
      {f.revenueFallback ? (
        <p className="ci-line-text">
          Revenue range: {f.revenueFallback.label} <span className="ci-meta">({f.revenueFallback.source}{f.revenueFallback.asOf ? `, ${fmtDate(f.revenueFallback.asOf)}` : ''})</span>
        </p>
      ) : null}
      {f.registry.length ? (
        <div className="ci-block">
          <h4 className="ci-k">Registry</h4>
          <ul className="ci-list ci-compact">
            {f.registry.map((r) => (
              <li key={`${r.source}-${r.label}`} className="ci-row">
                <span>{r.label}</span>
                <span className="ci-meta">
                  {r.value},{' '}
                  {r.sourceUrl ? (
                    <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">
                      {r.source}
                    </a>
                  ) : (
                    r.source
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** News and posts: newest first, kind and origin on every item. */
export function NewsPanel({ n }: { n: AccountNewsIntel }) {
  if (!n.items.length) return <p className="ci-none">No posts or news found</p>;
  return (
    <ul className="ci-list ci-panel">
      {n.items.map((p) => (
        <li key={p.id} className="ci-row">
          <span className="ci-line-head">
            <span className="ci-tag" data-kind={p.kind}>{POST_KIND_LABEL[p.kind]}</span>
            {p.url ? (
              <a className="ci-line-label" href={p.url} target="_blank" rel="noopener noreferrer">
                {p.title}
                <ExternalLink size={12} aria-hidden />
              </a>
            ) : (
              <span className="ci-line-label">{p.title}</span>
            )}
          </span>
          <span className="ci-meta">
            {[p.origin === 'own' ? 'Company' : 'Press', p.sourceLabel, fmtDate(p.publishedAt)].filter(Boolean).join(', ')}
          </span>
        </li>
      ))}
    </ul>
  );
}
