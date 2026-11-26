import './agreements.css';

import type { MsaValueItem } from '@bidstack/shared';

import { useMsaValuePanel } from '@/hooks/useMsaLeverage';

import {
  VALUE_PANEL_CHECKING,
  VALUE_PANEL_FAILED,
  VALUE_PANEL_REFRESH_FAILED,
  valuePanelRead,
} from './value-panel-read';

function cite(item: MsaValueItem): string {
  if (item.absence) return 'not found';
  if (!item.citation) return 'not found';
  const bits = [item.citation.clause, item.citation.page ? `page ${item.citation.page}` : null].filter(Boolean);
  return bits.join(', ') || item.citation.excerpt;
}

function ItemList({ items }: { items: readonly MsaValueItem[] }) {
  return (
    <ul className="agr-value" data-testid="msa-value-panel">
      {items.map((item) => (
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

export function ValuePanel({ msaId }: { msaId: string }) {
  const q = useMsaValuePanel(msaId);
  const data = q.data;
  const parsed = data && Array.isArray(data.items) ? data.items : null;
  const read = valuePanelRead({
    isError: q.isError,
    items: q.isError || q.isSuccess ? parsed : null,
    badPayload: Boolean(q.isSuccess && data != null && !Array.isArray(data.items)),
  });

  if (read === 'checking') {
    return (
      <p className="agr-caption" aria-live="polite" data-testid="msa-value-panel-status">
        {VALUE_PANEL_CHECKING}
      </p>
    );
  }
  if (read === 'failed') {
    return (
      <p className="agr-error" role="alert" data-testid="msa-value-panel-status">
        {VALUE_PANEL_FAILED}
      </p>
    );
  }
  if (read === 'empty') {
    return <p className="drill-empty">No extra value items on this MSA right now.</p>;
  }
  const items = parsed ?? [];
  return (
    <>
      {read === 'refresh-failed' ? (
        <p className="agr-error" role="alert" data-testid="msa-value-panel-status">
          {VALUE_PANEL_REFRESH_FAILED}
        </p>
      ) : null}
      {items.length > 0 ? <ItemList items={items} /> : null}
    </>
  );
}
