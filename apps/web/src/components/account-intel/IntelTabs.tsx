// Display sub-components for AccountIntelPanel: no mutations; money uses the display-currency hook.
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateMessages';
import { Icon } from '@/components/ui/Icon';
import { SourceBadge, type CockpitSourceState } from '@/components/cockpit/SourceBadge';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import type { AccountIntelFieldProvenance } from '@bidstack/shared';

// ─── Shared helper (module-private) ────────────────────────────────────────

function sourceLabel(
  docId: string | null,
  files: Array<{ id: string; name: string }>,
): string | null {
  if (!docId) return null;
  const f = files.find((x) => x.id === docId);
  return f ? f.name : null;
}

function confidencePct(confidenceBps: number): number {
  return Math.max(0, Math.min(100, Math.round(confidenceBps / 100)));
}

function confidenceState(confidenceBps: number): CockpitSourceState {
  if (confidenceBps >= 7000) return 'verified';
  if (confidenceBps >= 5000) return 'crm';
  return 'missing';
}

function sourceState(docId: string | null, confidenceBps: number): CockpitSourceState {
  if (!docId) return 'crm';
  return confidenceState(confidenceBps);
}

function fieldSourceState(source: AccountIntelFieldProvenance | undefined): CockpitSourceState | null {
  if (!source) return null;
  if (source.source === 'manual') return 'crm';
  if (source.source === 'derived:dust') {
    return (source.confidence ?? 0) >= 0.7 ? 'verified' : 'crm';
  }
  if (source.source === 'derived:deterministic') {
    return (source.confidence ?? 0) >= 0.5 ? 'crm' : 'missing';
  }
  return 'crm';
}

function IntelFieldProofRail({
  fieldSources,
  fields,
  testIdBase,
}: {
  fieldSources?: Record<string, AccountIntelFieldProvenance>;
  fields: Array<{ key: string; label: string }>;
  testIdBase: string;
}) {
  const { t } = useTranslation('crm');
  const visibleSources = fields
    .map((field) => ({ field, source: fieldSources?.[field.key] }))
    .filter((entry): entry is { field: { key: string; label: string }; source: AccountIntelFieldProvenance } =>
      Boolean(entry.source),
    );

  if (visibleSources.length === 0) return null;

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
      aria-label={t('intelTabs.fieldProofAria', 'Field source proof')}
    >
      {visibleSources.map(({ field, source }) => (
        <SourceBadge
          key={field.key}
          label={field.label}
          state={fieldSourceState(source) ?? 'crm'}
          hint={t('intelTabs.fieldSourceHint', '{{field}} source: {{hint}}', {
            field: field.label,
            hint: source.hint,
          })}
          data-testid={`${testIdBase}-field-source-${field.key}`}
        />
      ))}
    </div>
  );
}

