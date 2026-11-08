/**
 * CompanyTechStackSection — read-only technology-stack logo wall for the account
 * detail. Pulls the effective stack via useCompanyTechnicalStack and renders
 * real brand logos (TechLogo → Simple Icons proxy, monogram fallback), grouped
 * by category, with a source chip and evidence per item and a coverage line
 * naming the open data lanes that found nothing.
 * Full curation/AI-suggestion editing stays in the cockpit TechStackCard.
 */
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useCompanyTechnicalStack } from '@/hooks/useCompanyTechnicalStack';

import { TechCoverageLine, TechEvidenceChip } from './TechEvidence';
import { TechLogo } from './TechLogo';

export function CompanyTechStackSection({ companyId }: { companyId: string }) {
  // The API resolves a Company row by id; a name key only resolves when an
  // enrichment row exists, so name lookups 404 for plain accounts.
  const { data, isLoading, isError, refetch } = useCompanyTechnicalStack(companyId);
  const categories = (data?.effectiveStack ?? []).filter((cat) => cat.items.length > 0);

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] p-4">
        <h2 className="text-base font-semibold text-[var(--fg-primary)]">Technology stack</h2>
        {data?.coverage ? (
          <div className="mt-1">
            <TechCoverageLine coverage={data.coverage} />
          </div>
        ) : null}
      </div>
      <div className="p-4">
        {isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : isError && !data ? (
          <ErrorState
            title="Could not load technology stack"
            action={
              <button
                type="button"
                onClick={() => void refetch?.()}
                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border-default)] px-3 text-sm font-semibold text-[var(--fg-primary)] hover:bg-[var(--surface-sunken)]"
              >
                Retry
              </button>
            }
          />
        ) : categories.length === 0 ? (
          <EmptyState title="No technology detected yet" />
        ) : (
          <div className="space-y-4" data-testid="tech-stack-wall">
            {categories.map((cat) => (
              <section key={cat.label} aria-labelledby={`tech-cat-${slug(cat.label)}`}>
                <h3
                  id={`tech-cat-${slug(cat.label)}`}
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]"
                >
                  {cat.label}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {cat.items.map((item) => (
                    <span
                      key={`${cat.label}-${item.name}`}
                      data-tech-item={item.name}
                      className="inline-flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5"
                    >
                      <TechLogo name={item.name} size={20} />
                      <span className="min-w-0 truncate text-sm text-[var(--fg-primary)]" title={item.name}>
                        {item.name}
                      </span>
                      <TechEvidenceChip item={item} />
                    </span>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
