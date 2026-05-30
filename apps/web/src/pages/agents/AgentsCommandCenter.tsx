/**
 * AgentsCommandCenter — "RFP command center" section.
 * Renders metric summary cards + phase-filter pill strip + phase-gate panel.
 */
import type { RfpResponsePhaseDefinition } from '@bidstack/shared';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

import { ALL_PHASES, PHASE_TONE, type CommandMetric } from './agentsConfig';

interface AgentsCommandCenterProps {
  selectedPhase: string;
  setSelectedPhase: (phase: string) => void;
  selectedPhaseDefinition: RfpResponsePhaseDefinition | undefined;
  selectedPhaseLabel: string;
  phaseDefinitions: RfpResponsePhaseDefinition[];
  phaseCoverage: Set<string>;
  agentsByPhase: Record<string, number>;
  templatesByPhase: Record<string, number>;
  totalAgentCount: number;
  commandMetrics: CommandMetric[];
}

export function AgentsCommandCenter({
  selectedPhase,
  setSelectedPhase,
  selectedPhaseDefinition,
  selectedPhaseLabel,
  phaseDefinitions,
  phaseCoverage,
  agentsByPhase,
  templatesByPhase,
  totalAgentCount,
  commandMetrics,
}: AgentsCommandCenterProps) {
  return (
    <section
      className="mb-8 overflow-hidden rounded-[24px] border border-[var(--border-subtle)] p-4 shadow-[var(--shadow-md)] sm:p-5"
      style={{
        background:
          'radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--brand-primary) 13%, transparent), transparent 32%), linear-gradient(135deg, var(--surface-card), var(--surface-page))',
      }}
    >
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        {/* ── Metrics + phase filter ─────────────────────────────────── */}
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-card)_84%,transparent)] p-4 shadow-[var(--shadow-xs)] sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--fg-primary)]">RFP command center</h2>
              <p className="mt-1 max-w-2xl text-sm text-[var(--fg-secondary)]">
                {selectedPhaseDefinition?.purpose ??
                  'Coverage, readiness, risk ownership, and agent run control in one workspace.'}
              </p>
            </div>
            <Badge
              tone={selectedPhase === ALL_PHASES ? 'gray' : (PHASE_TONE[selectedPhase] ?? 'gray')}
            >
              {selectedPhaseLabel}
            </Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {commandMetrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 shadow-[var(--shadow-xs)]"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-tertiary)]">
                    {metric.label}
                  </span>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--brand-primary)]">
                    <Icon name={metric.icon} size={15} />
                  </span>
                </div>
                <div className="text-2xl font-semibold tabular-nums text-[var(--fg-primary)]">
                  {metric.value}
                </div>
                <div className="mt-1 text-xs text-[var(--fg-secondary)]">{metric.detail}</div>
              </div>
            ))}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--fg-tertiary)]">
                Response phases
              </div>
              <div className="text-xs text-[var(--fg-tertiary)]">{phaseCoverage.size} covered</div>
            </div>
            <div
              role="group"
              aria-label="Filter agents and templates by RFP phase"
              className="sf-path"
            >
              <button
                type="button"
                aria-pressed={selectedPhase === ALL_PHASES}
                onClick={() => setSelectedPhase(ALL_PHASES)}
                className={cn('sf-path-step', selectedPhase === ALL_PHASES && 'active')}
              >
                <span>All</span>
                <span className="rounded-full bg-[rgba(0,0,0,0.08)] px-1.5 py-0.5 text-[10px]">
                  {totalAgentCount}
                </span>
              </button>
              {phaseDefinitions.map((phase) => {
                const agentCount = agentsByPhase[phase.id] ?? 0;
                const templateCount = templatesByPhase[phase.id] ?? 0;
                const isActive = selectedPhase === phase.id;
                const hasCoverage = phaseCoverage.has(phase.id);

                return (
                  <button
                    key={phase.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setSelectedPhase(phase.id)}
                    className={cn('sf-path-step', hasCoverage && 'covered', isActive && 'active')}
                  >
                    {hasCoverage ? (
                      <Icon name="checkCircle" size={12} ariaHidden />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                    )}
                    <span>{phase.label}</span>
                    <span className="rounded-full bg-[rgba(0,0,0,0.08)] px-1.5 py-0.5 text-[10px]">
                      {agentCount}/{templateCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Phase gate panel ──────────────────────────────────────────── */}
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-xs)] sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Phase gate</h2>
              <p className="mt-1 text-xs text-[var(--fg-secondary)]">
                {selectedPhaseDefinition?.gate ?? 'Select a phase to inspect its approval gate.'}
              </p>
            </div>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]">
              <Icon name="shield" size={18} />
            </span>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl bg-[var(--surface-sunken)] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-secondary)]">
                Decision
              </div>
              <p className="mt-1 text-sm text-[var(--fg-primary)]">
                {selectedPhaseDefinition?.userDecision ??
                  'Coordinate bid/no-bid, risk, strategy, evidence, and submission decisions.'}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--surface-sunken)] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--fg-secondary)]">
                Red-flag checks
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(
                  selectedPhaseDefinition?.redFlagChecks ?? [
                    'Missing owner',
                    'No source citation',
                    'Approval gap',
                  ]
                ).map((check) => (
                  <Badge key={check} tone="tomato">
                    {check}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
