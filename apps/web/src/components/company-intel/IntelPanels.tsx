// Slice 12 panels: direction, hiring, financials, news and posts. Every line
// names its basis and links the evidence it came from.
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  compactAmount,
  FUNCTION_THEME,
  hiringBreakdown,
  OFFERING_HOOKS,
  POST_KIND_LABEL,
  postingSkills,
  postingSourceLabel,
  themeForSkill,
  type HiringShare,
  type IntelPosting,
  type AccountDirection,
  type AccountFinancialsIntel,
  type AccountHiringIntel,
  type AccountNewsIntel,
  type IntelBasis,
  type IntelEvidence,
  type InvestmentThemeItem,
} from '@bidstack/shared';

import { FigureActions, SourceChip } from '@/components/figures/SourcedFigure';

import { fmtDate, safeHref } from './intel-format';

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
  const groups = new Map<string, IntelEvidence[]>();
  for (const id of ids) {
    const e = evidence.get(id);
    if (!e) continue;
    const text = `${e.sourceLabel}${e.locator ? ` ${e.locator}` : ''}`;
    groups.set(text, [...(groups.get(text) ?? []), e]);
  }
  if (!groups.size) return null;
  return (
    <span className="ci-cites">
      {[...groups.entries()].map(([text, list]) => {
        const e = list.find((x) => safeHref(x.url)) ?? list[0]!;
        const href = safeHref(e.url);
        const tip = list.slice(0, 3).map((x) => `${x.excerpt} (fetched ${fmtDate(x.fetchedAt)})`).join('\n');
        const more = list.length > 1 ? <span className="ci-cite-more"> +{list.length - 1}</span> : null;
        return href ? (
          <a key={text} className="ci-cite" href={href} target="_blank" rel="noopener noreferrer" title={tip}>
            {text}
            {more}
          </a>
        ) : (
          <span key={text} className="ci-cite" title={tip} tabIndex={0}>
            {text}
            {more}
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
  // Keyed so a role filter picked on one account never carries to the next.
  return <HiringPanelBody key={h.companyId} h={h} />;
}

function HiringPanelBody({ h }: { h: AccountHiringIntel }) {
  const s = h.summary;
  const max = Math.max(1, ...s.monthly);
  const [filter, setFilter] = useState<HiringFilter | null>(null);
  const [all, setAll] = useState(false);
  const b = useMemo(() => hiringBreakdown(h.summary, h.postings, (t) => OFFERING_HOOKS[t]?.label ?? t), [h.summary, h.postings]);
  const filtered = filter ? h.postings.filter((p) => matches(p, filter)) : h.postings;
  const shown = all ? filtered : filtered.slice(0, POSTINGS_SHOWN);
  const pick = (f: HiringFilter) => {
    setAll(false);
    setFilter((cur) => (cur?.kind === f.kind && cur.key === f.key ? null : f));
  };
  const topTheme = b.themes[0];
  const topTech = b.tech.slice(0, 3);
  const focus =
    s.openRoles && (topTheme || topTech.length)
      ? [
          topTheme ? `Most postings point to ${topTheme.label} (${topTheme.pct}%).` : null,
          topTech.length ? `Tech named most: ${topTech.map((t) => `${t.label} ${t.pct}%`).join(', ')} of open roles.` : null,
        ]
          .filter(Boolean)
          .join(' ')
      : null;
  const fit = focus && topTheme ? OFFERING_HOOKS[topTheme.theme].offering : null;
  const sourceNames = s.sources.map(postingSourceLabel).join(', ');
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
      {focus ? (
        <div className="ci-focus" data-testid="hiring-focus">
          <p className="ci-line-text">{focus}</p>
          {fit ? (
            <p className="ci-line-text">
              Where we fit: {fit}. <span className="ci-basis">Inferred</span>
            </p>
          ) : null}
          <p className="ci-meta" data-testid="hiring-focus-source">
            Source: {s.openRoles} open roles from {sourceNames || 'job boards'}. Each role below links to its posting.
          </p>
        </div>
      ) : null}
      <div className="ci-plan">
        <div className="ci-col">
          <h4 className="ci-k">Function mix</h4>
          <ShareList rows={b.functions} kind="function" filter={filter} onFilter={pick} unit="of open roles" />
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
      {b.tech.length || b.themes.length || b.seniority.length ? (
        <div className="ci-plan ci-block" data-testid="hiring-breakdown">
          {b.tech.length ? (
            <div className="ci-col">
              <h4 className="ci-k">Tech they are hiring for</h4>
              <ShareList rows={b.tech} kind="tech" filter={filter} onFilter={pick} unit="of open roles" />
              <p className="ci-meta ci-note">A role can name several technologies, so shares do not add up to 100%.</p>
            </div>
          ) : null}
          {b.themes.length ? (
            <div className="ci-col">
              <h4 className="ci-k">Practice areas</h4>
              <ShareList rows={b.themes} kind="theme" filter={filter} onFilter={pick} unit={`of ${b.postingsBase} postings`} />
            </div>
          ) : null}
          {b.seniority.length ? (
            <div className="ci-col">
              <h4 className="ci-k">Seniority</h4>
              <ShareList rows={b.seniority} kind="seniority" filter={filter} onFilter={pick} unit={`of ${b.postingsBase} postings`} />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="ci-block">
        <div className="ci-row">
          <h4 className="ci-k">{filter ? `Roles: ${filter.label}` : 'Recent postings'}</h4>
          {filter ? (
            <button type="button" className="ci-link" onClick={() => setFilter(null)}>
              Show every role
            </button>
          ) : null}
        </div>
        {h.postings.length ? (
          <>
            <ul className="ci-list ci-compact" data-testid="hiring-postings">
              {shown.map((p) => {
                const skills = postingSkills(p);
                return (
                  <li key={p.id} className="ci-posting">
                    <div className="ci-row">
                      <span className="ci-line-label">
                        {safeHref(p.url) ? (
                          <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer">
                            {p.title}
                          </a>
                        ) : (
                          p.title
                        )}
                      </span>
                      <span className="ci-meta">
                        {[p.department, p.location, postingSourceLabel(p.source), fmtDate(p.postedAt)].filter(Boolean).join(', ')}
                      </span>
                    </div>
                    {p.seniority || skills.length ? (
                      <ul className="ci-chips" aria-label={`${p.title}: seniority and skills`}>
                        {p.seniority ? <li className="ci-chip ci-chip-quiet">{p.seniority}</li> : null}
                        {skills.map((k) => (
                          <li key={k} className="ci-chip">
                            {k}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {filtered.length === 0 ? <p className="ci-none">No listed posting matches this filter.</p> : null}
            {filtered.length > POSTINGS_SHOWN ? (
              <button type="button" className="ci-link" onClick={() => setAll((v) => !v)}>
                {all ? 'Show fewer' : `Show all ${filtered.length} roles`}
              </button>
            ) : null}
            {h.postings.length < s.openRoles ? (
              <p className="ci-meta ci-note">
                Listing the latest {h.postings.length} of {s.openRoles} open roles. Function and tech shares cover all of them.
              </p>
            ) : null}
          </>
        ) : (
          <p className="ci-none">No open roles found</p>
        )}
      </div>
    </div>
  );
}

type ShareKind = 'function' | 'tech' | 'theme' | 'seniority';
interface HiringFilter {
  kind: ShareKind;
  key: string;
  label: string;
}

const POSTINGS_SHOWN = 8;

function postingThemes(p: IntelPosting): Set<string> {
  const out = new Set<string>();
  const fn = FUNCTION_THEME[p.function];
  if (fn) out.add(fn);
  for (const k of postingSkills(p)) {
    const th = themeForSkill(k);
    if (th) out.add(th);
  }
  return out;
}

function matches(p: IntelPosting, f: HiringFilter): boolean {
  if (f.kind === 'function') return p.function === f.key;
  if (f.kind === 'tech') return postingSkills(p).includes(f.key);
  if (f.kind === 'theme') return postingThemes(p).has(f.key);
  return (p.seniority?.trim() || 'Not stated') === f.key;
}

function ShareList({
  rows,
  kind,
  filter,
  onFilter,
  unit,
}: {
  rows: HiringShare[];
  kind: ShareKind;
  filter: HiringFilter | null;
  onFilter: (f: HiringFilter) => void;
  unit: string;
}) {
  return (
    <>
      <p className="ci-meta" data-testid={`share-unit-${kind}`}>
        Percent {unit}
      </p>
      <ul className="ci-list ci-compact">
        {rows.map((r) => {
          const active = filter?.kind === kind && filter.key === r.key;
          return (
            <li key={r.key} className="ci-share">
              <div className="ci-row">
                <button
                  type="button"
                  className="ci-share-label"
                  aria-pressed={active}
                  aria-label={`${r.label}: ${r.count}, ${r.pct}% ${unit}. Show these roles`}
                  onClick={() => onFilter({ kind, key: r.key, label: r.label })}
                >
                  {r.label}
                </button>
                <span className="ci-num">
                  {r.count} <span className="ci-meta">· {r.pct}%</span>
                </span>
              </div>
              <span className="ci-share-track" aria-hidden>
                <span className="ci-share-fill" style={{ width: `${Math.min(100, r.pct)}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Financials: one row per fiscal year with its source, registry facts and fallback. */
/** When `company` is given, registry rows get Edit and an empty registry offers Refresh and Add manually. */
export function FinancialsPanel({ f, company }: { f: AccountFinancialsIntel; company?: { id: string; name: string } }) {
  const hasJurisdiction = f.registry.some((r) => r.fieldKey === 'registryJurisdiction' || /jurisdiction/i.test(r.label));
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
                    {safeHref(y.sourceUrl) ? (
                      <a href={safeHref(y.sourceUrl)} target="_blank" rel="noopener noreferrer">
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
        <div className="ci-block" data-testid="intel-registry">
          <h4 className="ci-k">Registry</h4>
          <ul className="ci-list ci-compact">
            {f.registry.map((r) => (
              <li key={`${r.source}-${r.label}`} className="ci-row ci-registry-row">
                <span className="ci-registry-label">{r.label}</span>
                <span className="ci-meta ci-registry-value">
                  <span className="ci-registry-text" title={r.value}>{r.value}</span>
                  <SourceChip p={{ origin: r.fieldKey ? 'manual_sourced' : 'record', label: r.source, year: r.fetchedAt ? r.fetchedAt.slice(0, 4) : null, url: safeHref(r.sourceUrl) ?? null }} />
                  {company && r.fieldKey ? <FigureActions companyId={company.id} companyName={company.name} fieldKey={r.fieldKey} label={r.label} /> : null}
                </span>
              </li>
            ))}
          </ul>
          {company && !hasJurisdiction ? (
            <FigureActions companyId={company.id} companyName={company.name} fieldKey="registryJurisdiction" label="Jurisdiction" missing="No jurisdiction on record" />
          ) : null}
        </div>
      ) : company ? (
        <div className="ci-block" data-testid="intel-registry-empty">
          <h4 className="ci-k">Registry</h4>
          <FigureActions companyId={company.id} companyName={company.name} fieldKey="registryId" label="Registration number" missing="No registry record found yet. A registration number or LEI lets Polo pull filed figures." />
        </div>
      ) : null}
    </div>
  );
}

/** News and posts: newest first, kind and origin on every item. */
export function NewsPanel({ n }: { n: AccountNewsIntel }) {
  const [showUnlinked, setShowUnlinked] = useState(false);
  if (!n.items.length) return <p className="ci-none">No posts or news found</p>;
  const linked = n.items.filter((p) => safeHref(p.url));
  const unlinked = n.items.filter((p) => !safeHref(p.url));
  const row = (p: AccountNewsIntel['items'][number]) => {
    const href = safeHref(p.url);
    return (
      <li key={p.id} className="ci-row" data-testid={`news-${p.id}`}>
        <span className="ci-line-head">
          <span className="ci-tag" data-kind={p.kind}>{POST_KIND_LABEL[p.kind]}</span>
          {href ? (
            <a className="ci-line-label" href={href} target="_blank" rel="noopener noreferrer">
              {p.title}
              <ExternalLink size={12} aria-hidden />
            </a>
          ) : (
            <span className="ci-line-label">{p.title}</span>
          )}
          {href ? null : <span className="ci-basis">No source link</span>}
        </span>
        <span className="ci-meta">
          {[p.origin === 'own' ? 'Company' : 'Press', fmtDate(p.publishedAt)].filter(Boolean).join(', ')}
          {' · Source: '}
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {p.sourceLabel || hostOf(href)}
              {p.sourceLabel && hostOf(href) && hostOf(href) !== p.sourceLabel ? ` (${hostOf(href)})` : ''}
            </a>
          ) : (
            p.sourceLabel || 'not given'
          )}
        </span>
      </li>
    );
  };
  return (
    <div className="ci-panel">
      {linked.length ? <ul className="ci-list">{linked.map(row)}</ul> : <p className="ci-none">No posts or news with a source link</p>}
      {unlinked.length ? (
        <div className="ci-block">
          <button type="button" className="ci-link" aria-expanded={showUnlinked} onClick={() => setShowUnlinked((v) => !v)}>
            {showUnlinked ? 'Hide' : 'Show'} {unlinked.length} {unlinked.length === 1 ? 'item' : 'items'} without a source link
          </button>
          <p className="ci-meta ci-note">Kept apart because they cannot be checked against the original.</p>
          {showUnlinked ? <ul className="ci-list">{unlinked.map(row)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
