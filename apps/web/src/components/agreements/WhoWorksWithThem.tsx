import './agreements.css';

import { useId } from 'react';

import { labelBusinessLine } from '@bidstack/shared';

import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useRelationshipMap } from '@/hooks/useMsaWhitespace';
import { fmtDate, fmtMoneyMicros } from '@/lib/msa/labels';

export function WhoWorksWithThem({ companyId, as = 'section' }: { companyId: string | null | undefined; as?: 'section' | 'div' }) {
  const map = useRelationshipMap(companyId);
  const headingId = useId();
  if (!companyId) return null;
  const Wrap = as;
  const entityName = new Map((map.data?.entities ?? []).map((e) => [e.slug, e.name]));
  const people = map.data?.people ?? [];
  const affiliates = (map.data?.companies ?? []).filter((c) => c.relation !== 'self');
  return (
    <Wrap className={as === 'section' ? 'agr-section' : 'agr-who'} aria-labelledby={headingId} data-testid="who-works-with-them">
      <h2 id={headingId} className="agr-who-title">Who works with them</h2>
      {map.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : map.isError ? (
        <p className="agr-error" role="alert">Couldn&apos;t load who works with them.</p>
      ) : people.length === 0 ? (
        <p className="drill-empty">No one in the group works with them yet.</p>
      ) : (
        <div className="agr-table-wrap">
          <table className="drill-table agr-who-table">
            <thead>
              <tr>
                <th scope="col">Owner</th>
                <th scope="col">Entity</th>
                <th scope="col">Line</th>
                <th scope="col">Last activity</th>
                <th scope="col" className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.owner.id}>
                  <td>{p.owner.name}</td>
                  <td>{p.entities.map((s) => entityName.get(s) ?? s).join(', ') || '–'}</td>
                  <td>{p.lines.map(labelBusinessLine).join(', ') || '–'}</td>
                  <td>{fmtDate(p.lastActivityAt)}</td>
                  <td className="num">{p.valueMicros > 0 && p.currency ? fmtMoneyMicros(p.valueMicros, p.currency) : '–'}</td>
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
