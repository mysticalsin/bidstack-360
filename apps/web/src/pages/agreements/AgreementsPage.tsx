// Agreements library (/agreements). Top level stays simple: four clickable
// numbers, an expiring-soon strip, then one filterable table. Every row opens
// the agreement's detail page; filters live in the URL so a drilled view can
// be shared or reached from the account page.
import '@/components/drill/drill.css';
import '@/components/agreements/agreements.css';

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { DocumentHits } from '@/components/agreements/DocumentHits';
import { SampleBanner } from '@/components/agreements/SampleBanner';
import { MsaStatusBadge } from '@/components/agreements/StatusBadge';
import { UploadDialog } from '@/components/agreements/UploadDialog';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useMsaList } from '@/hooks/useMsa';
import { fmtDate, fmtDays, KIND_LABEL, STATUS_LABEL, urgency } from '@/lib/msa/labels';
import { MSA_KINDS, MSA_STATUSES } from '@/lib/msa/types';

import { applyView, headline, type AgreementsView } from './view';

const WINDOWS = [
  { value: '', label: 'Any expiry' },
  { value: '30', label: 'Expiring ≤ 30 days' },
  { value: '90', label: 'Expiring ≤ 90 days' },
  { value: '180', label: 'Expiring ≤ 180 days' },
];

function Days({ days }: { days: number | null }) {
  return <span className="agr-days" data-u={urgency(days)}>{fmtDays(days)}</span>;
}

