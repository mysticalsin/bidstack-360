import { useState } from 'react';
import type { AgentConfig, AgentProvider, RfpResponsePhase } from '@bidstack/shared';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
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
  const [approvalRequired, setApprovalRequired] = useState(agent?.config.approvalRequired ?? true);

  const [activeTab, setActiveTab] = useState<'basic' | 'integration' | 'prompt'>('basic');

  const isEdit = Boolean(agent);

  const tabs = [
    { id: 'basic', label: 'Basic Details', icon: 'settings' },
    { id: 'integration', label: 'Provider & Runs', icon: 'git-branch' },
    { id: 'prompt', label: 'Instructions', icon: 'sparkle' },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={isEdit ? 'Edit agent' : 'New agent'}>
        <div className="flex border-b border-[var(--border-subtle)] mb-4 overflow-x-auto scrollbar-none">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all shrink-0',
                activeTab === t.id
                  ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]'
                  : 'border-transparent text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
              )}
            >
              <Icon name={t.icon} size={13} />
              {t.label}
            </button>
          ))}
        </div>

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
                approvalRequired,
                phase: phase || undefined,
                model: claudeModel || undefined,
                dustAgentId: dustAgentId || undefined,
              },
            });
          }}
        >
          {activeTab === 'basic' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="space-y-1.5">
                <label
                  htmlFor="agent-name"
                  className="text-sm font-medium text-[var(--fg-primary)]"
                >
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
                <label
                  htmlFor="agent-desc"
                  className="text-sm font-medium text-[var(--fg-primary)]"
                >
                  Description
                </label>
                <input
                  id="agent-desc"
                  value={description}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setDescription(e.target.value)
                  }
                  placeholder="What does this agent do?"
                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="agent-phase"
                  className="text-sm font-medium text-[var(--fg-primary)]"
                >
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

              <div className="space-y-1.5">
                <label
                  htmlFor="agent-cron"
                  className="text-sm font-medium text-[var(--fg-primary)]"
                >
                  Schedule (cron)
                </label>
                <input
                  id="agent-cron"
                  value={scheduleCron}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setScheduleCron(e.target.value)
                  }
                  placeholder="e.g., 0 9 * * 1-5"
                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                />
                <p className="text-xs text-[var(--fg-tertiary)]">
                  Optional cron expression for recurring runs.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'integration' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                  AI Provider Type
                </span>
                <div className="sf-radio-group">
                  <button
                    type="button"
                    onClick={() => setProvider('claude')}
                    className={cn('sf-radio-card text-left', provider === 'claude' && 'selected')}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[var(--brand-primary)]">
                        <Icon name="sparkle" size={14} />
                      </span>
                      <span className="font-semibold text-xs text-[var(--fg-primary)]">
                        Claude API
                      </span>
                    </div>
                    <span className="text-[10px] leading-relaxed text-[var(--fg-tertiary)]">
                      Direct LLM orchestration utilizing Anthropic keys.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setProvider('dust')}
                    className={cn('sf-radio-card text-left', provider === 'dust' && 'selected')}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-blue-500">
                        <Icon name="book" size={14} />
                      </span>
                      <span className="font-semibold text-xs text-[var(--fg-primary)]">
                        Dust Agent
                      </span>
                    </div>
                    <span className="text-[10px] leading-relaxed text-[var(--fg-tertiary)]">
                      Run multi-data-source custom assistants built inside Dust.
                    </span>
                  </button>
                </div>
              </div>

              {provider === 'claude' ? (
                <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-150">
                  <label
                    htmlFor="agent-model"
                    className="text-sm font-medium text-[var(--fg-primary)]"
                  >
                    Claude model override
                  </label>
                  <input
                    id="agent-model"
                    value={claudeModel}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setClaudeModel(e.target.value)
                    }
                    placeholder="Uses ANTHROPIC_MODEL when blank"
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                  />
                </div>
              ) : (
                <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-150">
                  <label
                    htmlFor="agent-dust-id"
                    className="text-sm font-medium text-[var(--fg-primary)]"
                  >
                    Dust agent ID
                  </label>
                  <input
                    id="agent-dust-id"
                    value={dustAgentId}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setDustAgentId(e.target.value)
                    }
                    placeholder="Optional; required only when provider is Dust and no default is set"
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                  />
                </div>
              )}

              <div className="flex items-center justify-between p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] mt-4">
                <div className="pr-4">
                  <div className="text-sm font-semibold text-[var(--fg-primary)]">
                    Requires Manual Approval
                  </div>
                  <div className="text-xs text-[var(--fg-tertiary)] leading-relaxed mt-0.5">
                    Agent outputs will pause for review before posting to the opportunity pipeline.
                  </div>
                </div>
                <label className="sf-toggle-wrapper shrink-0">
                  <input
                    type="checkbox"
                    checked={approvalRequired}
                    onChange={(e) => setApprovalRequired(e.target.checked)}
                    className="sr-only"
                  />
                  <div className="sf-toggle-track">
                    <div className="sf-toggle-thumb" />
                  </div>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'prompt' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="space-y-1.5">
                <label
                  htmlFor="agent-prompt"
                  className="text-sm font-medium text-[var(--fg-primary)]"
                >
                  System prompt
                </label>
                <textarea
                  id="agent-prompt"
                  value={systemPrompt}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setSystemPrompt(e.target.value)
                  }
                  placeholder="Instructions for the agent..."
                  rows={6}
                  required
                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                />
              </div>

              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-[var(--fg-secondary)] flex gap-2.5">
                <span className="text-blue-500 shrink-0 mt-0.5">
                  <Icon name="info" size={14} />
                </span>
                <div>
                  <span className="font-semibold text-[var(--fg-primary)]">Instructions Guide</span>
                  <p className="mt-1 leading-relaxed">
                    Describe the agent&apos;s role, format requirements, and constraints. Tell the
                    agent to output clean markdown format, reference specific sections, and
                    highlight missing RFP criteria explicitly.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-4 border-t border-[var(--border-subtle)] mt-6">
            <div>
              <Button type="button" variant="ghost" onClick={onClose} size="sm">
                Cancel
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {activeTab !== 'basic' && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (activeTab === 'prompt') setActiveTab('integration');
                    else if (activeTab === 'integration') setActiveTab('basic');
                  }}
                >
                  Back
                </Button>
              )}
              {activeTab !== 'prompt' ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    if (activeTab === 'basic') setActiveTab('integration');
                    else if (activeTab === 'integration') setActiveTab('prompt');
                  }}
                >
                  Next
                </Button>
              ) : (
                <Button type="submit" variant="primary" size="sm" disabled={isPending}>
                  {isEdit ? 'Save changes' : 'Create agent'}
                </Button>
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
