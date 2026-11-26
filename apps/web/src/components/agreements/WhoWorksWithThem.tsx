import './agreements.css';

import { useId } from 'react';

import { labelBusinessLine } from '@bidstack/shared';

import { useRelationshipMap } from '@/hooks/useMsaWhitespace';
import { fmtDate, fmtMoneyMicros } from '@/lib/msa/labels';
import { whoRows } from '@/lib/msa/whitespace';

export function WhoWorksWithThem({ companyId, as = 'section' }: { companyId: string | null | undefined; as?: 'section' | 'div' }) {
  const map = useRelationshipMap(companyId);
  const headingId = useId();
  if (!companyId) return null;
  // Copy the flags first. A paused read has isLoading false, and a failed status can
  // leave isError false while a previous value is still attached.
  const data = map.data ?? null;
  const isError = map.isError;
  const isPending = map.isPending;
  const isLoading = map.isLoading;
  const isFetching = map.isFetching;
  const status = `${map.status}`;
  const fetchStatus = `${map.fetchStatus}`;
  const failed = isError || status === 'error';
  const waiting =
    !failed &&
    data == null &&
    (fetchStatus === 'paused' || status === 'pending' || isPending || isLoading || isFetching);
  const rows = !failed && !waiting && data ? whoRows(data) : [];
  const affiliates =
    !failed && !waiting && Array.isArray(data?.companies)
      ? data.companies.filter((c) => c.relation !== 'self')
      : [];
  const Wrap = as;
  return (
    <Wrap className={as === 'section' ? 'agr-section' : 'agr-who'} aria-labelledby={headingId} data-testid="who-works-with-them">
      <h2 id={headingId} className="agr-who-title">Who works with them</h2>
      {failed ? (
        <p className="agr-error" role="alert">Could not load who works with them.</p>
      ) : waiting ? (
        <p className="agr-caption" role="status">Checking who works with them.</p>
      ) : rows.length === 0 ? (
        <p className="drill-empty">No one in the group works with them yet.</p>
      ) : (
        <div className="agr-table-wrap">
          <table className="drill-table agr-who-table">
            <thead>
              <tr>
                <th scope="col">Entity</th>
                <th scope="col">Line</th>
                <th scope="col">Owner</th>
                <th scope="col">Last activity</th>
                <th scope="col" className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.entity ?? '–'}</td>
                  <td>{r.line ? labelBusinessLine(r.line) : '–'}</td>
                  <td>{r.owners.join(', ') || '–'}</td>
                  <td>{fmtDate(r.lastActivityAt)}</td>
                  <td className="num">{r.totals.length ? r.totals.map((t) => fmtMoneyMicros(t.valueMicros, t.currency)).join(' · ') : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {affiliates.length ? (
        <p className="agr-who-family" data-testid="who-works-with-them-family">
          {affiliates.map((c) => c.name).join(' · ')}
        </p>
      ) : null}
    </Wrap>
  );
}
