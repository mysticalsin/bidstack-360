/**
 * CompanyTechStackSection — read-only technology-stack logo wall for the account
 * detail. Pulls the effective stack via useCompanyTechnicalStack (name-keyed) and
 * renders real brand logos (TechLogo → Simple Icons proxy, monogram fallback).
 * Full curation/AI-suggestion editing stays in the cockpit TechStackCard.
 */
import { Card } from '@/components/ui/Card';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useCompanyTechnicalStack } from '@/hooks/useCompanyTechnicalStack';

import { TechLogo } from './TechLogo';

export function CompanyTechStackSection({ companyName }: { companyName: string }) {
  const { data, isLoading } = useCompanyTechnicalStack(companyName);
  // Tech stack is supplementary + name-keyed against the CRM store; a miss (404)
  // is "none here", not an error — degrade quietly to the empty state.
  const categories = (data?.effectiveStack ?? []).filter((cat) => cat.items.length > 0);

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] p-4">
        <h2 className="text-base font-semibold text-[var(--fg-primary)]">Technology stack</h2>
        <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">Detected and curated tools across the account</p>
      </div>
      <div className="p-4">
        {isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : categories.length === 0 ? (
          <EmptyState
            title="No technology detected yet"
            message="Tools appear here as enrichment or manual curation fills the stack."
          />
        ) : (
          <div className="space-y-4">
            {categories.map((cat) => (
              <div key={cat.label}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
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
