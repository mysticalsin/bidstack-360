import { useState } from 'react';
import type { AgentConfig, AgentProvider, RfpResponsePhase } from '@bidstack/shared';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import type { Agent } from '@/hooks/useAgents';

interface AgentDialogProps {
  agent?: Agent | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (body: {
    name: string;
    description: string | null;
    systemPrompt: string;
    scheduleCron: string | null;
    config: AgentConfig;
  }) => void;
  isPending?: boolean;
}

const PHASE_OPTIONS: { value: RfpResponsePhase; label: string }[] = [
  { value: 'opportunity_qualification', label: 'Opportunity qualification' },
  { value: 'document_intake', label: 'Document intake' },
  { value: 'solicitation_deep_read', label: 'Solicitation deep read' },
  { value: 'compliance_matrix', label: 'Compliance matrix' },
  { value: 'red_flags', label: 'Red flags' },
  { value: 'solution_strategy', label: 'Solution strategy' },
  { value: 'pricing_commercial', label: 'Pricing and commercial' },
  { value: 'legal_review', label: 'Legal review' },
  { value: 'security_privacy', label: 'Security and privacy' },
  { value: 'draft_response', label: 'Draft response' },
  { value: 'color_team_review', label: 'Color-team review' },
  { value: 'submission_readiness', label: 'Submission readiness' },
  { value: 'post_submission', label: 'Post-submission' },
];

export function AgentDialog({ agent, open, onClose, onSubmit, isPending }: AgentDialogProps) {
  const [name, setName] = useState(agent?.name ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '');
  const [scheduleCron, setScheduleCron] = useState(agent?.scheduleCron ?? '');
  const [provider, setProvider] = useState<AgentProvider>(agent?.config.provider ?? 'claude');
  const [phase, setPhase] = useState<RfpResponsePhase | ''>(agent?.config.phase ?? '');
  const [claudeModel, setClaudeModel] = useState(agent?.config.model ?? '');
  const [dustAgentId, setDustAgentId] = useState(agent?.config.dustAgentId ?? '');

  const isEdit = Boolean(agent);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={isEdit ? 'Edit agent' : 'New agent'}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              name,
              description: description || null,
              systemPrompt,
              scheduleCron: scheduleCron || null,
              config: {
                ...(agent?.config ?? {}),
                provider,
                allowedInputScopes: agent?.config.allowedInputScopes ?? [],
                approvalRequired: agent?.config.approvalRequired ?? true,
                phase: phase || undefined,
                model: claudeModel || undefined,
                dustAgentId: dustAgentId || undefined,
              },
            });
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="agent-name" className="text-sm font-medium text-[var(--fg-primary)]">
              Name
            </label>
            <input
              id="agent-name"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder="e.g., Proposal Writer"
              required
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agent-desc" className="text-sm font-medium text-[var(--fg-primary)]">
              Description
            </label>
            <input
              id="agent-desc"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
              placeholder="What does this agent do?"
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agent-phase" className="text-sm font-medium text-[var(--fg-primary)]">
              RFP phase
            </label>
            <select
              id="agent-phase"
              value={phase}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setPhase(e.currentTarget.value as RfpResponsePhase | '')
              }
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            >
              <option value="">General agent</option>
              {PHASE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="agent-provider" className="text-sm font-medium text-[var(--fg-primary)]">
                Provider
              </label>
              <select
                id="agent-provider"
                value={provider}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setProvider(e.currentTarget.value as AgentProvider)
                }
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              >
                <option value="claude">Claude API key</option>
                <option value="dust">Dust agent</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="agent-model" className="text-sm font-medium text-[var(--fg-primary)]">
                Claude model override
              </label>
              <input
                id="agent-model"
                value={claudeModel}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClaudeModel(e.target.value)}
                placeholder="Uses ANTHROPIC_MODEL when blank"
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agent-dust-id" className="text-sm font-medium text-[var(--fg-primary)]">
              Dust agent ID
            </label>
            <input
              id="agent-dust-id"
              value={dustAgentId}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDustAgentId(e.target.value)}
              placeholder="Optional; required only when provider is Dust and no default is set"
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agent-prompt" className="text-sm font-medium text-[var(--fg-primary)]">
              System prompt
            </label>
            <textarea
              id="agent-prompt"
              value={systemPrompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSystemPrompt(e.target.value)}
              placeholder="Instructions for the agent..."
              rows={6}
              required
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agent-cron" className="text-sm font-medium text-[var(--fg-primary)]">
              Schedule (cron)
            </label>
            <input
              id="agent-cron"
              value={scheduleCron}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduleCron(e.target.value)}
              placeholder="e.g., 0 9 * * 1-5"
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            />
            <p className="text-xs text-[var(--fg-tertiary)]">
              Optional cron expression for recurring runs.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? 'Save changes' : 'Create agent'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
