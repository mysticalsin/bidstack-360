// Ranked MSA whitespace (/agreements/whitespace). Top 10 by default; each row
// opens to its scored factors, citations and who works with the account, with
// Accept / Dismiss. Filters live in the URL.
import '@/components/drill/drill.css';
import '@/components/agreements/agreements.css';

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { labelBusinessLine, type WhitespaceFactor, type WhitespaceFlag } from '@bidstack/shared';

import { WhoWorksWithThem } from '@/components/agreements/WhoWorksWithThem';
import { BarChart } from '@/components/charts/charts';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useWhitespace, useWhitespaceDecision } from '@/hooks/useMsaWhitespace';
import { useUsers } from '@/hooks/useUsers';
import { fmtDate } from '@/lib/msa/labels';
import type { WhitespaceFilters } from '@/lib/msa/whitespace';

const STATES: Array<{ value: NonNullable<WhitespaceFilters['state']>; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'all', label: 'All states' },
];

function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

const plain = (v: string) => v.replace(/[\s,]/g, '').toLowerCase();

function Citation({ c }: { c: WhitespaceFactor['citations'][number] }) {
  const parts = [c.clause, c.page ? `p. ${c.page}` : null, c.label].filter((v): v is string => Boolean(v));
  const text = parts.filter((v, i) => parts.findIndex((o) => plain(o) === plain(v)) === i).join(' · ');
  return (
    <li>
      {c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener">{text}</a> : text}
      {c.excerpt ? <q className="agr-ws-excerpt">{c.excerpt}</q> : null}
    </li>
  );
}

function cited(f: WhitespaceFactor) {
  return f.citations.filter((c) => c.url || c.excerpt || c.clause || plain(c.label) !== plain(f.detail));
}

function Factors({ factors }: { factors: WhitespaceFactor[] }) {
  return (
    <ul className="agr-ws-factors" data-testid="whitespace-factors">
      {factors.map((f) => (
        <li key={f.key}>
          <div className="agr-ws-factor-head">
            <span className="t">{f.label}</span>
            <span className="agr-ws-points">{f.points}/{f.max}</span>
          </div>
          <span className="agr-ws-meter" aria-hidden="true"><span style={{ width: `${f.max ? (f.points / f.max) * 100 : 0}%` }} /></span>
          <span className="drill-sub">{f.detail}</span>
          {cited(f).length ? <ul className="agr-ws-cites">{cited(f).map((c, i) => <Citation key={i} c={c} />)}</ul> : null}
        </li>
      ))}
    </ul>
  );
}

function Decide({ flag, owners }: { flag: WhitespaceFlag; owners: Array<{ id: string; name: string }> }) {
  const { accept, dismiss } = useWhitespaceDecision();
  const [line, setLine] = useState(flag.lines[0] ?? '');
  const [ownerId, setOwnerId] = useState(flag.owner?.id ?? owners[0]?.id ?? '');
  const flagOwner = flag.owner;
  const ownerOptions = flagOwner && !owners.some((o) => o.id === flagOwner.id) ? [flagOwner, ...owners] : owners;
  const owner = ownerId || ownerOptions[0]?.id || '';
  const [due, setDue] = useState(() => inDays(14));
  const [opp, setOpp] = useState(false);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'accept' | 'dismiss' | null>(null);
  const busy = accept.isPending || dismiss.isPending;
  const err = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong');
  const lineSelect = (
    <label>
      Line
      <select value={line} onChange={(e) => setLine(e.target.value)} data-testid="whitespace-line">
        {flag.lines.map((l) => <option key={l} value={l}>{labelBusinessLine(l)}</option>)}
      </select>
    </label>
  );
  if (!mode) {
    return (
      <div className="agr-actions" style={{ justifyContent: 'flex-start' }}>
        <Button variant="primary" size="sm" onClick={() => setMode('accept')} data-testid="whitespace-accept-open">Accept</Button>
        <Button variant="secondary" size="sm" onClick={() => setMode('dismiss')} data-testid="whitespace-dismiss-open">Dismiss</Button>
      </div>
    );
  }
  if (mode === 'accept') {
    return (
      <form
        className="agr-form agr-ws-decide"
        onSubmit={(e) => {
          e.preventDefault();
          accept.mutate(
            { msaId: flag.msaId, line, ownerId: owner, dueDate: due, createOpportunity: opp },
            { onSuccess: () => { toast.success(`Accepted: ${labelBusinessLine(line)} for ${flag.companyName}`); setMode(null); }, onError: err },
          );
        }}
      >
        <div className="row">
          {lineSelect}
          <label>
            Owner
            <select value={owner} onChange={(e) => setOwnerId(e.target.value)} required data-testid="whitespace-owner">
              {ownerOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label>
            Due
            <input type="date" value={due} min={inDays(0)} onChange={(e) => setDue(e.target.value)} required />
          </label>
          <label className="agr-ws-check">
            <input type="checkbox" checked={opp} onChange={(e) => setOpp(e.target.checked)} data-testid="whitespace-create-opp" />
            Draft opportunity
          </label>
        </div>
        <div className="agr-actions" style={{ justifyContent: 'flex-start' }}>
          <Button type="submit" variant="primary" size="sm" disabled={busy || !line || !owner} data-testid="whitespace-accept">Accept</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>Cancel</Button>
        </div>
      </form>
    );
  }
  return (
    <form
      className="agr-form agr-ws-decide"
      onSubmit={(e) => {
        e.preventDefault();
        dismiss.mutate(
          { msaId: flag.msaId, line, reason: reason.trim() },
          { onSuccess: () => { toast.success(`Dismissed: ${labelBusinessLine(line)} for ${flag.companyName}`); setMode(null); }, onError: err },
        );
      }}
    >
      <div className="row">
        {lineSelect}
        <label>
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} required data-testid="whitespace-reason" />
        </label>
      </div>
      <div className="agr-actions" style={{ justifyContent: 'flex-start' }}>
        <Button type="submit" variant="secondary" size="sm" disabled={busy || reason.trim().length < 3} data-testid="whitespace-dismiss">Dismiss</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>Cancel</Button>
      </div>
    </form>
  );
}

function Row({ flag, rank, open, onToggle, canWrite, owners }: {
  flag: WhitespaceFlag;
  rank: number;
  open: boolean;
  onToggle: () => void;
  canWrite: boolean;
  owners: Array<{ id: string; name: string }>;
}) {
  const panelId = `ws-${flag.id}`;
  return (
    <li className="agr-ws-row" data-open={open ? 'true' : undefined} data-testid="whitespace-row">
      <button type="button" className="agr-ws-summary" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span className="agr-ws-rank">{rank}</span>
        <span className="agr-ws-score" aria-label={`Score ${flag.score} of 100`}>{flag.score}</span>
        <span className="agr-ws-main">
          <span className="t">{flag.headline}</span>
          <span className="drill-sub">
            {flag.companyName} · {flag.signingEntity.name} · {flag.owner?.name ?? 'No owner'}
            {flag.expiryDate ? ` · expires ${fmtDate(flag.expiryDate)}` : ''}
          </span>
        </span>
        <span className="agr-ws-lines">{flag.lines.map(labelBusinessLine).join(', ')}</span>
      </button>
      {open ? (
        <div id={panelId} className="agr-ws-detail">
          <div className="agr-ws-detail-grid">
            <Factors factors={flag.factors} />
            <div className="agr-ws-side">
              <WhoWorksWithThem companyId={flag.companyId} as="div" />
              <p className="agr-ws-links">
                <Link to={`/agreements/${flag.msaId}`}>{flag.msaTitle}</Link>
                {' · '}
                <Link to={`/accounts/${flag.companyId}`}>{flag.companyName}</Link>
              </p>
              {flag.decisions.length ? (
                <ul className="agr-ws-decisions">
                  {flag.decisions.map((d) => (
                    <li key={`${d.line}-${d.decidedAt}`}>
                      {labelBusinessLine(d.line)}: {d.state === 'accepted' ? 'accepted' : `dismissed (${d.reason ?? ''})`} {fmtDate(d.decidedAt)}{d.decidedBy ? ` · ${d.decidedBy}` : ''}
                      {d.crossSellActionId ? <> · <Link to="/cross-sell">Cross-sell</Link></> : null}
                      {d.opportunityId ? <> · <Link to={`/opportunities/${d.opportunityId}`}>Opportunity</Link></> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {canWrite && flag.state === 'new' ? <Decide key={`${flag.lines.join(',')}:${flag.evidenceHash}`} flag={flag} owners={owners} /> : null}
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default function WhitespacePage() {
  const [params, setParams] = useSearchParams();
  const canWrite = useHasPermission('msa:write');
  const users = useUsers({ limit: 200 });
  const filters: WhitespaceFilters = {
    line: params.get('line') ?? undefined,
    signingEntityId: params.get('entity') ?? undefined,
    country: params.get('country') ?? undefined,
    ownerId: params.get('owner') ?? undefined,
    state: (params.get('state') as WhitespaceFilters['state']) ?? 'new',
    limit: params.get('all') ? 50 : 10,
  };
  const list = useWhitespace(filters);
  const [openId, setOpenId] = useState<string | null>(null);
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const facets = list.data?.facets;
  const options = useMemo(
    () => ({
      entities: (facets?.entities ?? []).map((e) => [e.id, e.name] as const),
      countries: facets?.countries ?? [],
      lines: [...(facets?.lines ?? [])].sort((a, b) => labelBusinessLine(a).localeCompare(labelBusinessLine(b))),
      owners: (facets?.owners ?? []).map((o) => [o.id, o.name] as const),
    }),
    [facets],
  );
  const pickers = useMemo(
    () => (users.data ?? []).filter((u) => !u.deletedAt).map((u) => ({ id: u.id, name: u.name ?? u.email })),
    [users.data],
  );
  const chart = (list.data?.byLine ?? []).map((b) => ({ line: labelBusinessLine(b.line), Flags: b.count }));
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const filtered = ['line', 'entity', 'country', 'owner', 'state'].some((k) => params.get(k));

  return (
    <div className="agr" data-testid="whitespace-page">
      <header className="agr-head">
        <div>
          <h1>Whitespace</h1>
          <div className="meta"><Link to="/agreements">Agreements</Link></div>
        </div>
      </header>
      <section className="agr-section" aria-labelledby="ws-list">
        <h2 id="ws-list">Ranked flags</h2>
        <div className="drill-filters" role="search">
          <select aria-label="Line" value={filters.line ?? ''} onChange={(e) => set('line', e.target.value || null)} data-testid="whitespace-filter-line">
            <option value="">Any line</option>
            {options.lines.map((l) => <option key={l} value={l}>{labelBusinessLine(l)}</option>)}
          </select>
          <select aria-label="Signing entity" value={filters.signingEntityId ?? ''} onChange={(e) => set('entity', e.target.value || null)}>
            <option value="">Any entity</option>
            {options.entities.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select aria-label="Country" value={filters.country ?? ''} onChange={(e) => set('country', e.target.value || null)}>
            <option value="">Any country</option>
            {options.countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Owner" value={filters.ownerId ?? ''} onChange={(e) => set('owner', e.target.value || null)}>
            <option value="">Any owner</option>
            {options.owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select aria-label="State" value={filters.state} onChange={(e) => set('state', e.target.value === 'new' ? null : e.target.value)}>
            {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {filtered ? <button type="button" className="drill-more" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button> : null}
        </div>
        {list.isLoading ? <LoadingSkeleton rows={6} /> : list.isError ? (
          <ErrorState title="Couldn't load whitespace" message={list.error instanceof Error ? list.error.message : 'Try again in a moment.'} />
        ) : items.length === 0 ? (
          <p className="drill-empty">No flags match these filters.</p>
        ) : (
          <>
            {chart.length > 1 ? (
              <div className="agr-ws-chart" data-testid="whitespace-chart">
                <BarChart data={chart} xKey="line" yKey="Flags" height={180} aria-label="Flags by line" />
              </div>
            ) : null}
            <ol className="agr-ws-list" data-testid="whitespace-list">
              {items.map((f, i) => (
                <Row key={f.id} flag={f} rank={i + 1} open={openId === f.id} onToggle={() => setOpenId(openId === f.id ? null : f.id)} canWrite={canWrite} owners={pickers} />
              ))}
            </ol>
            {total > items.length && !params.get('all') ? (
              <button type="button" className="drill-more" onClick={() => set('all', '1')} data-testid="whitespace-more">Show {Math.min(total, 50) - items.length} more</button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
