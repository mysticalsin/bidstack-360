// Account page: one compact card answering "what are we signed up to with
// this account, and what's due next?" Every number links into /agreements
// pre-filtered to the account, the primary agreement opens its detail page.
import './agreements.css';
import '@/components/drill/drill.css';

import { Link } from 'react-router-dom';

import { MsaStatusBadge } from '@/components/agreements/StatusBadge';
import { useMsaAccountSummary } from '@/hooks/useMsa';
import { fmtDate, fmtDays, urgency } from '@/lib/msa/labels';

export function AgreementsSummaryCard({ companyId, companyName }: { companyId: string; companyName?: string }) {
  const q = useMsaAccountSummary(companyId, companyName);
  const base = `/agreements?companyId=${encodeURIComponent(companyId)}`;
  const s = q.data?.data;
  return (
    <section className="agr-section" aria-labelledby="agr-acct" data-testid="account-agreements-card">
      <div className="agr-head" style={{ alignItems: 'center' }}>
        <h2 id="agr-acct" style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>
          Agreements{q.data?.sample ? <span className="drill-sub" style={{ display: 'inline', marginLeft: 8 }}>Sample</span> : null}
        </h2>
        <Link className="drill-more" to={base}>View all</Link>
      </div>
      {q.isLoading ? <p className="drill-empty">Loading…</p> : q.isError || !s ? (
        <p className="drill-empty">Agreements are unavailable right now.</p>
      ) : s.total === 0 ? (
        <p className="drill-empty">No agreements on file for this account. <Link to={base}>Add one</Link></p>
      ) : (
        <>
          {s.primary ? (
            <p className="agr-caption">
              <Link to={`/agreements/${s.primary.id}`} style={{ fontWeight: 500, color: 'var(--fg-primary)' }}>{s.primary.title}</Link>{' '}
              <MsaStatusBadge status={s.primary.status} />
            </p>
          ) : null}
          <div className="agr-card-nums">
            <Link to={`${base}&view=active`}><span className="v">{s.byStatus.active ?? 0}</span><span className="l">Active of {s.total}</span></Link>
            {s.nextExpiry ? (
              <Link to={`/agreements/${s.nextExpiry.id}`}>
                <span className="v agr-days" data-u={urgency(s.nextExpiry.days)} style={{ fontSize: 24 }}>{s.nextExpiry.days}d</span>
                <span className="l">Next expiry · {fmtDate(s.nextExpiry.date)}</span>
              </Link>
            ) : <span><span className="v">–</span><span className="l">No expiry dates</span></span>}
            {s.nextNoticeDeadline ? (
              <Link to={`/agreements/${s.nextNoticeDeadline.id}`}>
                <span className="v agr-days" data-u={urgency(s.nextNoticeDeadline.days)} style={{ fontSize: 24 }}>{s.nextNoticeDeadline.days}d</span>
                <span className="l">Notice due {fmtDays(s.nextNoticeDeadline.days)}</span>
              </Link>
            ) : <span><span className="v">–</span><span className="l">No notice due</span></span>}
          </div>
          <p className="agr-caption" style={{ fontSize: 13 }}>
            <Link to={`${base}&kind=sow`}>{s.childCounts.sow} {s.childCounts.sow === 1 ? 'SOW' : 'SOWs'}</Link> · <Link to={`${base}&kind=amendment`}>{s.childCounts.amendment} {s.childCounts.amendment === 1 ? 'amendment' : 'amendments'}</Link>
            {s.childCounts.addendum ? <> · <Link to={`${base}&kind=addendum`}>{s.childCounts.addendum} {s.childCounts.addendum === 1 ? 'addendum' : 'addenda'}</Link></> : null}
          </p>
        </>
      )}
    </section>
  );
}
