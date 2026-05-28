/**
 * integrations/ConnectionRunway.tsx — 4-step "how to connect" workflow cards
 * displayed above the tab panel on the Integrations page.
 *
 * WHY a separate module: ConnectionRunway is a stateless layout-only component.
 * Extracting it removes ~75 lines from IntegrationsPage and makes the workflow
 * cards independently adjustable without touching the page orchestrator.
 */
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';

const RUNWAY_STEPS: Array<{
  icon: IconName;
  title: string;
  body: string;
  tone: BadgeTone;
}> = [
  {
    icon: 'sliders',
    title: 'Pick the surface',
    body: 'Choose MCP for agents, REST for sync, webhooks for events, or connectors for ERP.',
    tone: 'blue',
  },
  {
    icon: 'shield',
    title: 'Scope access',
    body: 'Create read/write keys only for the exact workflow and keep secrets server-side.',
    tone: 'teal',
  },
  {
    icon: 'clock',
    title: 'Probe before save',
    body: 'Run a safe reachability check with SSRF protection and no bearer tokens sent.',
    tone: 'amber',
  },
  {
    icon: 'reports',
    title: 'Monitor evidence',
    body: 'Review provider health and webhook events without leaving the integration hub.',
    tone: 'jade',
  },
];

export function ConnectionRunway() {
  return (
    <section className="grid gap-3 xl:grid-cols-4" aria-label="Integration setup workflow">
      {RUNWAY_STEPS.map((step, index) => (
        <Card
          key={step.title}
          className="border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
              <Icon name={step.icon} className="size-4" />
            </span>
            <Badge tone={step.tone}>Step {index + 1}</Badge>
          </div>
          <h2 className="mt-4 text-base font-semibold text-[var(--text-primary)]">{step.title}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{step.body}</p>
        </Card>
      ))}
    </section>
  );
}
