// Slice 15 "Consulting partners": which third-party consulting firms work
// with the client and how we stand against each one. DESIGN.md 9.10.
import '../signals/signals.css';
import '../company-intel/company-intel.css';
import './consulting-partners.css';

import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Clock, ExternalLink, Loader2, RefreshCw, Settings2, XCircle } from 'lucide-react';
import { Suspense, lazy, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';

import {
  PARTNER_DOMAIN_LABEL,
  PARTNER_RELATIONSHIP_LABEL,
  POSITIONING_DIMENSION_LABEL,
  type ConsultingPartnerCard,
  type DimensionScore,
  type PartnerEvidence,
  type PartnerRunStatus,
  type PartnerTimelineItem,
} from '@bidstack/shared';

import { useHasPermission } from '@/hooks/useCapabilities';
import { useConsultingPartners, usePartnerEvidence, useRefreshConsultingPartners } from '@/hooks/useConsultingPartners';

import { fmtDate, safeHref } from '../company-intel/intel-format';

const RadarChart = lazy(() => import('@/components/charts/PolarCharts').then((m) => ({ default: m.RadarChart })));

const RADAR_DIMS = ['quality', 'price', 'speed', 'domain'] as const;

const STATUS: Record<PartnerRunStatus['status'], { label: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: 'Up to date', Icon: CheckCircle2 },
  partial: { label: 'Partial', Icon: AlertTriangle },
  failed: { label: 'Failed', Icon: XCircle },
  not_configured: { label: 'Not configured', Icon: Settings2 },
  never: { label: 'Never fetched', Icon: CircleDashed },
  queued: { label: 'Queued', Icon: Clock },
  running: { label: 'Running', Icon: Loader2 },
};

const STRENGTH_STEPS = { weak: 1, medium: 2, strong: 3 } as const;

function RunStatus({ run, canRefresh, pending, onRefresh }: { run: PartnerRunStatus; canRefresh: boolean; pending: boolean; onRefresh: () => void }) {
  const { label, Icon } = STATUS[run.status];
  const busy = pending || run.status === 'queued' || run.status === 'running';
  return (
    <div className="cp-run" data-status={run.status} data-testid="partners-run">
      <span className="ci-source-status">
        <Icon size={14} aria-hidden />
        {label}
      </span>
      {run.lastFetchedAt ? <span className="ci-meta">{fmtDate(run.lastFetchedAt)}</span> : null}
      {run.detail && run.status !== 'ok' ? (
        <span className="ci-meta cp-run-detail" title={run.detail}>
          {run.detail}
        </span>
      ) : null}
      {canRefresh ? (
        <button type="button" className="ci-refresh cp-refresh" onClick={onRefresh} disabled={busy} aria-label="Refresh consulting partners">
          <RefreshCw size={14} aria-hidden data-spin={busy} />
        </button>
      ) : null}
    </div>
  );
}

function Strength({ level, count }: { level: ConsultingPartnerCard['strength']['level']; count: number }) {
  const on = STRENGTH_STEPS[level];
  return (
    <span className="cp-strength" aria-label={`Strength ${level}, ${count} sources`} title={`${count} sources`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className="cp-strength-step" data-on={i <= on} aria-hidden />
      ))}
      <span className="ci-meta">{count}</span>
    </span>
  );
}

function PartnerTile({ p, selected, onSelect, onKey, tileRef }: {
  p: ConsultingPartnerCard;
  selected: boolean;
  onSelect: () => void;
  onKey: (e: KeyboardEvent<HTMLLIElement>) => void;
  tileRef: (el: HTMLLIElement | null) => void;
}) {
  return (
    <li
      ref={tileRef}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className="cp-tile"
      onClick={onSelect}
      onKeyDown={onKey}
      data-testid={`partner-${p.firmKey}`}
    >
      <span className="cp-tile-head">
        <span className="cp-mono" aria-hidden>
          {p.monogram}
        </span>
        <span className="cp-tile-name" title={p.name}>
          {p.name}
        </span>
        <Strength level={p.strength.level} count={p.strength.evidenceCount} />
      </span>
      <span className="cp-tags">
        {p.relationships.slice(0, 2).map((r) => (
          <span key={r} className="ci-tag cp-rel" data-rel={r}>
            {PARTNER_RELATIONSHIP_LABEL[r]}
          </span>
        ))}
        {p.domains.slice(0, 3).map((d) => (
          <span key={d} className="cp-domain">
            {PARTNER_DOMAIN_LABEL[d]}
          </span>
        ))}
      </span>
    </li>
  );
}

