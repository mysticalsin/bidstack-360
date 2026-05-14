// Account Intelligence Panel — solutions, products, and document extractions
// extracted from uploaded documents via Dust agents.

import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import {
  useAccountIntel,
  useExtractDocument,
  useDeleteSolution,
  useDeleteProduct,
} from '@/hooks/useAccountIntel';
import { useFiles } from '@/hooks/useFiles';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { Icon } from '@/components/ui/Icon';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { toast } from '@/components/ui/Toast';
import { springSoft, staggerParent } from '@/lib/motion';
import { formatMoney } from '@/lib/format';

interface Props {
  accountId: string;
}

export function AccountIntelPanel({ accountId }: Props) {
  const intel = useAccountIntel(accountId);
  const files = useFiles(accountId);
  const extract = useExtractDocument(accountId);
  const deleteSolution = useDeleteSolution(accountId);
  const deleteProduct = useDeleteProduct(accountId);
  const reducedMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<'solutions' | 'products' | 'extractions'>('solutions');

  const solutions = intel.data?.solutions ?? [];
  const products = intel.data?.products ?? [];
  const extractions = intel.data?.extractions ?? [];

  const handleExtract = (documentId: string) => {
    extract.mutate(
      { documentId },
      {
        onSuccess: () => toast.success('Extraction queued — intelligence will appear shortly'),
        onError: (err) =>
          toast.error('Extraction failed', {
            description: err instanceof Error ? err.message : 'Unknown error',
          }),
      },
    );
  };

  return (
    <motion.div
      className="space-y-4"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <SectionHeader
        title="Account Intelligence"
        caption="Solutions, products & document extractions"
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)]">
        {[
          { key: 'solutions' as const, label: `Solutions (${solutions.length})` },
          { key: 'products' as const, label: `Products (${products.length})` },
          { key: 'extractions' as const, label: `Extractions (${extractions.length})` },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`relative px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? 'text-[var(--brand-primary)]'
                : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <motion.div
                layoutId="intel-tab"
                className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--brand-primary)]"
                transition={springSoft}
              />
            )}
          </button>
        ))}
      </div>

      {intel.isError ? (
        <ErrorState title="Failed to load" message={intel.error?.message} />
      ) : intel.isLoading ? (
        <TableSkeleton rows={4} columns={3} headless />
      ) : (
        <>
          {activeTab === 'solutions' && (
            <SolutionsTab
              solutions={solutions}
              files={files.data?.items ?? []}
              onDelete={(id) => deleteSolution.mutate(id)}
              isDeleting={deleteSolution.isPending}
            />
          )}
          {activeTab === 'products' && (
            <ProductsTab
              products={products}
              files={files.data?.items ?? []}
              onDelete={(id) => deleteProduct.mutate(id)}
              isDeleting={deleteProduct.isPending}
            />
          )}
          {activeTab === 'extractions' && (
            <ExtractionsTab
              extractions={extractions}
              files={files.data?.items ?? []}
              onExtract={handleExtract}
              isExtracting={extract.isPending}
            />
          )}
        </>
      )}
    </motion.div>
  );
}

function sourceLabel(
  docId: string | null,
  files: Array<{ id: string; name: string }>,
): string | null {
  if (!docId) return null;
  const f = files.find((x) => x.id === docId);
  return f ? f.name : null;
}

function SolutionsTab({
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
        message="Upload documents and run extraction to auto-discover solutions."
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
                    <span className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[10px] font-medium text-[#059669]">
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
                className="shrink-0 rounded p-1 text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)]"
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

function ProductsTab({
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
        message="Upload documents and run extraction to auto-discover products."
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
                    <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-[10px] font-medium text-[#2c4bff]">
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
                className="shrink-0 rounded p-1 text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)]"
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

function ExtractionsTab({
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
      {/* Document list with extract buttons */}
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]',
    running: 'bg-[#eef4ff] text-[#2c4bff]',
    done: 'bg-[#ecfdf5] text-[#059669]',
    error: 'bg-[#ffeded] text-[var(--danger)]',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${map[status] ?? map.pending}`}
    >
      {status}
    </span>
  );
}
