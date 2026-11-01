import './agreements.css';

import type { MsaValueItem } from '@bidstack/shared';

import { useMsaValuePanel } from '@/hooks/useMsaLeverage';

function cite(item: MsaValueItem): string {
  if (item.absence) return 'not found';
  if (!item.citation) return 'not found';
  const bits = [item.citation.clause, item.citation.page ? `page ${item.citation.page}` : null].filter(Boolean);
  return bits.join(', ') || item.citation.excerpt;
}

export function ValuePanel({ msaId }: { msaId: string }) {
  const q = useMsaValuePanel(msaId);
  if (q.isLoading) return <p className="agr-caption">Loading value opportunities…</p>;
  if (q.isError || !q.data || !Array.isArray(q.data.items)) {
    return <p className="agr-caption">Value panel is unavailable right now.</p>;
  }
  if (q.data.items.length === 0) {
    return <p className="drill-empty">No extra value items on this MSA right now.</p>;
  }
  return (
    <ul className="agr-value" data-testid="msa-value-panel">
      {q.data.items.map((item) => (
        <li key={item.id} data-kind={item.kind}>
          <p className="t">{item.title}</p>
          <p className="agr-caption">{item.detail}</p>
          <p className="agr-cite">Cite: {cite(item)}</p>
          {item.approach ? (
            <p className="agr-caption">
              Approach {item.approach.name}
              {item.approach.title ? `, ${item.approach.title}` : ''}
              {item.approach.email ? ` · ${item.approach.email}` : ''}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
