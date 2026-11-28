// Account page visuals (Tony 13:25 BRT): pipeline by stage for this account
// and a relationship map drawn from the people-map (#49) reporting lines.
import '@/components/viz/viz.css';

import { Link } from 'react-router-dom';

import { ChartCard, SignalShape } from '@/components/viz/ChartCard';
import { StageBars } from '@/components/viz/charts';
import type { OppDrillFilter } from '@/components/drill/filterOpps';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { fmtCompact, OPEN_STAGES, stageFunnel, stageKey, statusMix, type OppRow } from '@/components/viz/viz-data';
import { usePeopleMap } from '@/hooks/useAccountPeople';
import { useOpportunityRows } from '@/hooks/useOpportunityRows';

import { contactRecordHref } from './contactRecordHref';
import { layoutOrg, type MapPerson } from './org-layout';

// Link text uses the measured brand foreground. The row target is 44px tall.
const MANAGER_LINK =
  'inline-flex min-h-11 items-center text-[var(--brand-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--viz-brand)] dark:text-[var(--brand-deep)]';

const RETRY =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]';

// Standing is evidence quality; map it to the shared colour + shape language.
const STANDING: Record<string, { kind: string; label: string }> = {
  evidenced: { kind: 'OPPORTUNITY', label: 'Evidenced' },
  unknown: { kind: 'NEUTRAL', label: 'Unverified' },
  needs_review: { kind: 'NEUTRAL', label: 'Unverified' },
  stale: { kind: 'RISK', label: 'Stale or conflicting' },
  conflicted: { kind: 'RISK', label: 'Stale or conflicting' },
};

const NW = 176, NH = 52, GX = 16, GY = 40;

function RelationshipMap({ company, people }: { company: string; people: MapPerson[] }) {
  const { levels, parent } = layoutOrg(people);
  const cols = Math.max(1, ...levels.map((l) => l.length));
  const W = cols * (NW + GX) - GX;
  const H = (levels.length + 1) * (NH + GY) - GY;
  const pos = new Map<string, { x: number; y: number }>();
  levels.forEach((lvl, li) => {
    const rowW = lvl.length * (NW + GX) - GX;
    lvl.forEach((p, i) => pos.set(p.id, { x: (W - rowW) / 2 + i * (NW + GX), y: (li + 1) * (NH + GY) }));
  });
  const root = { x: (W - NW) / 2, y: 0 };
  return (
    <svg className="viz-svg rel-map" viewBox={`-2 -2 ${W + 4} ${H + 4}`} style={{ maxHeight: H + 4 }}>
      {people.map((p) => {
        const to = pos.get(p.id)!;
        const up = parent(p);
        const from = up ? pos.get(up)! : root;
        const x1 = from.x + NW / 2, y1 = from.y + NH, x2 = to.x + NW / 2, y2 = to.y, my = (y1 + y2) / 2;
        return <path key={`e${p.id}`} className="rel-edge viz-draw" pathLength={1} d={`M${x1} ${y1} V${my} H${x2} V${y2}`} data-dashed={up ? undefined : 'true'} />;
      })}
      <g>
        <rect className="rel-node rel-root" x={root.x} y={root.y} width={NW} height={NH} rx={8} />
        <text className="rel-name" x={root.x + 12} y={root.y + 22}>{company}</text>
        <text className="tick" x={root.x + 12} y={root.y + 40}>Account</text>
      </g>
      {people.map((p, i) => {
        const at = pos.get(p.id)!;
        const st = STANDING[p.standing] ?? STANDING.unknown!;
        return (
          <g key={p.id} className="viz-pop" style={{ '--i': i } as React.CSSProperties}>
            <title>{`${p.name}${p.title ? `, ${p.title}` : ''} (${st.label})`}</title>
            <rect className="rel-node" x={at.x} y={at.y} width={NW} height={NH} rx={8} />
            <SignalShape kind={st.kind} x={at.x + 16} y={at.y + 18} r={4} />
            <text className="rel-name" x={at.x + 28} y={at.y + 22}>{p.name.length > 20 ? `${p.name.slice(0, 19)}…` : p.name}</text>
            <text className="tick" x={at.x + 12} y={at.y + 40}>{(p.title ?? '').length > 26 ? `${p.title!.slice(0, 25)}…` : p.title}</text>
          </g>
        );
      })}
    </svg>
  );
}

function reportsToCell(person: MapPerson, people: MapPerson[]) {
  const manager = people.find((q) => q.id === person.reportsToContactId);
  const href = contactRecordHref(person.reportsToContactId);
  if (!href) return manager?.name ?? '–';
  return (
    <Link className={MANAGER_LINK} to={href}>
      {manager?.name ?? 'View manager'}
    </Link>
  );
}

