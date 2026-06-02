import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useApiKeys } from '@/hooks/useApiKeys';
import { useCustomFieldDefinitions } from '@/hooks/useCustomFields';
import { useEmailTemplates } from '@/hooks/useEmailTemplates';
import { useLeadRotConfig } from '@/hooks/useLeadRot';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useRoles } from '@/hooks/useRoles';
import { useTags } from '@/hooks/useTags';
import { useUsers } from '@/hooks/useUsers';
import { useWebhookSubscriptions } from '@/hooks/useWebhookSubscriptions';
import { useIsAdmin } from '@/lib/auth';
import type { SettingsSection } from './SettingsLayout';

interface Props {
  onNavigate: (section: SettingsSection) => void;
}

type TileTone = 'jade' | 'blue' | 'purple' | 'teal' | 'tomato';

interface OverviewTileModel {
  title: string;
  detail: string;
  tone: TileTone;
  icon: IconName;
  section: SettingsSection;
  adminOnly: boolean;
}

export function SettingsOverviewSection({ onNavigate }: Props) {
  const isAdmin = useIsAdmin();
  const users = useUsers();
  const roles = useRoles();
  const tags = useTags();
  const templates = useEmailTemplates();
  const customFields = useCustomFieldDefinitions('company');
  const leadRot = useLeadRotConfig();
  const pipelineStages = usePipelineStages();
  const apiKeys = useApiKeys();
  const webhooks = useWebhookSubscriptions({ enabled: isAdmin });

  const tiles: OverviewTileModel[] = [
    {
      title: 'Workspace governance',
      detail: `${formatCount(users.data?.length)} users / ${formatCount(roles.data?.length)} roles`,
      tone: users.isError || roles.isError ? 'tomato' : 'jade',
      icon: 'building' as const,
      section: 'workspace' as const,
      adminOnly: false,
    },
    {
      title: 'CRM data model',
      detail: `${formatCount(pipelineStages.data?.items.length)} stages / ${formatCount(customFields.data?.items.length)} company fields`,
      tone: pipelineStages.isError || customFields.isError ? 'tomato' : 'blue',
      icon: 'sliders' as const,
      section: 'crm' as const,
      adminOnly: true,
    },
    {
      title: 'Automation library',
      detail: `${formatCount(tags.data?.items.length)} tags / ${formatCount(templates.data?.items.length)} templates / ${formatCount(leadRot.data?.items.length)} rot rules`,
      tone: tags.isError || templates.isError || leadRot.isError ? 'tomato' : 'purple',
      icon: 'sparkle' as const,
      section: 'crm' as const,
      adminOnly: true,
    },
    {
      title: 'Developer access',
      detail: `${formatCount(apiKeys.data?.items.length)} API keys`,
      tone: apiKeys.isError ? 'tomato' : 'teal',
      icon: 'zap' as const,
      section: 'developer' as const,
      adminOnly: true,
    },
    {
      title: 'Webhook delivery',
      detail: `${formatCount((webhooks.data ?? []).filter((w) => w.active).length)} active / ${formatCount((webhooks.data ?? []).filter((w) => w.failureCount > 0).length)} failing`,
      tone: webhooks.isError ? 'tomato' : 'purple',
      icon: 'webhook' as const,
      section: 'webhooks' as const,
      adminOnly: true,
    },
  ];

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="grid gap-4 p-5 lg:grid-cols-[1fr,280px]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-primary-tint)] px-3 py-1 text-xs font-medium text-[var(--brand-primary)]">
              <Icon name="checkCircle" size={14} ariaHidden />
              Enterprise settings command center
            </div>
            <h3 className="mt-4 text-xl font-semibold tracking-tight text-[var(--fg-primary)]">
              Configure the CRM once. Make every team move the same way.
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--fg-secondary)]">
              Settings now surfaces the working controls that affect BidStack across the app:
              workspace membership, roles, currencies, pipeline stages, lead recovery rules, tags,
              email templates, custom fields, API keys, and webhooks.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              Readiness
            </div>
            <div className="mt-3 space-y-2 text-sm text-[var(--fg-secondary)]">
              <ReadinessRow label="Personal preferences" complete />
              <ReadinessRow label="Workspace controls" complete={isAdmin} />
              <ReadinessRow label="CRM configuration" complete={isAdmin} />
              <ReadinessRow label="API and MCP access" complete={isAdmin} />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {tiles
          .filter((tile) => !tile.adminOnly || isAdmin)
          .map((tile) => (
            <OverviewTile
              key={tile.title}
              title={tile.title}
              detail={tile.detail}
              icon={tile.icon}
              tone={tile.tone}
              onOpen={() => onNavigate(tile.section)}
            />
          ))}
      </div>

      {!isAdmin ? (
        <Card>
          <div className="p-5 text-sm text-[var(--fg-secondary)]">
            You can manage your personal settings here. Workspace, CRM, and developer controls are
            limited to administrators.
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function ReadinessRow({ label, complete }: { label: string; complete: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <Badge tone={complete ? 'jade' : 'amber'}>{complete ? 'Ready' : 'Admin only'}</Badge>
    </div>
  );
}

function OverviewTile({
  title,
  detail,
  icon,
  tone,
  onOpen,
}: {
  title: string;
  detail: string;
  icon: IconName;
  tone: TileTone;
  onOpen: () => void;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-sunken)] text-[var(--brand-primary)]">
          <Icon name={icon} size={18} ariaHidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
            <Badge tone={tone}>{tone === 'tomato' ? 'Needs attention' : 'Live'}</Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">{detail}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onOpen}>
          Open
        </Button>
      </div>
    </Card>
  );
}

function formatCount(value: number | undefined): string {
  return value === undefined ? '...' : String(value);
}
