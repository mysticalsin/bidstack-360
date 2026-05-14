// Intake Workflow — receive documents, run extraction, review & publish.
//
// Steps:
//  1. Receive — drag & drop or select documents
//  2. Extract — run Dust agents against selected documents (with live status polling)
//  3. Review — human-in-the-loop approval of extracted solutions/products
//  4. Publish — commit approved extractions to the account profile

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';

import { useFiles, useUploadFile } from '@/hooks/useFiles';
import {
  useAccountIntel,
  useExtractDocument,
  useDeleteSolution,
  useDeleteProduct,
} from '@/hooks/useAccountIntel';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { staggerParent, staggerChild } from '@/lib/motion';

const STEPS = [
  { id: 'receive', label: 'Receive' },
  { id: 'extract', label: 'Extract' },
  { id: 'review', label: 'Review' },
  { id: 'publish', label: 'Publish' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export function IntakePage() {
  const [params] = useSearchParams();
  const accountId = params.get('account') ?? '';
  const [step, setStep] = useState<StepId>('receive');
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [extractingDocIds, setExtractingDocIds] = useState<Set<string>>(new Set());
  const reducedMotion = useReducedMotion();

  const files = useFiles(accountId || undefined);
  const extract = useExtractDocument(accountId || undefined);

  // Poll intel when we have extractions in progress
  const hasPendingExtractions = extractingDocIds.size > 0;
  const intel = useAccountIntel(accountId || undefined, {
    refetchInterval: hasPendingExtractions ? 2000 : false,
  });

  // Auto-detect when all extractions are done and advance to review
  useEffect(() => {
    if (!hasPendingExtractions) return;
    if (!intel.data) return;

    const pendingOrRunning = intel.data.extractions.filter(
      (e) => e.status === 'pending' || e.status === 'running',
    );

    if (pendingOrRunning.length === 0 && intel.data.extractions.length > 0) {
      // All done — clear tracking and advance (defer to next tick to avoid
      // cascading renders flagged by eslint react-hooks/set-state-in-effect)
      setTimeout(() => {
        setExtractingDocIds(new Set());
        setStep('review');
        toast.success('Extraction complete');
      }, 0);
    }
  }, [intel.data, hasPendingExtractions]);

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runExtraction = () => {
    if (selectedDocs.size === 0) {
      toast.info('Select at least one document');
      return;
    }
    setExtractingDocIds(new Set(selectedDocs));
    for (const docId of selectedDocs) {
      extract.mutate(
        { documentId: docId },
        {
          onError: (err) =>
            toast.error('Extraction failed', {
              description: err instanceof Error ? err.message : '',
            }),
        },
      );
    }
  };

  const selectedDocNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of files.data?.items ?? []) {
      map.set(item.id, item.name);
    }
    return map;
  }, [files.data]);

  return (
    <motion.div
      className="space-y-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <motion.header variants={reducedMotion ? undefined : staggerChild}>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Intake</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Receive documents, extract intelligence, review, and publish to account profiles.
        </p>
      </motion.header>

      {/* Stepper */}
      <motion.div
        variants={reducedMotion ? undefined : staggerChild}
        className="flex items-center gap-2"
      >
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(s.id)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                step === s.id
                  ? 'bg-[var(--fg-primary)] text-[var(--surface-page)]'
                  : i < STEPS.findIndex((x) => x.id === step)
                    ? 'bg-[#ecfdf5] text-[#059669]'
                    : 'bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]'
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-current/15 text-[10px] font-bold">
                {i + 1}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <span className="text-[var(--border-subtle)]">→</span>}
          </div>
        ))}
      </motion.div>

      {/* Step content */}
      {step === 'receive' && (
        <ReceiveStep
          accountId={accountId}
          files={files}
          selectedDocs={selectedDocs}
          onToggle={toggleDoc}
          onNext={() => setStep('extract')}
        />
      )}
      {step === 'extract' && (
        <ExtractStep
          selectedCount={selectedDocs.size}
          extractingDocIds={extractingDocIds}
          selectedDocNames={selectedDocNames}
          extractions={intel.data?.extractions ?? []}
          onExtract={runExtraction}
          isExtracting={extract.isPending}
          onBack={() => setStep('receive')}
        />
      )}
      {step === 'review' && (
        <ReviewStep
          accountId={accountId}
          onNext={() => setStep('publish')}
          onBack={() => setStep('extract')}
        />
      )}
      {step === 'publish' && (
        <PublishStep
          accountId={accountId}
          onBack={() => setStep('review')}
          onDone={() => {
            setSelectedDocs(new Set());
            setExtractingDocIds(new Set());
            setStep('receive');
          }}
        />
      )}
    </motion.div>
  );
}