function ScoreTable({ p }: { p: ConsultingPartnerCard }) {
  return (
    <div className="ci-table-wrap">
      <table className="ci-table cp-scores" aria-label={`Us vs ${p.name}`}>
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            <th scope="col">Us</th>
            <th scope="col" className="cp-firm-col" title={p.name}>
              {p.name}
            </th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {p.scorecard.map((d: DimensionScore) => (
            <tr key={d.dimension} data-testid={`score-${d.dimension}`} data-status={d.status}>
              <th scope="row">{POSITIONING_DIMENSION_LABEL[d.dimension]}</th>
              {d.status === 'scored' ? (
                <>
                  <td data-lead={(d.us ?? 0) > (d.partner ?? 0)}>{d.us}</td>
                  <td data-lead={(d.partner ?? 0) > (d.us ?? 0)}>{d.partner}</td>
                </>
              ) : (
                <td colSpan={2} className="cp-none">
                  No evidence
                </td>
              )}
              <td>{d.evidenceCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Radar({ p }: { p: ConsultingPartnerCard }) {
  const scored = p.scorecard.filter((d) => d.status === 'scored' && (RADAR_DIMS as readonly string[]).includes(d.dimension));
  if (scored.length < 3) return null;
  const data = scored.map((d) => ({ subject: POSITIONING_DIMENSION_LABEL[d.dimension], Us: d.us ?? 0, [p.name]: d.partner ?? 0 }));
  return (
    <div className="cp-radar" data-testid="partner-radar">
      <Suspense fallback={<div className="sg-skel cp-radar-skel" aria-busy="true" />}>
        <RadarChart data={data} keys={['Us', p.name]} aria-label={`Us vs ${p.name} radar`} height={220} />
      </Suspense>
    </div>
  );
}

function Cites({ ids, byId }: { ids: string[]; byId: Map<string, PartnerTimelineItem> }) {
  const shown = ids.map((id) => byId.get(id)).filter((t): t is PartnerTimelineItem => Boolean(t)).slice(0, 3);
  const more = ids.length - shown.length;
  return (
    <span className="ci-cites">
      {shown.map((t) => (
        <span key={t.id} className="ci-cite cp-cite" title={t.label}>
          {fmtDate(t.date)}
        </span>
      ))}
      {more > 0 ? <span className="ci-cite ci-cite-more">+{more}</span> : null}
    </span>
  );
}

function Timeline({ items }: { items: PartnerTimelineItem[] }) {
  if (items.length === 0) return null;
  const times = items.map((t) => new Date(t.date).getTime());
  const min = Math.min(...times);
  const span = Math.max(1, Math.max(...times) - min);
  const first = fmtDate(new Date(min).toISOString());
  const last = fmtDate(new Date(min + span).toISOString());
  return (
    <div className="cp-timeline" data-testid="partner-timeline">
      <ol className="cp-track" aria-label="Evidence timeline">
        {items.map((t, i) => (
          <li
            key={t.id}
            className="cp-dot"
            data-origin={t.origin}
            style={{ left: `${items.length === 1 ? 50 : ((times[i]! - min) / span) * 100}%` }}
            tabIndex={0}
            title={`${fmtDate(t.date)}: ${t.label}`}
            aria-label={`${fmtDate(t.date)}: ${t.label}`}
          />
        ))}
      </ol>
      <span className="cp-axis ci-meta">
        <span>{first}</span>
        {first !== last ? <span>{last}</span> : null}
      </span>
    </div>
  );
}

function EvidenceItem({ e }: { e: PartnerEvidence }) {
  const href = safeHref(e.url);
  return (
    <li className="ci-line cp-ev" data-origin={e.origin}>
      <span className="ci-line-head">
        <span className="ci-tag">{e.sourceLabel}</span>
        {e.date ? <span className="ci-meta">{fmtDate(e.date)}</span> : null}
        {e.inferred ? <span className="ci-basis">Inferred</span> : null}
        {e.sample ? <span className="sg-sample">Sample</span> : null}
        {href ? (
          <a className="ci-cite" href={href} target="_blank" rel="noopener noreferrer nofollow">
            Source <ExternalLink size={12} aria-hidden />
          </a>
        ) : e.recordHref ? (
          <Link className="ci-cite" to={e.recordHref}>
            Record
          </Link>
        ) : null}
      </span>
      <span className="ci-line-text">{e.excerpt}</span>
    </li>
  );
}

function EvidenceList({ companyId, firmKey }: { companyId: string; firmKey: string }) {
  const [open, setOpen] = useState(false);
  const q = usePartnerEvidence(companyId, firmKey, open);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="cp-evidence">
      <button type="button" className="cp-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Evidence <ChevronDown size={14} aria-hidden data-open={open} />
      </button>
      {open ? (
        q.isLoading ? (
          <div className="sg-skel" aria-busy="true" />
        ) : q.isError ? (
          <p className="ci-none" role="alert">
            Couldn&apos;t load evidence
          </p>
        ) : (
          <>
            <ul className="ci-list" data-testid="partner-evidence">
              {items.map((e) => (
                <EvidenceItem key={e.id} e={e} />
              ))}
            </ul>
            {q.hasNextPage ? (
              <button type="button" className="cp-more" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                Load more
              </button>
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
}

function PartnerDetail({ companyId, p }: { companyId: string; p: ConsultingPartnerCard }) {
  const byId = useMemo(() => new Map(p.timeline.map((t) => [t.id, t])), [p.timeline]);
  const { wins, losses, firstYear, lastYear } = p.record;
  const years = firstYear && lastYear ? (firstYear === lastYear ? `${firstYear}` : `${firstYear} to ${lastYear}`) : null;
  return (
    <div className="cp-detail" data-testid="partner-detail">
      <div className="cp-grid">
        <div className="cp-col">
          <Radar p={p} />
          <ScoreTable p={p} />
        </div>
        <div className="cp-col">
          <div className="ci-stats cp-stats">
            <div className="ci-stat">
              <span className="ci-k">Record</span>
              <span className="ci-big">
                {wins}
                <span className="cp-sep">/</span>
                {losses}
              </span>
              <span className="ci-meta">{wins + losses ? `Wins / losses${years ? `, ${years}` : ''}` : 'No head to head'}</span>
            </div>
            <div className="ci-stat">
              <span className="ci-k">Sources</span>
              <span className="ci-big">{p.publicCount + p.internalCount}</span>
              <span className="ci-meta">
                {p.publicCount} public, {p.internalCount} internal
              </span>
            </div>
          </div>
          <span className="ci-k cp-k">Angles</span>
          {p.angles.length ? (
            <ul className="ci-list" data-testid="partner-angles">
              {p.angles.map((a) => (
                <li key={a.text} className="ci-line">
                  <span className="ci-line-head">
                    <span className="ci-line-label">{a.text}</span>
                    {a.basis === 'inferred' ? <span className="ci-basis">Inferred</span> : null}
                  </span>
                  <Cites ids={a.evidenceIds} byId={byId} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="ci-none">No evidence</p>
          )}
        </div>
      </div>
      <Timeline items={p.timeline} />
      <EvidenceList key={p.firmKey} companyId={companyId} firmKey={p.firmKey} />
    </div>
  );
}

/** Account page section: consulting firms around the client and our position against each. */
export function ConsultingPartnersSection({ companyId }: { companyId: string }) {
  const canRefresh = useHasPermission('account-intel:write');
  const refresh = useRefreshConsultingPartners(companyId);
  const q = useConsultingPartners(companyId, refresh.pollUntil);
  const [picked, setPicked] = useState<string | null>(null);
  const tiles = useRef<Array<HTMLLIElement | null>>([]);
  const partners = q.data?.partners ?? [];
  const current = partners.find((p) => p.firmKey === picked) ?? partners[0] ?? null;

  const onKey = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setPicked(partners[i]!.firmKey);
      return;
    }
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const j = (next + partners.length) % partners.length;
    setPicked(partners[j]!.firmKey);
    tiles.current[j]?.focus();
  };

  return (
    <section className="sg ci cp sg-surface" aria-labelledby="cp-h" data-testid="consulting-partners">
      <header className="sg-head cp-head">
        <h2 id="cp-h" className="sg-h">
          Consulting partners {q.data?.sample ? <span className="sg-sample">Sample</span> : null}
        </h2>
        {q.data ? <RunStatus run={q.data.run} canRefresh={canRefresh} pending={refresh.isPending} onRefresh={() => refresh.mutate()} /> : null}
      </header>
      {q.isLoading ? (
        <div className="cp-skel" aria-busy="true" data-testid="partners-skeleton">
          <div className="sg-skel" />
          <div className="sg-skel" />
          <div className="sg-skel" />
        </div>
      ) : q.isError ? (
        <p className="sg-empty" role="alert">
          <span>Couldn&apos;t load consulting partners</span>
        </p>
      ) : partners.length === 0 || !current ? (
        <p className="ci-none" data-testid="partners-empty">
          No consulting partners found
        </p>
      ) : (
        <>
          <ul role="listbox" aria-label="Consulting partners" aria-orientation="horizontal" className="cp-strip">
            {partners.map((p, i) => (
              <PartnerTile
                key={p.firmKey}
                p={p}
                selected={p.firmKey === current.firmKey}
                onSelect={() => setPicked(p.firmKey)}
                onKey={(e) => onKey(e, i)}
                tileRef={(el) => {
                  tiles.current[i] = el;
                }}
              />
            ))}
          </ul>
          <PartnerDetail companyId={companyId} p={current} />
        </>
      )}
    </section>
  );
}
