/**
 * ABC opportunity filter rules (M6). Adjustable here so pre-sales can tune
 * which opportunities flow in from ABC without a code change. Consumed by the
 * future ABC sync connector at ingestion time.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useOpportunityFilters, useUpdateOpportunityFilters } from '@/hooks/useOpportunityFilters';
import type { OpportunityFilterRules } from '@bidstack/shared';

export function OpportunityFiltersSection() {
  const filters = useOpportunityFilters();
  if (filters.isLoading) return <LoadingSkeleton rows={4} />;
  if (filters.isError || !filters.data) {
    return (
      <ErrorState
        title="Could not load filter rules"
        message={filters.error?.message ?? 'Try again shortly.'}
      />
    );
  }
  // Keyed remount seeds the editable form from server data once, without an
  // effect-driven setState (which the hooks linter rejects).
  return <FilterForm key={JSON.stringify(filters.data)} initial={filters.data} />;
}

function FilterForm({ initial }: { initial: OpportunityFilterRules }) {
  const update = useUpdateOpportunityFilters();
  const [expertise, setExpertise] = useState(initial.includeExpertiseTypes.join(', '));
  const [solution, setSolution] = useState(initial.includeSolutionTypes.join(', '));
  const [framework, setFramework] = useState(initial.frameworkAgreementTypes.join(', '));
  const [excludeNonFramework, setExcludeNonFramework] = useState(initial.excludeNonFramework);

  const parseList = (raw: string) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const onSave = () => {
    update.mutate(
      {
        includeExpertiseTypes: parseList(expertise),
        includeSolutionTypes: parseList(solution),
        frameworkAgreementTypes: parseList(framework),
        excludeNonFramework,
      },
      {
        onSuccess: () => toast.success('Filter rules saved'),
        onError: (err: Error) => toast.error('Could not save', { description: err.message }),
      },
    );
  };

  return (
    <Card>
      <SectionHeader
        title="Opportunity filters"
        caption="Which ABC opportunities flow into BidStack. Empty list = no filter on that dimension. These rules take effect once the ABC connector is connected — they are applied by the sync at ingestion, not retroactively."
      />
      <div className="space-y-4 p-5">
        <Field
          label="Expertise types to include"
          hint="Comma-separated. Only opportunities tagged with one of these expertise types are imported."
          value={expertise}
          onChange={setExpertise}
        />
        <Field
          label="Solution types to include"
          hint="Comma-separated. Filters by solution type independently of expertise."
          value={solution}
          onChange={setSolution}
        />
        <Field
          label="Framework / agreement types"
          hint="Comma-separated framework or agreement names."
          value={framework}
          onChange={setFramework}
        />
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-[var(--fg-primary)]">
          <input
            type="checkbox"
            checked={excludeNonFramework}
            onChange={(e) => setExcludeNonFramework(e.target.checked)}
            className="h-4 w-4"
          />
          Only import opportunities under a listed framework/agreement
        </label>
        <Button onClick={onSave} disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save filter rules'}
        </Button>
      </div>
    </Card>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-[var(--fg-primary)]">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg-primary)]"
        placeholder="e.g. Cybersecurity, Cloud, Data"
      />
      <p className="text-xs text-[var(--fg-tertiary)]">{hint}</p>
    </div>
  );
}