function ReceiveStep({
  accountId,
  files,
  selectedDocs,
  onToggle,
  onNext,
}: {
  accountId: string;
  files: ReturnType<typeof useFiles>;
  selectedDocs: Set<string>;
  onToggle: (id: string) => void;
  onNext: () => void;
}) {
  const upload = useUploadFile(accountId);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    for (const file of dropped) {
      upload.mutate(file, {
        onSuccess: () => toast.success(`Uploaded ${file.name}`),
        onError: (err) =>
          toast.error(`Upload failed`, { description: err instanceof Error ? err.message : '' }),
      });
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    for (const file of picked) {
      upload.mutate(file, {
        onSuccess: () => toast.success(`Uploaded ${file.name}`),
        onError: (err) =>
          toast.error(`Upload failed`, { description: err instanceof Error ? err.message : '' }),
      });
    }
    e.target.value = '';
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Select documents</h2>
        <span className="text-xs text-[var(--fg-tertiary)]">{selectedDocs.size} selected</span>
      </div>

      {/* Upload dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
          isDragging
            ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
            : 'border-[var(--border-subtle)] bg-[var(--surface-sunken)]'
        }`}
      >
        <Icon name="upload" size={20} className="mx-auto text-[var(--fg-tertiary)]" />
        <p className="mt-1 text-xs text-[var(--fg-secondary)]">
          Drag & drop files here or{' '}
          <label className="cursor-pointer text-[var(--brand-primary)] hover:underline">
            browse
            <input type="file" multiple className="sr-only" onChange={handleFileInput} />
          </label>
        </p>
        <p className="text-[10px] text-[var(--fg-tertiary)]">
          PDF, DOCX, PPTX, XLSX, TXT — up to 50 MB
        </p>
        {upload.isPending && (
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-[var(--fg-secondary)]">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
            Uploading…
          </div>
        )}
      </div>

      {!accountId ? (
        <EmptyState title="No account selected" message="Add ?account=ACCOUNT_ID to the URL." />
      ) : files.isError ? (
        <ErrorState title="Failed to load files" message={files.error?.message} />
      ) : files.isLoading ? (
        <div className="h-32 flex items-center justify-center text-xs text-[var(--fg-tertiary)]">
          Loading…
        </div>
      ) : files.data?.items.length === 0 ? (
        <EmptyState
          title="No documents yet"
          message="Upload documents above or use the account file manager."
        />
      ) : (
        <div className="space-y-2">
          {files.data?.items.map((f) => (
            <label
              key={f.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                selectedDocs.has(f.id)
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedDocs.has(f.id)}
                onChange={() => onToggle(f.id)}
                className="h-4 w-4 accent-[var(--brand-primary)]"
              />
              <Icon name="file" size={16} className="text-[var(--fg-tertiary)]" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--fg-primary)] truncate">
                  {f.name}
                </div>
                <div className="text-[10px] text-[var(--fg-tertiary)]">
                  {f.contentType} · {(f.bytes / 1024).toFixed(0)} KB
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={selectedDocs.size === 0}>
          Next: Extract →
        </Button>
      </div>
    </Card>
  );
}

function ExtractStep({
  selectedCount,
  extractingDocIds,
  selectedDocNames,
  extractions,
  onExtract,
  isExtracting,
  onBack,
}: {
  selectedCount: number;
  extractingDocIds: Set<string>;
  selectedDocNames: Map<string, string>;
  extractions: Array<{ documentId: string; status: string; error: string | null }>;
  onExtract: () => void;
  isExtracting: boolean;
  onBack: () => void;
}) {
  const isProcessing = extractingDocIds.size > 0;

  // Build status map by documentId
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
                      {error && <div className="text-[10px] text-red-500 truncate">{error}</div>}
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    running: 'bg-blue-100 text-blue-700',
    done: 'bg-emerald-100 text-emerald-700',
    completed: 'bg-emerald-100 text-emerald-700',
    error: 'bg-red-100 text-red-700',
    failed: 'bg-red-100 text-red-700',
  };
  const label = status === 'done' ? 'Completed' : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${styles[status] ?? 'bg-gray-100 text-gray-700'}`}
    >
      {status === 'pending' || status === 'running' ? (
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
      ) : status === 'done' || status === 'completed' ? (
        <Icon name="check" size={10} />
      ) : (
        <Icon name="warning" size={10} />
      )}
      {label}
    </span>
  );
}

function ReviewStep({
  accountId,
  onNext,
  onBack,
}: {
  accountId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const intel = useAccountIntel(accountId || undefined);
  const solutions = intel.data?.solutions ?? [];
  const products = intel.data?.products ?? [];
  const deleteSolution = useDeleteSolution(accountId || undefined);
  const deleteProduct = useDeleteProduct(accountId || undefined);

  const handleDeleteSolution = (id: string, name: string) => {
    deleteSolution.mutate(id, {
      onSuccess: () => toast.success(`Removed "${name}"`),
      onError: () => toast.error(`Failed to remove "${name}"`),
    });
  };

  const handleDeleteProduct = (id: string, name: string) => {
    deleteProduct.mutate(id, {
      onSuccess: () => toast.success(`Removed "${name}"`),
      onError: () => toast.error(`Failed to remove "${name}"`),
    });
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Review extracted data</h2>
        <Button variant="ghost" size="sm" onClick={() => intel.refetch()}>
          <Icon name="refresh" size={14} />
          Refresh
        </Button>
      </div>

      {intel.isLoading ? (
        <div className="h-32 flex items-center justify-center text-xs text-[var(--fg-tertiary)]">
          Loading…
        </div>
      ) : (
        <>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              Solutions ({solutions.length})
            </h3>
            {solutions.length === 0 ? (
              <p className="text-xs text-[var(--fg-tertiary)]">No solutions extracted.</p>
            ) : (
              <div className="space-y-2">
                {solutions.map(
                  (s: {
                    id: string;
                    name: string;
                    description: string | null;
                    confidenceBps: number;
                  }) => (
                    <div
                      key={s.id}
                      className="group flex items-start justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium text-[var(--fg-primary)]">
                            {s.name}
                          </div>
                          <ConfidenceBadge bps={s.confidenceBps} />
                        </div>
                        <div className="text-xs text-[var(--fg-secondary)]">{s.description}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteSolution(s.id, s.name)}
                        disabled={deleteSolution.isPending}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0 rounded-md p-1 text-[var(--fg-tertiary)] hover:bg-red-50 hover:text-red-600"
                        title="Remove"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              Products ({products.length})
            </h3>
            {products.length === 0 ? (
              <p className="text-xs text-[var(--fg-tertiary)]">No products extracted.</p>
            ) : (
              <div className="space-y-2">
                {products.map(
                  (p: {
                    id: string;
                    name: string;
                    description: string | null;
                    confidenceBps: number;
                  }) => (
                    <div
                      key={p.id}
                      className="group flex items-start justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium text-[var(--fg-primary)]">
                            {p.name}
                          </div>
                          <ConfidenceBadge bps={p.confidenceBps} />
                        </div>
                        <div className="text-xs text-[var(--fg-secondary)]">{p.description}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteProduct(p.id, p.name)}
                        disabled={deleteProduct.isPending}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0 rounded-md p-1 text-[var(--fg-tertiary)] hover:bg-red-50 hover:text-red-600"
                        title="Remove"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </>
      )}
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={onNext}>Publish →</Button>
      </div>
    </Card>
  );
}

function ConfidenceBadge({ bps }: { bps: number }) {
  const pct = Math.round(bps / 100);
  let color = 'text-gray-500 bg-gray-100';
  if (bps >= 8000) color = 'text-emerald-700 bg-emerald-100';
  else if (bps >= 6000) color = 'text-blue-700 bg-blue-100';
  else if (bps >= 4000) color = 'text-amber-700 bg-amber-100';
  return (
    <span
      className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}
    >
      {pct}%
    </span>
  );
}

function PublishStep({
  accountId,
  onBack,
  onDone,
}: {
  accountId: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const intel = useAccountIntel(accountId || undefined);
  const solutions = intel.data?.solutions ?? [];
  const products = intel.data?.products ?? [];

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ecfdf5]">
          <Icon name="check" size={20} className="text-[#059669]" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Published</h2>
          <p className="text-xs text-[var(--fg-secondary)]">
            {solutions.length} solution{solutions.length === 1 ? '' : 's'} and {products.length}{' '}
            product
            {products.length === 1 ? '' : 's'} are now live on the account cockpit.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={onBack}>
          ← Review
        </Button>
        <Button onClick={onDone}>Start new intake</Button>
      </div>
    </Card>
  );
}