export default function AgreementsPage() {
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const canWrite = useHasPermission('msa:write');
  // One fetch of the whole library (it is small: capped at the API's page size of 100);
  // numbers, strip and table are all derived locally so filtering is instant.
  const list = useMsaList({ topLevel: 'false', limit: 100, sort: 'expiry' });
  const rows = useMemo(() => list.data?.data.items ?? [], [list.data]);
  const sample = Boolean(list.data?.sample);
  const nums = useMemo(() => headline(rows, now), [rows, now]);
  const shown = useMemo(() => applyView(rows, params, now), [rows, params, now]);
  const soon = useMemo(
    () => rows.filter((r) => r.status === 'active' && r.daysToExpiry != null && r.daysToExpiry >= 0 && r.daysToExpiry <= 90).slice(0, 8),
    [rows],
  );
  const accounts = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => r.companyId && m.set(r.companyId, r.companyName ?? r.companyId));
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const view = params.get('view');
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const filtered = [...params.keys()].length > 0;
  const disabledReason = sample
    ? 'Uploading is off in this Sample preview. It turns on once the Agreements service is live on this server.'
    : !canWrite ? 'You can view agreements but not add them. Ask an admin for the "Agreements: edit" permission.' : undefined;

  const KPI: Array<{ id: AgreementsView; label: string; value: number; sub: string }> = [
    { id: 'active', label: 'Active agreements', value: nums.active, sub: 'In force today' },
    { id: 'expiring', label: 'Expiring in 90 days', value: nums.expiring, sub: 'Plan renewals now' },
    { id: 'notice', label: 'Notice due in 30 days', value: nums.notice, sub: 'Last day to give notice' },
    { id: 'open', label: 'Being negotiated', value: nums.open, sub: 'Draft, negotiation or signature' },
  ];

  return (
    <div className="agr" data-testid="agreements-page">
      <header className="agr-head">
        <div>
          <h1>Agreements</h1>
          <p className="agr-caption">Every MSA, framework, SOW and amendment, with what expires next and when notice is due.</p>
        </div>
        <Button variant="primary" onClick={() => setNewOpen(true)} data-testid="agreements-new">
          <Icon name="plus" size={16} /> New agreement
        </Button>
      </header>
      {sample ? <SampleBanner /> : null}
      {list.isLoading ? <LoadingSkeleton rows={6} /> : list.isError ? (
        <ErrorState title="Couldn't load agreements" message={list.error instanceof Error ? list.error.message : 'Try again in a moment.'} />
      ) : (
        <>
          <div className="agr-kpis" role="group" aria-label="Agreement totals — select one to filter the table">
            {KPI.map((k) => (
              <button key={k.id} type="button" className="agr-kpi" aria-pressed={view === k.id} onClick={() => set('view', view === k.id ? null : k.id)} data-testid={`agreements-kpi-${k.id}`}>
                <span className="agr-kpi-label">{k.label}</span>
                <span className="agr-kpi-value">{k.value}</span>
                <span className="agr-kpi-sub">{k.sub}</span>
              </button>
            ))}
          </div>

          <section className="agr-section" aria-labelledby="agr-soon">
            <h2 id="agr-soon">Expiring soon</h2>
            {soon.length === 0 ? <p className="drill-empty">Nothing active expires in the next 90 days.</p> : (
              <ul className="agr-strip" data-testid="agreements-expiring-strip">
                {soon.map((r) => (
                  <li key={r.id}>
                    <Link to={`/agreements/${r.id}`}>
                      <Days days={r.daysToExpiry} />
                      <span className="t">{r.title}</span>
                      <span className="s">{r.companyName} · {KIND_LABEL[r.kind]}{r.noticeDeadline ? (Date.parse(r.noticeDeadline) < now ? ' · notice date passed' : ` · notice by ${fmtDate(r.noticeDeadline)}`) : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="agr-section" aria-labelledby="agr-all">
            <h2 id="agr-all">All agreements</h2>
            <div className="drill-filters" role="search">
              <input type="search" aria-label="Search agreements" placeholder="Search title, reference or counterparty" value={params.get('q') ?? ''} onChange={(e) => set('q', e.target.value || null)} />
              <select aria-label="Status" value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value || null)}>
                <option value="">Any status</option>
                {MSA_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              <select aria-label="Expiry window" value={params.get('within') ?? ''} onChange={(e) => set('within', e.target.value || null)}>
                {WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
              <select aria-label="Account" value={params.get('companyId') ?? ''} onChange={(e) => set('companyId', e.target.value || null)}>
                <option value="">All accounts</option>
                {accounts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select aria-label="Type" value={params.get('kind') ?? ''} onChange={(e) => set('kind', e.target.value || null)}>
                <option value="">Any type</option>
                {MSA_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              {filtered ? <button type="button" className="drill-more" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button> : null}
            </div>
            <p className="agr-caption" aria-live="polite" data-testid="agreements-count">
              {shown.length} {shown.length === 1 ? 'agreement' : 'agreements'}{filtered ? ' match' : ''}
              {!params.get('q') && !params.get('kind') && !view ? ' · SOWs and amendments sit under their parent' : ''}
            </p>
            {shown.length === 0 ? <p className="drill-empty">No agreements match these filters.</p> : (
              <div className="agr-table-wrap">
                <table className="drill-table agr-table" data-testid="agreements-table">
                  <thead>
                    <tr><th scope="col">Agreement</th><th scope="col">Account</th><th scope="col">Status</th><th scope="col">Expires</th><th scope="col">Notice by</th><th scope="col" className="num">Linked</th></tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id}>
                        <td><Link to={`/agreements/${r.id}`}>{r.title}</Link><span className="drill-sub">{KIND_LABEL[r.kind]} · {r.reference}</span></td>
                        <td>{r.companyId ? <Link to={`/accounts/${r.companyId}`}>{r.companyName}</Link> : '—'}</td>
                        <td><MsaStatusBadge status={r.status} /></td>
                        <td>{fmtDate(r.expiryDate)}{r.daysToExpiry != null ? <span className="drill-sub"><Days days={r.daysToExpiry} /></span> : null}</td>
                        <td>{fmtDate(r.noticeDeadline)}</td>
                        <td className="num">{r.childCount || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <DocumentHits q={params.get('q') ?? ''} companyId={params.get('companyId') ?? undefined} enabled={!sample} />
        </>
      )}
      <UploadDialog open={newOpen} onOpenChange={setNewOpen} target={{ mode: 'new', companyId: params.get('companyId') ?? undefined }} disabledReason={disabledReason} />
    </div>
  );
}
