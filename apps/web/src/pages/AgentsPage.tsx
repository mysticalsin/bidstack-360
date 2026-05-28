/**
 * AgentsPage — RFP agent squad orchestration hub.
 * Owns global state (phase, dialogs, mutations) and delegates rendering
 * to three focused sub-components under ./agents/.
 */
import { useMemo, useState } from 'react';

import { AgentDialog } from '@/components/agents/AgentDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import {
  useAgents,
  useCreateAgent,
  useDeleteAgent,
  useProvisionRfpAgentTemplate,
  useRfpAgentTemplates,
  useUpdateAgent,
  type Agent,
} from '@/hooks/useAgents';

import { AgentsCommandCenter } from './agents/AgentsCommandCenter';
import { AgentsSquadTable } from './agents/AgentsSquadTable';
import { AgentsStarterGrid } from './agents/AgentsStarterGrid';
import { ALL_PHASES, countByPhase, formatPhase } from './agents/agentsConfig';

export function AgentsPage() {
  const agents = useAgents();
  const templates = useRfpAgentTemplates();
  const createAgent = useCreateAgent();
  const provisionTemplate = useProvisionRfpAgentTemplate();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [templateQuery, setTemplateQuery] = useState('');
  const [selectedPhase, setSelectedPhase] = useState<string>(ALL_PHASES);

  const allAgents = useMemo(() => agents.data?.items ?? [], [agents.data?.items]);
  const phaseDefinitions = templates.data?.phases ?? [];
  const templateCatalog = useMemo(
    () => templates.data?.templates ?? [],
    [templates.data?.templates],
  );

  const phaseCoverage = useMemo(() => {
    const coverage = new Set<string>();
    for (const agent of allAgents) {
      if (agent.config.phase) coverage.add(agent.config.phase);
    }
    return coverage;
  }, [allAgents]);

  const agentsByPhase = useMemo(
    () => countByPhase(allAgents.map((agent) => ({ phase: agent.config.phase }))),
    [allAgents],
  );

  const templatesByPhase = useMemo(
    () => countByPhase(templateCatalog.map((template) => ({ phase: template.phase }))),
    [templateCatalog],
  );

  const selectedPhaseDefinition = phaseDefinitions.find((phase) => phase.id === selectedPhase);
  const selectedPhaseLabel =
    selectedPhase === ALL_PHASES
      ? 'All phases'
      : (selectedPhaseDefinition?.label ?? formatPhase(selectedPhase));

  const totalPhaseCount = phaseDefinitions.length || 13;
  const claudeAgentCount = allAgents.filter((agent) => agent.config.provider === 'claude').length;
  const runningAgentCount = allAgents.filter((agent) => agent.status === 'running').length;
  const scheduledAgentCount = allAgents.filter((agent) => Boolean(agent.scheduleCron)).length;

  const filteredTemplates = useMemo(() => {
    const query = templateQuery.trim().toLowerCase();
    return templateCatalog.filter((template) => {
      const matchesPhase = selectedPhase === ALL_PHASES || template.phase === selectedPhase;
      if (!matchesPhase) return false;
      if (!query) return true;
      return [
        template.name,
        template.description,
        template.phase,
        template.defaultConfig.provider,
        template.defaultConfig.outputContract,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [selectedPhase, templateCatalog, templateQuery]);

  const commandMetrics = [
    {
      label: 'Phase coverage',
      value: `${phaseCoverage.size}/${totalPhaseCount}`,
      detail: 'covered gates',
      icon: 'git-branch' as const,
      tone: 'blue' as const,
    },
    {
      label: 'Claude squad',
      value: String(claudeAgentCount),
      detail: `${scheduledAgentCount} scheduled`,
      icon: 'sparkle' as const,
      tone: 'purple' as const,
    },
    {
      label: 'Live work',
      value: String(runningAgentCount),
      detail: 'active runs',
      icon: 'clock' as const,
      tone: runningAgentCount > 0 ? ('amber' as const) : ('jade' as const),
    },
    {
      label: 'Templates',
      value: String(templateCatalog.length),
      detail: `${filteredTemplates.length} visible`,
      icon: 'book' as const,
      tone: 'teal' as const,
    },
  ];

  const handleCreate = async (body: Parameters<typeof createAgent.mutateAsync>[0]) => {
    await createAgent.mutateAsync(body);
    setDialogOpen(false);
  };

  const handleUpdate = async (body: Parameters<typeof updateAgent.mutateAsync>[0]) => {
    await updateAgent.mutateAsync(body);
    setDialogOpen(false);
    setEditingAgent(null);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="blue">BidStack 360</Badge>
            <Badge tone="purple">RFP agent squad</Badge>
          </div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)]">Agents</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fg-secondary)]">
            Phase agents for intake, red flags, compliance, legal, security, drafting, and
            submission.
          </p>
        </div>
        <LiquidGlassButton
          onClick={() => {
            setEditingAgent(null);
            setDialogOpen(true);
          }}
        >
          <Icon name="plus" size={14} className="mr-1.5" />
          New agent
        </LiquidGlassButton>
      </header>

      <AgentsCommandCenter
        selectedPhase={selectedPhase}
        setSelectedPhase={setSelectedPhase}
        selectedPhaseDefinition={selectedPhaseDefinition}
        selectedPhaseLabel={selectedPhaseLabel}
        phaseDefinitions={phaseDefinitions}
        phaseCoverage={phaseCoverage}
        agentsByPhase={agentsByPhase}
        templatesByPhase={templatesByPhase}
        totalAgentCount={allAgents.length}
        commandMetrics={commandMetrics}
      />

      <AgentsStarterGrid
        selectedPhase={selectedPhase}
        selectedPhaseLabel={selectedPhaseLabel}
        templateQuery={templateQuery}
        setTemplateQuery={setTemplateQuery}
        filteredTemplates={filteredTemplates}
        phaseDefinitions={phaseDefinitions}
        agentsByPhase={agentsByPhase}
        isLoading={templates.isLoading}
        isError={templates.isError}
        isPending={provisionTemplate.isPending}
        onProvision={(templateId) => provisionTemplate.mutate({ templateId, provider: 'claude' })}
      />

      <AgentsSquadTable
        isLoading={agents.isLoading}
        isError={agents.isError}
        allAgents={allAgents}
        selectedPhase={selectedPhase}
        selectedPhaseLabel={selectedPhaseLabel}
        onEdit={(agent) => {
          setEditingAgent(agent);
          setDialogOpen(true);
        }}
        onDelete={(agent) => setDeletingAgent(agent)}
      />

      <AgentDialog
        key={dialogOpen ? (editingAgent?.id ?? 'new-agent') : 'closed-agent'}
        agent={editingAgent}
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingAgent(null);
        }}
        onSubmit={(body) => {
          if (editingAgent) {
            void handleUpdate({ id: editingAgent.id, ...body });
          } else {
            void handleCreate(body);
          }
        }}
        isPending={createAgent.isPending || updateAgent.isPending}
      />

      <Dialog
        open={Boolean(deletingAgent)}
        onOpenChange={(open) => !open && setDeletingAgent(null)}
      >
        <DialogContent
          title="Delete agent"
          description={
            deletingAgent
              ? `This removes ${deletingAgent.name} from the RFP agent squad.`
              : undefined
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--fg-secondary)]">
              Historical runs stay in the audit trail, but this agent will no longer be available
              for future RFP work.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeletingAgent(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteAgent.isPending || !deletingAgent}
                onClick={() => {
                  if (!deletingAgent) return;
                  deleteAgent.mutate(deletingAgent.id, {
                    onSuccess: () => setDeletingAgent(null),
                  });
                }}
              >
                Delete agent
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
