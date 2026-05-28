/**
 * integrations/DustAgentsCard.tsx — Dust workspace agents list for the
 * Integrations agents tab.
 *
 * WHY a separate module: DustAgentsCard is ~53 lines of self-contained
 * loading/error/empty/populated state logic. Extracting it keeps the agents
 * tab clean and makes the card independently reusable.
 */
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';

import type { DustStatus } from './types';

export function DustAgentsCard({ data, isLoading }: { data?: DustStatus; isLoading: boolean }) {
  return (
    <Card>
      <SectionHeader
        title="Dust agents"
        caption="Workspace agents available for CRM data verification workflows"
        action={
          data?.agentsError ? (
            <Badge tone="tomato">degraded</Badge>
          ) : data?.configured ? (
            <Badge tone="jade">configured</Badge>
          ) : (
            <Badge tone="amber">disabled</Badge>
          )
        }
      />
      {isLoading ? (
        <div className="p-5">
          <LoadingSkeleton rows={3} />
        </div>
      ) : !data?.configured ? (
        <div className="px-5 py-6 text-sm text-[var(--fg-secondary)]">
          Add Dust credentials to list available workspace agents.
        </div>
      ) : data.agentsError ? (
        <div className="mx-5 my-5 rounded-md bg-[var(--danger-tint)] px-3 py-2 text-xs text-[var(--danger)]">
          {data.agentsError}
        </div>
      ) : data.agents.length === 0 ? (
        <div className="px-5 py-6 text-sm text-[var(--fg-secondary)]">
          Dust is configured, but no accessible agents were returned for this workspace.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {data.agents.map((agent) => (
            <li key={agent.id} className="flex items-start justify-between gap-4 px-5 py-3">
              <div>
                <div className="text-sm font-semibold text-[var(--fg-primary)]">{agent.label}</div>
                <code className="mt-1 block font-mono text-xs text-[var(--brand-primary)]">
                  {agent.id}
                </code>
                {agent.description ? (
                  <p className="mt-1 text-xs text-[var(--fg-secondary)]">{agent.description}</p>
                ) : null}
              </div>
              <Badge tone="purple">agent</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