function IntelSourceBadges({
  confidenceBps,
  documentId,
  fieldSource,
  files,
  testIdBase,
}: {
  confidenceBps: number;
  documentId: string | null;
  fieldSource?: AccountIntelFieldProvenance;
  files: Array<{ id: string; name: string }>;
  testIdBase: string;
}) {
  const { t } = useTranslation('crm');
  const source = sourceLabel(documentId, files);
  const pct = confidencePct(
    fieldSource?.confidence == null ? confidenceBps : fieldSource.confidence * 10_000,
  );
  const sourceHint = fieldSource?.hint ?? (source
    ? t('intelTabs.sourceDocumentHint', 'Extracted from {{source}} with {{pct}}% confidence.', {
        source,
        pct,
      })
    : t('intelTabs.sourceManualHint', 'Stored account intelligence record with {{pct}}% confidence.', {
        pct,
      }));

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <SourceBadge
        label={fieldSource?.label ?? source ?? t('intelTabs.sourceManualBadge', 'Manual')}
        state={fieldSourceState(fieldSource) ?? sourceState(documentId, confidenceBps)}
        hint={sourceHint}
        data-testid={`${testIdBase}-source`}
      />
      <SourceBadge
        label={t('intelTabs.confidenceBadge', '{{pct}}% confidence', { pct })}
        state={confidenceState(confidenceBps)}
        hint={t('intelTabs.confidenceHint', 'Extraction confidence: {{pct}}%.', { pct })}
        data-testid={`${testIdBase}-confidence`}
      />
    </div>
  );
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
    fieldSources?: Record<string, AccountIntelFieldProvenance>;
  }>;
  files: Array<{ id: string; name: string }>;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const { t } = useTranslation('crm');
  if (solutions.length === 0) {
    return (
      <EmptyState
        title={t('intelTabs.solutionsEmptyTitle', 'No solutions yet')}
        message={t(
          'intelTabs.solutionsEmptyMessage',
          'Upload documents and run extraction to review suggested solutions.',
        )}
      />
    );
  }
  return (
    <div className="space-y-2">
      {solutions.map((s) => (
        <Card key={s.id} className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-[var(--fg-primary)]">{s.name}</span>
                <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-tertiary)] uppercase tracking-wider">
                  {s.category}
                </span>
              </div>
              {s.description ? (
                <p className="mt-1 text-xs text-[var(--fg-secondary)] line-clamp-2">
                  {s.description}
                </p>
              ) : null}
              <IntelSourceBadges
                confidenceBps={s.confidenceBps}
                documentId={s.extractedFromDocumentId}
                fieldSource={s.fieldSources?.name}
                files={files}
                testIdBase={`solution-${s.id}`}
              />
              <IntelFieldProofRail
                fieldSources={s.fieldSources}
                fields={[
                  { key: 'description', label: t('intelTabs.solutionDescriptionField', 'Description') },
                  { key: 'category', label: t('intelTabs.solutionCategoryField', 'Category') },
                  { key: 'status', label: t('intelTabs.solutionStatusField', 'Status') },
                ]}
                testIdBase={`solution-${s.id}`}
              />
            </div>
            <button
              type="button"
              onClick={() => onDelete(s.id)}
              disabled={isDeleting}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] focus:outline-none focus:ring-2 focus:ring-border-focus pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              aria-label={t('intelTabs.deleteAriaLabel', 'Delete {{name}}', { name: s.name })}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        </Card>
      ))}
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
    fieldSources?: Record<string, AccountIntelFieldProvenance>;
  }>;
  files: Array<{ id: string; name: string }>;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const { formatMoneyMicros } = useFormatMoney();
  const { t } = useTranslation('crm');

  if (products.length === 0) {
    return (
      <EmptyState
        title={t('intelTabs.productsEmptyTitle', 'No products yet')}
        message={t(
          'intelTabs.productsEmptyMessage',
          'Upload documents and run extraction to review suggested products.',
        )}
      />
    );
  }
  return (
    <div className="space-y-2">
      {products.map((p) => (
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
                    {formatMoneyMicros(p.priceRangeMicros, p.currency)}
                  </span>
                ) : null}
              </div>
              {p.description ? (
                <p className="mt-1 text-xs text-[var(--fg-secondary)] line-clamp-2">
                  {p.description}
                </p>
              ) : null}
              <IntelSourceBadges
                confidenceBps={p.confidenceBps}
                documentId={p.extractedFromDocumentId}
                fieldSource={p.fieldSources?.name}
                files={files}
                testIdBase={`product-${p.id}`}
              />
              <IntelFieldProofRail
                fieldSources={p.fieldSources}
                fields={[
                  { key: 'description', label: t('intelTabs.productDescriptionField', 'Description') },
                  { key: 'category', label: t('intelTabs.productCategoryField', 'Category') },
                  { key: 'priceRangeMicros', label: t('intelTabs.productPriceField', 'Price') },
                  { key: 'currency', label: t('intelTabs.productCurrencyField', 'Currency') },
                  { key: 'status', label: t('intelTabs.productStatusField', 'Status') },
                ]}
                testIdBase={`product-${p.id}`}
              />
            </div>
            <button
              type="button"
              onClick={() => onDelete(p.id)}
              disabled={isDeleting}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] focus:outline-none focus:ring-2 focus:ring-border-focus pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              aria-label={t('intelTabs.deleteAriaLabel', 'Delete {{name}}', { name: p.name })}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        </Card>
      ))}
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
  const { t } = useTranslation('crm');
  return (
    <div className="space-y-3">
      {files.length === 0 ? (
        <EmptyState
          title={t('intelTabs.extractionsEmptyTitle', 'No documents')}
          message={t(
            'intelTabs.extractionsEmptyMessage',
            'Upload files to this account to begin extraction.',
          )}
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
                        {t('intelTabs.extractingButton', 'Extracting…')}
                      </>
                    ) : extraction?.status === 'done' ? (
                      <>
                        <Icon name="refresh" size={14} />
                        {t('intelTabs.reExtractButton', 'Re-extract')}
                      </>
                    ) : (
                      <>
                        <Icon name="wand" size={14} />
                        {t('intelTabs.extractButton', 'Extract')}
                      </>
                    )}
                  </Button>
                </div>
                {extraction?.status === 'done' && extraction.extractedData ? (
                  <div className="mt-2 rounded-md bg-[var(--surface-sunken)] p-2 text-xs font-mono text-[var(--fg-secondary)]">
                    {t(
                      'intelTabs.extractionSummary',
                      '{{solutionCount}} solutions, {{productCount}} products found',
                      {
                        solutionCount:
                          (
                            extraction.extractedData.solutions as
                              | Array<{ name: string }>
                              | undefined
                          )?.length ?? 0,
                        productCount:
                          (
                            extraction.extractedData.products as
                              | Array<{ name: string }>
                              | undefined
                          )?.length ?? 0,
                      },
                    )}
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
