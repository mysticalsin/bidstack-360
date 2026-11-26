import './agreements.css';

import { useId } from 'react';

import { labelBusinessLine } from '@bidstack/shared';

import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useRelationshipMap } from '@/hooks/useMsaWhitespace';
import { fmtDate, fmtMoneyMicros } from '@/lib/msa/labels';
import { whoRows } from '@/lib/msa/whitespace';

export function WhoWorksWithThem({ companyId, as = 'section' }: { companyId: string | null | undefined; as?: 'section' | 'div' }) {
  const map = useRelationshipMap(companyId);
  const headingId = useId();
  if (!companyId) return null;
  const Wrap = as;
  const rows = map.data ? whoRows(map.data) : [];
  const affiliates = (Array.isArray(map.data?.companies) ? map.data.companies : []).filter((c) => c.relation !== 'self');
  // A missing payload is not an empty group. Empty is only a settled read.
  const unread = !map.data && !map.isError;
  return (
    <Wrap className={as === 'section' ? 'agr-section' : 'agr-who'} aria-labelledby={headingId} data-testid="who-works-with-them">
      <h2 id={headingId} className="agr-who-title">Who works with them</h2>
      {unread ? (
        <>
          <LoadingSkeleton rows={3} />
          <p className="agr-caption" role="status">Who works with them has not arrived.</p>
        </>
      ) : map.isError ? (
        <>
          <p className="agr-error" role="alert">
            Couldn&apos;t load who works with them.
            {!map.data ? ' The relationship map has not arrived.' : ''}
          </p>
          <button
            type="button"
            className="mt-2 inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-[var(--fg-primary)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
            onClick={() => void map.refetch()}
          >
            Retry
          </button>
        </>
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