export function AccountVisuals({ companyId, companyName, onDrill }: { companyId: string; companyName: string; onDrill?: (f: OppDrillFilter) => void }) {
  const opps = useOpportunityRows();
  const people = usePeopleMap({ companyId });
  const rows: OppRow[] = (opps.data?.items ?? []).filter((o) => (o.customer ?? '').toLowerCase() === companyName.toLowerCase());
  const stages = stageFunnel(rows);
  const stageIds = OPEN_STAGES.filter((id) => rows.some((o) => stageKey(o.stage) === id));
  const mix = statusMix(rows);
  const peopleFailed = people.isError;
  // Empty is a result only after the read succeeds. Pending and paused stay on the skeleton.
  const peopleLoading = !peopleFailed && !people.isSuccess;
  const ppl: MapPerson[] = (people.data?.people ?? []).map((p) => ({ id: p.id, name: p.name, title: p.title ?? null, standing: p.standing, reportsToContactId: p.reportsToContactId ?? null }));
  const { edges } = layoutOrg(ppl);
  const counts = ppl.reduce<Record<string, number>>((m, p) => { const l = (STANDING[p.standing] ?? STANDING.unknown!).label; m[l] = (m[l] ?? 0) + 1; return m; }, {});
  const relationshipSummary = peopleLoading
    ? 'Loading contacts'
    : peopleFailed
      ? "Couldn't load contacts"
      : ppl.map((p) => `${p.name}${p.title ? `, ${p.title}` : ''}`).join('; ') || 'No contacts yet';

  return (
    <div className="acct-visuals" data-testid="account-visuals">
      <ChartCard
        title="Pipeline by stage"
        interactive={Boolean(onDrill)}
        testId="account-pipeline"
        meta={(() => { const n = stages.reduce((m, s) => m + s.count, 0); return `${n} open bid${n === 1 ? '' : 's'}`; })()}
        summary={stages.map((s) => `${s.label}: ${fmtCompact(s.value)}`).join('; ') || 'No open bids for this account'}
        table={{ columns: ['Stage', 'Bids', 'Value'], rows: stages.map((s) => [s.label, s.count, fmtCompact(s.value)]) }}
      >
        {stages.length ? (
          <StageBars data={stages} format={fmtCompact}
            onSelect={onDrill ? (label) => { const i = stages.findIndex((x) => x.label === label); onDrill({ status: 'open', stage: stageIds[i] ?? null }); } : undefined} />
        ) : <p className="viz-empty">No open bids for this account.</p>}
        {onDrill && rows.length ? (
          <>
            <div className="viz-caption">Select a stage bar or a status to see the bids behind it.</div>
            <div className="dash-chips" role="group" aria-label="Bids by status">
              {([['open', 'Open', mix.open], ['won', 'Won', mix.won], ['lost', 'Lost', mix.lost]] as const).map(([k, label, n]) => (
                <button key={k} type="button" className="dash-chip" onClick={() => onDrill({ status: k })}>{label} <b>{n}</b></button>
              ))}
            </div>
          </>
        ) : null}
      </ChartCard>
      <ChartCard
        title="Relationship map"
        interactive={peopleFailed}
        meta={!peopleLoading && !peopleFailed && ppl.length ? `${ppl.length} people · ${edges} reporting line${edges === 1 ? '' : 's'}` : undefined}
        summary={relationshipSummary}
        table={peopleLoading || peopleFailed ? undefined : { columns: ['Person', 'Title', 'Reports to', 'Evidence'], rows: ppl.map((p) => [p.name, p.title ?? '', reportsToCell(p, ppl), (STANDING[p.standing] ?? STANDING.unknown!).label]) }}
      >
        {peopleLoading ? (
          <LoadingSkeleton rows={3} />
        ) : peopleFailed ? (
          <ErrorState
            title="Couldn't load contacts"
            message="Please try again."
            action={
              <button type="button" className={RETRY} onClick={() => void people.refetch()}>
                Retry
              </button>
            }
          />
        ) : ppl.length ? (
          <>
            <RelationshipMap company={companyName} people={ppl} />
            <ul className="viz-legend" aria-hidden>
              {Object.entries(counts).map(([label, n]) => {
                const kind = Object.values(STANDING).find((s) => s.label === label)!.kind;
                return (
                  <li key={label}>
                    <svg width="12" height="12" className="viz-svg" style={{ width: 12 }}><SignalShape kind={kind} x={6} y={6} r={4} /></svg>
                    {label} ({n})
                  </li>
                );
              })}
            </ul>
            {edges === 0 ? (
              <p className="viz-caption">No reporting lines recorded yet. Dashed lines link people to the account only. Add &ldquo;reports to&rdquo; on a contact to draw the org chart.</p>
            ) : null}
          </>
        ) : (
          <p className="viz-empty">No contacts yet. <Link to="/contacts">Add a contact</Link></p>
        )}
      </ChartCard>
    </div>
  );
}
