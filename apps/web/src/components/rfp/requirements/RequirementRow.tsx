import type { Requirement } from '@/hooks/rfp/useRfpRequirements';

interface RequirementRowProps {
  requirement: Requirement;
}

const PRIORITY_STYLES: Record<Requirement['priority'], string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)]',
};

export function RequirementRow({ requirement }: RequirementRowProps) {
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
          <span aria-label={`Found on page ${requirement.pageRef}`}>
            · p. {requirement.pageRef}
          </span>
        )}
        <span
          aria-label={`AI confidence: ${confidencePct}%`}
          title={`AI confidence: ${confidencePct}%`}
        >
          · {confidencePct}% confidence
        </span>
      </div>
    </li>
  );
}
