import './agreements.css';

import type { AgreementSource } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useAgreementSources, useSyncAgreementSource } from '@/hooks/useMsaWhitespace';
import { lastRunText } from '@/lib/msa/whitespace';

const KIND_LABEL: Record<AgreementSource['kind'], string> = { sharepoint: 'SharePoint', docusign: 'DocuSign' };

export function SourcesPanel({ enabled = true }: { enabled?: boolean }) {
  const canAdmin = useHasPermission('msa:admin');
  const sources = useAgreementSources(enabled);
  const sync = useSyncAgreementSource();
  if (!enabled) return null;

  const items = sources.data?.items;
  const retry = (
    <Button variant="secondary" size="lg" onClick={() => void sources.refetch()}>
      Retry
    </Button>
  );
  // A missing payload is not an empty connector list. Sample mode never asks.
  if (!items || (items.length === 0 && sources.isError)) {
    return (
      <section className="agr-section" aria-labelledby="agr-sources" data-testid="agreement-sources">
        <h2 id="agr-sources">Sources</h2>
        {sources.isError ? (
          <>
            <p className="agr-error" role="alert">
              Could not load agreement sources. The sources have not arrived.
            </p>
            {retry}
          </>
        ) : (
          <p className="agr-caption" role="status">
            Checking agreement sources. They have not arrived.
          </p>
        )}
      </section>
    );
  }
  if (items.length === 0) return null;
  return (
    <section className="agr-section" aria-labelledby="agr-sources" data-testid="agreement-sources">
      <h2 id="agr-sources">Sources</h2>
      {sources.isError ? (
        <>
          <p className="agr-error" role="alert">
            Could not refresh agreement sources. The latest read has not arrived.
          </p>
          {retry}
        </>
      ) : null}
      <ul className="agr-sources">
        {items.map((s) => {
          const active = s.lastRun?.state === 'queued' || s.lastRun?.state === 'running';
          return (
            <li key={s.id} data-testid="agreement-source">
              <span className="t">{s.name}</span>
              <span className="drill-sub">{KIND_LABEL[s.kind]}{s.enabled ? '' : ' · paused'}{s.configured ? '' : ' · not connected'}</span>
              <span className="agr-sources-run" data-state={s.lastRun?.state ?? 'none'}>{lastRunText(s)}</span>
              {canAdmin ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={active || !s.enabled || !s.configured || sync.isPending}
                  onClick={() => sync.mutate(s.id, { onError: (e) => toast.error(e instanceof Error ? e.message : 'Sync failed to start') })}
                  data-testid="agreement-source-sync"
                >
                  Sync now
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
