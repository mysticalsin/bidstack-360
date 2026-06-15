/**
 * integrations/ConnectionRunway.tsx — 4-step "how to connect" workflow cards
 * displayed above the tab panel on the Integrations page.
 *
 * WHY a separate module: ConnectionRunway is a stateless layout-only component.
 * Extracting it removes ~75 lines from IntegrationsPage and makes the workflow
 * cards independently adjustable without touching the page orchestrator.
 */
import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';

const RUNWAY_STEPS: Array<{
  icon: IconName;
  titleKey: string;
  titleDefault: string;
  bodyKey: string;
  bodyDefault: string;
  tone: BadgeTone;
}> = [
  {
    icon: 'sliders',
    titleKey: 'connectionRunway.steps.pickSurface.title',
    titleDefault: 'Pick the surface',
    bodyKey: 'connectionRunway.steps.pickSurface.body',
    bodyDefault: 'Choose MCP for agents, REST for sync, webhooks for events, or connectors for ERP.',
    tone: 'blue',
  },
  {
    icon: 'shield',
    titleKey: 'connectionRunway.steps.scopeAccess.title',
    titleDefault: 'Scope access',
    bodyKey: 'connectionRunway.steps.scopeAccess.body',
    bodyDefault: 'Create read/write keys only for the exact workflow and keep secrets server-side.',
    tone: 'teal',
  },
  {
    icon: 'clock',
    titleKey: 'connectionRunway.steps.probeBeforeSave.title',
    titleDefault: 'Probe before save',
    bodyKey: 'connectionRunway.steps.probeBeforeSave.body',
    bodyDefault: 'Run a safe reachability check with SSRF protection and no bearer tokens sent.',
    tone: 'amber',
  },
  {
    icon: 'reports',
    titleKey: 'connectionRunway.steps.monitorEvidence.title',
    titleDefault: 'Monitor evidence',
    bodyKey: 'connectionRunway.steps.monitorEvidence.body',
    bodyDefault: 'Review provider health and webhook events without leaving the integration hub.',
    tone: 'jade',
  },
];

export function ConnectionRunway() {
  const { t } = useTranslation('integrations');

  return (
    <section
      className="grid gap-3 xl:grid-cols-4"
      aria-label={t('connectionRunway.sectionLabel', 'Integration setup workflow')}
    >
      {RUNWAY_STEPS.map((step, index) => (
        <Card
          key={step.titleKey}
          className="border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
              <Icon name={step.icon} className="size-4" />
            </span>
            <Badge tone={step.tone}>
              {t('connectionRunway.stepBadge', 'Step {{number}}', { number: index + 1 })}
            </Badge>
          </div>
          <h2 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
            {t(step.titleKey, step.titleDefault)}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
            {t(step.bodyKey, step.bodyDefault)}
          </p>
        </Card>
      ))}
    </section>
  );
}
