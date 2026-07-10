import { useTranslation } from 'react-i18next';

import type { Requirement } from '@/hooks/rfp/useRfpRequirements';

interface RequirementRowProps {
  requirement: Requirement;
}

// Theme-token chip pairs (light + dark safe), same system as
// ProposalStatusChip: danger tint = red (critical), tomato tag = orange
// (high), amber tag = yellow (medium), neutral sunken = low. Raw Tailwind
// palette classes are banned here — they don't follow data-theme.
const PRIORITY_STYLES: Record<Requirement['priority'], string> = {
  critical: 'bg-[var(--danger-tint)] text-[var(--fg-error)]',
  high: 'bg-[var(--tag-tomato-bg)] text-[var(--tag-tomato-fg)]',
  medium: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
  low: 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)]',
};

export function RequirementRow({ requirement }: RequirementRowProps) {
  const { t } = useTranslation('rfp');
  const confidencePct = Math.round(requirement.aiConfidenceBps / 100);

  return (
    <li className="flex flex-col gap-1.5 border-b border-[var(--border-subtle)] px-4 py-3 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-[var(--fg-primary)]">{requirement.text}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold uppercase ${PRIORITY_STYLES[requirement.priority]}`}
          >
            {requirement.priority}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-tertiary)]">
        <span>{requirement.category}</span>
        {requirement.pageRef !== null && (
          <span
            aria-label={t('requirementRow.pageRefAria', 'Found on page {{page}}', {
              page: requirement.pageRef,
            })}
          >
            · p. {requirement.pageRef}
          </span>
        )}
        <span
          aria-label={t('requirementRow.confidenceAria', 'AI confidence: {{percent}}%', {
            percent: confidencePct,
          })}
          title={t('requirementRow.confidenceAria', 'AI confidence: {{percent}}%', {
            percent: confidencePct,
          })}
        >
          · {t('requirementRow.confidenceLabel', '{{percent}}% confidence', {
            percent: confidencePct,
          })}
        </span>
      </div>
    </li>
  );
}
