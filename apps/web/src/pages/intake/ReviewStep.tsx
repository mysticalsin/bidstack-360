/**
 * ReviewStep — human-in-the-loop approval of extracted solutions and products.
 * Step 3: user reviews and optionally removes items before publishing.
 */
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { useAccountIntel, useDeleteSolution, useDeleteProduct } from '@/hooks/useAccountIntel';

import type { ExtractedItem } from './intakeConfig';

interface ReviewStepProps {
  accountId: string;
  onNext: () => void;
  onBack: () => void;
}

export function ReviewStep({ accountId, onNext, onBack }: ReviewStepProps) {
  const { t } = useTranslation('crm');
  const intel = useAccountIntel(accountId || undefined);
  const solutions = (intel.data?.solutions ?? []) as ExtractedItem[];
  const products = (intel.data?.products ?? []) as ExtractedItem[];
  const deleteSolution = useDeleteSolution(accountId || undefined);
  const deleteProduct = useDeleteProduct(accountId || undefined);

  const handleDeleteSolution = (id: string, name: string) => {
    deleteSolution.mutate(id, {
      onSuccess: () => toast.success(t('reviewStep.toastRemoved', 'Removed "{{name}}"', { name })),
      onError: () =>
        toast.error(t('reviewStep.toastRemoveFailed', 'Failed to remove "{{name}}"', { name })),
    });
  };

  const handleDeleteProduct = (id: string, name: string) => {
    deleteProduct.mutate(id, {
      onSuccess: () => toast.success(t('reviewStep.toastRemoved', 'Removed "{{name}}"', { name })),
      onError: () =>
        toast.error(t('reviewStep.toastRemoveFailed', 'Failed to remove "{{name}}"', { name })),
    });
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('reviewStep.heading', 'Review extracted data')}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => intel.refetch()}>
          <Icon name="refresh" size={14} />
          {t('reviewStep.refresh', 'Refresh')}
        </Button>
      </div>

      {intel.isLoading ? (
        <div className="h-32 flex items-center justify-center text-xs text-[var(--fg-tertiary)]">
          {t('reviewStep.loading', 'Loading…')}
        </div>
      ) : (
        <>
          <ExtractedGroup
            title={t('reviewStep.groupSolutions', 'Solutions')}
            items={solutions}
            onDelete={handleDeleteSolution}
            isDeleting={deleteSolution.isPending}
          />
          <ExtractedGroup
            title={t('reviewStep.groupProducts', 'Products')}
            items={products}
            onDelete={handleDeleteProduct}
            isDeleting={deleteProduct.isPending}
          />
        </>
      )}

      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={onBack}>
          {t('reviewStep.back', '← Back')}
        </Button>
        <Button onClick={onNext}>{t('reviewStep.publish', 'Publish →')}</Button>
      </div>
    </Card>
  );
}

// ── ExtractedGroup — renders one category (solutions or products) ──────────────

function ExtractedGroup({
  title,
  items,
  onDelete,
  isDeleting,
}: {
  title: string;
  items: ExtractedItem[];
  onDelete: (id: string, name: string) => void;
  isDeleting: boolean;
}) {
  const { t } = useTranslation('crm');
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {t('reviewStep.groupHeading', '{{title}} ({{count}})', { title, count: items.length })}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--fg-tertiary)]">
          {t('reviewStep.empty', 'No {{label}} extracted.', { label: title.toLowerCase() })}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-start justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-[var(--fg-primary)]">{item.name}</div>
                  <ConfidenceBadge bps={item.confidenceBps} />
                </div>
                <div className="text-xs text-[var(--fg-secondary)]">{item.description}</div>
              </div>
              <button
                type="button"
                aria-label={t('reviewStep.removeAria', 'Remove {{name}}', { name: item.name })}
                onClick={() => onDelete(item.id, item.name)}
                disabled={isDeleting}
                className="opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100 focus:opacity-100 shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ConfidenceBadge — only used within this file ──────────────────────────────

function ConfidenceBadge({ bps }: { bps: number }) {
  const pct = Math.round(bps / 100);
  let color = 'text-[var(--fg-tertiary)] bg-[var(--surface-sunken)]';
  if (bps >= 8000) color = 'text-[var(--success)] bg-[var(--success-tint)]';
  else if (bps >= 6000) color = 'text-[var(--info)] bg-[var(--info-tint)]';
  else if (bps >= 4000) color = 'text-[var(--warning)] bg-[var(--warning-tint)]';
  return (
    <span
      className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}
    >
      {pct}%
    </span>
  );
}
