/**
 * AgentsStarterGrid — "Starter agents" section.
 * Renders the RFP template catalog with search + phase filtering + provision CTA.
 */
import type { RfpAgentTemplate, RfpResponsePhaseDefinition } from '@bidstack/shared';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, LoadingSkeleton } from '@/components/ui/StateMessages';

import { ALL_PHASES, PHASE_TONE, formatPhase } from './agentsConfig';

interface AgentsStarterGridProps {
  selectedPhase: string;
  selectedPhaseLabel: string;
  templateQuery: string;
  setTemplateQuery: (q: string) => void;
  filteredTemplates: RfpAgentTemplate[];
  phaseDefinitions: RfpResponsePhaseDefinition[];
  agentsByPhase: Record<string, number>;
  isLoading: boolean;
  isError: boolean;
  isPending: boolean;
  onProvision: (templateId: string) => void;
}

export function AgentsStarterGrid({
  selectedPhase,
  selectedPhaseLabel,
  templateQuery,
  setTemplateQuery,
  filteredTemplates,
  phaseDefinitions,
  agentsByPhase,
  isLoading,
  isError,
  isPending,
  onProvision,
}: AgentsStarterGridProps) {
  return (
    <section className="mb-8 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">Starter agents</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fg-secondary)]">
            {selectedPhase === ALL_PHASES
              ? 'Provision the core RFP response squad, then tune each prompt and provider.'
              : `${selectedPhaseLabel} agents ready to provision and tune.`}
          </p>
        </div>
        <div className="relative w-full lg:max-w-sm">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
          />
          <label className="sr-only" htmlFor="template-search">
            Search starter agents
          </label>
          <input
            id="template-search"
            value={templateQuery}
            onChange={(event) => setTemplateQuery(event.currentTarget.value)}
            placeholder="Search templates..."
            className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] pl-9 pr-3 text-sm text-[var(--fg-primary)] shadow-[var(--shadow-xs)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          />
        </div>
      </div>

      {/* sr-only live region — announces filtered template count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading && !isError
          ? `${filteredTemplates.length} template${filteredTemplates.length === 1 ? '' : 's'}${templateQuery ? ` matching "${templateQuery}"` : ''}${selectedPhase !== ALL_PHASES ? ` in ${selectedPhaseLabel}` : ''}`
          : ''}
      </p>

      {isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : isError ? (
        <EmptyState
          title="Template catalog is unavailable"
          message="Try again after the API recovers."
        />
      ) : filteredTemplates.length === 0 ? (
        <EmptyState title="No starter agents match" message="Adjust the phase or search query." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredTemplates.map((template) => {
            const phase = phaseDefinitions.find((item) => item.id === template.phase);
            const coveredCount = agentsByPhase[template.phase] ?? 0;
            const toolsCount = template.tools.length;

            return (
              <article
                key={template.id}
                className="group flex min-h-[220px] flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[var(--fg-primary)]">{template.name}</h3>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge tone={PHASE_TONE[template.phase] ?? 'gray'}>
                        {phase?.label ?? formatPhase(template.phase)}
                      </Badge>
                      <Badge
                        tone={template.defaultConfig.provider === 'claude' ? 'purple' : 'blue'}
                      >
                        {template.defaultConfig.provider === 'claude' ? 'Claude' : 'Dust'}
                      </Badge>
                    </div>
                  </div>
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--brand-primary)]">
                    <Icon name="sparkle" size={16} />
                  </span>
                </div>
                <p className="line-clamp-3 text-sm text-[var(--fg-secondary)]">
                  {template.description}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-[var(--surface-sunken)] p-2">
                    <div className="font-semibold text-[var(--fg-primary)]">{toolsCount}</div>
                    <div className="text-[var(--fg-tertiary)]">tools</div>
                  </div>
                  <div className="rounded-xl bg-[var(--surface-sunken)] p-2">
                    <div className="font-semibold text-[var(--fg-primary)]">{coveredCount}</div>
                    <div className="text-[var(--fg-tertiary)]">active</div>
                  </div>
                </div>
                <div className="mt-auto pt-4">
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={isPending}
                    onClick={() => onProvision(template.id)}
                  >
                    {coveredCount > 0 ? 'Add another' : 'Add phase agent'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
