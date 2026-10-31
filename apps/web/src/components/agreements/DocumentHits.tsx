import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useMsaSearch } from '@/hooks/useMsa';
import { KIND_LABEL, snippetParts } from '@/lib/msa/labels';

import { MsaStatusBadge } from './StatusBadge';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "Found inside documents": full-text hits from uploaded PDF and Word files. */
export function DocumentHits({ q, companyId, enabled }: { q: string; companyId?: string; enabled: boolean }) {
  const term = useDebounced(q, 300);
  const search = useMsaSearch(term, { companyId, enabled });
  if (!enabled || term.trim().length < 2) return null;
  const items = search.data?.items ?? [];
  return (
    <section className="agr-section" aria-labelledby="agr-hits" data-testid="agreements-doc-hits">
      <h2 id="agr-hits">Found inside documents</h2>
      {search.isLoading ? <p className="agr-caption">Searching the files…</p> : null}
      {search.isError ? <p className="agr-error" role="alert">Document search is unavailable right now.</p> : null}
      {search.isSuccess && items.length === 0 ? (
        <p className="drill-empty">No file text matches &ldquo;{term.trim()}&rdquo;. New uploads become searchable once their text is extracted.</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="agr-hits">
          {items.map((h) => (
            <li key={h.versionId}>
              <Link to={`/agreements/${h.contractId}?version=${h.versionId}`}>
                <span className="t">{h.title}</span>
                <span className="s">{KIND_LABEL[h.kind]} · v{h.versionNo} <MsaStatusBadge status={h.status} /></span>
                <span className="snip">
                  {snippetParts(h.snippet).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
