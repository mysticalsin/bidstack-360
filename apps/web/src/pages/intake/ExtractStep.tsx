/**
 * ExtractStep — kick off Dust extraction and poll live status.
 * Step 2: user triggers extraction; rows animate between queued/running/done/error.
 */
import { useMemo } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';

import type { ExtractionItem } from './intakeConfig';

interface ExtractStepProps {
  selectedCount: number;
  extractingDocIds: Set<string>;
  selectedDocNames: Map<string, string>;
  extractions: ExtractionItem[];
  onExtract: () => void;
  isExtracting: boolean;
  onBack: () => void;
}

export function ExtractStep({
  selectedCount,
  extractingDocIds,
  selectedDocNames,
  extractions,
  onExtract,
  isExtracting,
  onBack,
}: ExtractStepProps) {
  const isProcessing = extractingDocIds.size > 0;

  // Build status map by documentId for O(1) per-row lookup
  const statusByDoc = useMemo(() => {
    const map = new Map<string, { status: string; error: string | null }>();
    for (const e of extractions) {
      map.set(e.documentId, { status: e.status, error: e.error });
    }
    return map;
  }, [extractions]);

  return (
    <Card className="p-5 space-y-4">
      <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Run extraction</h2>

      {isProcessing ? (
        <div className="space-y-3">
          <p className="text-xs text-[var(--fg-secondary)]">
            Processing {extractingDocIds.size} document{extractingDocIds.size === 1 ? '' : 's'}…
          </p>
          <div className="space-y-2">
            {Array.from(extractingDocIds).map((docId) => {
              const name = selectedDocNames.get(docId) ?? docId.slice(0, 8);
              const status = statusByDoc.get(docId)?.status ?? 'queued';
              const error = statusByDoc.get(docId)?.error;
              return (
                <div
                  key={docId}
                  className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon name="file" size={16} className="text-[var(--fg-tertiary)] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--fg-primary)] truncate">
                        {name}
                      </div>
                      {error && (
                        <div className="truncate text-[10px] text-[var(--danger)]">{error}</div>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={status} />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-[var(--fg-secondary)]">
            Dust agents will parse {selectedCount} document{selectedCount === 1 ? '' : 's'} and
            extract solutions, products, capabilities, and pricing.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onBack}>
              ← Back
            </Button>
            <Button onClick={onExtract} disabled={isExtracting}>
              {isExtracting ? (
                <>
                  <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
                  Queuing…
                </>
              ) : (
                <>
                  <Icon name="wand" size={14} />
                  Run extraction
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// ── StatusBadge — only used within this file ──────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-[var(--warning-tint)] text-[var(--warning)]',
    running: 'bg-[var(--info-tint)] text-[var(--info)]',
    done: 'bg-[var(--success-tint)] text-[var(--success)]',
    completed: 'bg-[var(--success-tint)] text-[var(--success)]',
    error: 'bg-[var(--danger-tint)] text-[var(--danger)]',
    failed: 'bg-[var(--danger-tint)] text-[var(--danger)]',
  };
  const label = status === 'done' ? 'Completed' : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${styles[status] ?? 'bg-gray-100 text-gray-700'}`}
    >
      {status === 'pending' || status === 'running' ? (
        <span className="inline-block h-2 w-2 motion-safe:animate-pulse rounded-full bg-current" />
      ) : status === 'done' || status === 'completed' ? (
        <Icon name="check" size={10} />
      ) : (
        <Icon name="warning" size={10} />
      )}
      {label}
    </span>
  );
}
