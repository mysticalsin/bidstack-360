import './agreements.css';

import { useId } from 'react';

import { labelBusinessLine } from '@bidstack/shared';

import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useRelationshipMap } from '@/hooks/useMsaWhitespace';
import { fmtDate, fmtMoneyMicros } from '@/lib/msa/labels';
import { whoRows } from '@/lib/msa/whitespace';

import { whoWorksReadKind } from './who-works-read';

export function WhoWorksWithThem({ companyId, as = 'section' }: { companyId: string | null | undefined; as?: 'section' | 'div' }) {
  const map = useRelationshipMap(companyId);
  const headingId = useId();
  if (!companyId) return null;
  const Wrap = as;
  const rows = map.data ? whoRows(map.data) : [];
  const affiliates = (Array.isArray(map.data?.companies) ? map.data.companies : []).filter((c) => c.relation !== 'self');
  const kind = whoWorksReadKind({
    isLoading: map.isLoading,
    isError: map.isError,
    hasPayload: map.data !== undefined,
    rowCount: rows.length,
  });
  return (
    <Wrap className={as === 'section' ? 'agr-section' : 'agr-who'} aria-labelledby={headingId} data-testid="who-works-with-them">
      <h2 id={headingId} className="agr-who-title">Who works with them</h2>
      {kind === 'loading' ? (
        <LoadingSkeleton rows={3} />
      ) : kind === 'unread' ? (
        <p className="drill-empty" role="status" data-testid="who-works-read">Who works with them has not arrived.</p>
      ) : kind === 'failed' ? (
        <p className="agr-error" role="alert" data-testid="who-works-read">Couldn&apos;t load who works with them.</p>
      ) : kind === 'empty' ? (
        <p className="drill-empty" data-testid="who-works-read">No one in the group works with them yet.</p>
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
