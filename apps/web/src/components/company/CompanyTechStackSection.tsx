/**
 * CompanyTechStackSection — read-only technology-stack logo wall for the account
 * detail. Pulls the effective stack via useCompanyTechnicalStack and renders
 * real brand logos (TechLogo → Simple Icons proxy, monogram fallback).
 * Full curation/AI-suggestion editing stays in the cockpit TechStackCard.
 */
import { Card } from '@/components/ui/Card';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useCompanyTechnicalStack } from '@/hooks/useCompanyTechnicalStack';

import { TechLogo } from './TechLogo';

export function CompanyTechStackSection({ companyId }: { companyId: string }) {
  // The API resolves a Company row by id; a name key only resolves when an
  // enrichment row exists, so name lookups 404 for plain accounts.
  const { data, isLoading } = useCompanyTechnicalStack(companyId);
  const categories = (data?.effectiveStack ?? []).filter((cat) => cat.items.length > 0);

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] p-4">
        <h2 className="text-base font-semibold text-[var(--fg-primary)]">Technology stack</h2>
      </div>
      <div className="p-4">
        {isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : categories.length === 0 ? (
          <EmptyState title="No technology detected yet" />
        ) : (
          <div className="space-y-4">
            {categories.map((cat) => (
              <div key={cat.label}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                  {cat.label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {cat.items.map((item) => (
                    <span
                      key={`${cat.label}-${item.name}`}
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5"
                    >
                      <TechLogo name={item.name} size={20} />
                      <span className="text-sm text-[var(--fg-primary)]">{item.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
