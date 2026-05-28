import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AiDisclosureBadge } from '@/components/rfp/shared/AiDisclosureBadge';
import type { ComplianceRow as ComplianceRowData } from '@/hooks/rfp/useRfpCompliance';

interface ComplianceRowProps {
  row: ComplianceRowData;
  style?: React.CSSProperties;
}

const STATUS_STYLES: Record<ComplianceRowData['status'], string> = {
  pending: 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)]',
  compliant: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  partial: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  non_compliant: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_LABELS: Record<ComplianceRowData['status'], string> = {
  pending: 'Pending',
  compliant: 'Compliant',
  partial: 'Partial',
  non_compliant: 'Non-compliant',
};

export function ComplianceRow({ row, style }: ComplianceRowProps) {
  const { t } = useTranslation('rfp');
  const [isEditing, setIsEditing] = useState(false);
  const confidencePct = Math.round(row.aiConfidenceBps / 100);

  return (
    <div
      className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3"
      style={style}
    >
      {/* Requirement */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[var(--fg-primary)] line-clamp-2">
          {row.requirement}
        </p>
        {row.response && !isEditing && (
          <p className="mt-1 text-xs text-[var(--fg-secondary)] line-clamp-2">{row.response}</p>
        )}
        {!row.response && !isEditing && (
          <p className="mt-1 text-xs italic text-[var(--fg-tertiary)]">
            {t('compliance.noResponse')}
          </p>
        )}
        {isEditing && (
          <textarea
            className="mt-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] p-2 text-xs text-[var(--fg-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
            defaultValue={row.response ?? ''}
            rows={3}
            aria-label={`Edit response for: ${row.requirement}`}
          />
        )}
      </div>

      {/* Meta */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span
          className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${STATUS_STYLES[row.status]}`}
          aria-label={`Status: ${STATUS_LABELS[row.status]}`}
        >
          {STATUS_LABELS[row.status]}
        </span>
        {row.autoFilled && (
          // EU AI Act Art. 50 — unambiguous AI disclosure is mandatory for
          // auto-filled compliance answers. The AiDisclosureBadge is always
          // visible when autoFilled=true; it is not behind a toggle.
          // Confidence percentage is supplementary information shown below.
          <div className="flex flex-col items-end gap-0.5">
            <AiDisclosureBadge />
            <span
              className="text-[10px] text-[var(--fg-tertiary)]"
              aria-label={`AI confidence: ${confidencePct}%`}
            >
              {confidencePct}% confidence
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsEditing((v) => !v)}
          className="min-h-[44px] min-w-[44px] rounded-md px-2 py-1 text-[10px] font-medium text-[var(--brand-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          aria-label={isEditing ? t('compliance.done') : t('compliance.edit')}
        >
          {isEditing ? t('compliance.done') : t('compliance.edit')}
        </button>
      </div>
    </div>
  );
}
