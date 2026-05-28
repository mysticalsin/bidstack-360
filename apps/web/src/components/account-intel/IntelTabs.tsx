// Pure display sub-components for AccountIntelPanel — no hooks, no mutations.
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateMessages';
import { Icon } from '@/components/ui/Icon';
import { formatMoney } from '@/lib/format';

// ─── Shared helper (module-private) ────────────────────────────────────────

function sourceLabel(
  docId: string | null,
  files: Array<{ id: string; name: string }>,
): string | null {
  if (!docId) return null;
  const f = files.find((x) => x.id === docId);
  return f ? f.name : null;
}

// ─── StatusBadge (module-private — only used by ExtractionsTab) ────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]',
    running: 'bg-tag-blue-bg text-tag-blue-fg',
    done: 'bg-[var(--success-tint)] text-[var(--success)]',
    error: 'bg-[var(--danger-tint)] text-[var(--danger)]',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${map[status] ?? map.pending}`}
    >
      {status}
    </span>
  );
}

// ─── Exported tab panels ────────────────────────────────────────────────────

export function SolutionsTab({
  solutions,
  files,
  onDelete,
  isDeleting,
}: {
  solutions: Array<{
    id: string;
    name: string;
    description: string | null;
    category: string;
    status: string;
    confidenceBps: number;
    extractedFromDocumentId: string | null;
  }>;
  files: Array<{ id: string; name: string }>;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  if (solutions.length === 0) {
    return (
      <EmptyState
        title="No solutions yet"
        message="Upload documents and run extraction to review suggested solutions."
      />
    );
  }
  return (
    <div className="space-y-2">
      {solutions.map((s) => {
        const src = sourceLabel(s.extractedFromDocumentId, files);
        return (
          <Card key={s.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[var(--fg-primary)]">{s.name}</span>
                  <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-tertiary)] uppercase tracking-wider">
                    {s.category}
                  </span>
                  {s.confidenceBps > 7000 && (
                    <span className="rounded-full bg-[var(--success-tint)] px-2 py-0.5 text-[10px] font-medium text-[var(--success)]">
                      High confidence
                    </span>
                  )}
                </div>
                {s.description ? (
                  <p className="mt-1 text-xs text-[var(--fg-secondary)] line-clamp-2">
                    {s.description}
                  </p>
                ) : null}
                {src ? (
                  <p className="mt-1 text-[10px] text-[var(--fg-tertiary)]">From: {src}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onDelete(s.id)}
                disabled={isDeleting}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] focus:outline-none focus:ring-2 focus:ring-border-focus pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                aria-label={`Delete ${s.name}`}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function ProductsTab({
  products,
  files,
  onDelete,
  isDeleting,
}: {
  products: Array<{
    id: string;
    name: string;
    description: string | null;
    category: string;
    priceRangeMicros: number | null;
    currency: string;
    status: string;
    confidenceBps: number;
    extractedFromDocumentId: string | null;
  }>;
  files: Array<{ id: string; name: string }>;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  if (products.length === 0) {
    return (
      <EmptyState
        title="No products yet"
        message="Upload documents and run extraction to review suggested products."
      />
    );
  }
  return (
    <div className="space-y-2">
      {products.map((p) => {
        const src = sourceLabel(p.extractedFromDocumentId, files);
        return (
          <Card key={p.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[var(--fg-primary)]">{p.name}</span>
                  <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-tertiary)] uppercase tracking-wider">
                    {p.category}
                  </span>
                  {p.priceRangeMicros ? (
                    <span className="rounded-full bg-tag-blue-bg px-2 py-0.5 text-[10px] font-medium text-tag-blue-fg">
                      {formatMoney(Number(p.priceRangeMicros), p.currency)}
                    </span>
                  ) : null}
                </div>
                {p.description ? (
                  <p className="mt-1 text-xs text-[var(--fg-secondary)] line-clamp-2">
                    {p.description}
                  </p>
                ) : null}
                {src ? (
                  <p className="mt-1 text-[10px] text-[var(--fg-tertiary)]">From: {src}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onDelete(p.id)}
                disabled={isDeleting}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] focus:outline-none focus:ring-2 focus:ring-border-focus pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                aria-label={`Delete ${p.name}`}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function ExtractionsTab({
  extractions,
  files,
  onExtract,
  isExtracting,
}: {
  extractions: Array<{
    id: string;
    documentId: string;
    status: string;
    extractedData: Record<string, unknown>;
    error: string | null;
    createdAt: string;
  }>;
  files: Array<{ id: string; name: string }>;
  onExtract: (documentId: string) => void;
  isExtracting: boolean;
}) {
  return (
    <div className="space-y-3">
      {files.length === 0 ? (
        <EmptyState
          title="No documents"
          message="Upload files to this account to begin extraction."
        />
      ) : (
        <div className="space-y-2">
          {files.map((file) => {
            const extraction = extractions.find((e) => e.documentId === file.id);
            return (
              <Card key={file.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--fg-primary)] truncate">
                      {file.name}
                    </div>
                    {extraction ? (
                      <div className="mt-0.5 flex items-center gap-2 text-xs">
                        <StatusBadge status={extraction.status} />
                        <span className="text-[var(--fg-tertiary)]">
                          {new Date(extraction.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isExtracting || extraction?.status === 'running'}
                    onClick={() => onExtract(file.id)}
                  >
                    {extraction?.status === 'running' ? (
                      <>
                        <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
                        Extracting…
                      </>
                    ) : extraction?.status === 'done' ? (
                      <>
                        <Icon name="refresh" size={14} />
                        Re-extract
                      </>
                    ) : (
                      <>
                        <Icon name="wand" size={14} />
                        Extract
                      </>
                    )}
                  </Button>
                </div>
                {extraction?.status === 'done' && extraction.extractedData ? (
                  <div className="mt-2 rounded-md bg-[var(--surface-sunken)] p-2 text-xs font-mono text-[var(--fg-secondary)]">
                    {(extraction.extractedData.solutions as Array<{ name: string }> | undefined)
                      ?.length ?? 0}{' '}
                    solutions,{' '}
                    {(extraction.extractedData.products as Array<{ name: string }> | undefined)
                      ?.length ?? 0}{' '}
                    products found
                  </div>
                ) : null}
                {extraction?.error ? (
                  <p className="mt-2 text-xs text-[var(--danger)]">{extraction.error}</p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
