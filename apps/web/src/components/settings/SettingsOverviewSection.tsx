import { useTranslation } from 'react-i18next';
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
import { useUsersPage } from '@/hooks/useUsers';
import { useWebhookSubscriptions } from '@/hooks/useWebhookSubscriptions';
import { useIsAdmin } from '@/lib/auth';
import type { SettingsSection } from './SettingsLayout';
import { apiKeyListCaption } from './api-key-list-caption';
import { customFieldListCaption } from './custom-field-list-caption';
import { emailTemplateListCaption } from './email-template-list-caption';
import { roleListCaption } from './role-list-caption';
import { stageListCaption } from './stage-list-caption';
import { tagLibraryCaption } from './tag-library-caption';
import { USER_OVERVIEW_PAGE, userOverviewCaption } from './user-overview-caption';
import { webhookListCaption } from './webhook-list-caption';

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
  /** Set when this security read has not settled. Live is a settled book. */
  read?: 'checking' | 'failed';
}

export function SettingsOverviewSection({ onNavigate }: Props) {
  const { t } = useTranslation('settings');
  const isAdmin = useIsAdmin();
  const users = useUsersPage({ limit: USER_OVERVIEW_PAGE, enabled: isAdmin });
  const roles = useRoles({ enabled: isAdmin });
  const tags = useTags(undefined, { enabled: isAdmin });
  const templates = useEmailTemplates({ enabled: isAdmin });
  const customFields = useCustomFieldDefinitions('company', { enabled: isAdmin });
  const leadRot = useLeadRotConfig({ enabled: isAdmin });
  const pipelineStages = usePipelineStages({ enabled: isAdmin });
  const apiKeys = useApiKeys({ enabled: isAdmin });
  const webhooks = useWebhookSubscriptions({ enabled: isAdmin });
  const webhookItems = webhooks.data?.items ?? [];
  const webhookActive = webhookItems.filter((webhook) => webhook.active).length;
  const webhookFailing = webhookItems.filter((webhook) => webhook.failureCount > 0).length;
  // Users, roles, and API keys are the security book on this page. A pending
  // or failed read is not a live workspace and not ready API access.
  const governancePhase = combinePhase(securityPhase(users), securityPhase(roles));
  const apiKeyPhase = securityPhase(apiKeys);

  const tiles: OverviewTileModel[] = [
    {
      title: isAdmin
        ? t('settingsOverview.tileWorkspaceTitle', 'Workspace governance')
        : t('settingsOverview.tilePersonalTitle', 'Personal settings'),
      detail: !isAdmin
        ? t(
            'settingsOverview.tilePersonalDetail',
            'Profile, security, notifications, appearance, and language',
          )
        : governancePhase === 'pending'
          ? t(
              'settingsOverview.governanceChecking',
              'Checking workspace governance. It has not arrived.',
            )
          : governancePhase === 'error'
            ? t(
                'settingsOverview.governanceFailed',
                'Could not load workspace governance. It has not arrived.',
              )
            : users.data?.nextCursor && roles.data?.pageContinues
              ? t('settingsOverview.tileWorkspaceDetailPartialUsersAndRoles', '{{users}} / {{roles}}', {
                  users: userOverviewCaption(users.data.items.length, true),
                  roles: roleListCaption(roles.data.items.length, true),
                })
              : users.data?.nextCursor
                ? t('settingsOverview.tileWorkspaceDetailPartialUsers', '{{users}} / {{roles}} roles', {
                    users: userOverviewCaption(arrivedCount(users.data), true),
                    roles: formatCount(arrivedCount(roles.data)),
                  })
                : roles.data?.pageContinues
                  ? t(
                      'settingsOverview.tileWorkspaceDetailPartialRoles',
                      '{{users}} users / {{roles}}',
                      {
                        users: formatCount(arrivedCount(users.data)),
                        roles: roleListCaption(roles.data.items.length, true),
                      },
                    )
                  : t('settingsOverview.tileWorkspaceDetail', '{{users}} users / {{roles}} roles', {
                      users: formatCount(arrivedCount(users.data)),
                      roles: formatCount(arrivedCount(roles.data)),
                    }),
      tone: isAdmin && (users.isError || roles.isError) ? 'tomato' : 'jade',
      read: isAdmin ? unreadBadge(governancePhase) : undefined,
      icon: isAdmin ? ('building' as const) : ('shield' as const),
      section: isAdmin ? ('workspace' as const) : ('security' as const),
      adminOnly: false,
    },
    {
      title: t('settingsOverview.tileSerumTitle', 'SERUM Control Plane'),
      detail: t(
        'settingsOverview.tileSerumDetail',
        'Agent, model, document, approval, and policy readiness',
      ),
      tone: 'blue',
      icon: 'sparkle' as const,
      section: 'serum' as const,
      adminOnly: true,
    },
    {
      title: t('settingsOverview.tileDataModelTitle', 'Data model'),
      detail:
        pipelineStages.data?.pageContinues && customFields.data?.pageContinues
          ? t(
              'settingsOverview.tileDataModelDetailPartialStagesAndFields',
              '{{stages}} / {{fields}}',
              {
                stages: stageListCaption(pipelineStages.data.items.length, true),
                fields: customFieldListCaption(customFields.data.items.length, true),
              },
            )
          : pipelineStages.data?.pageContinues
            ? t(
                'settingsOverview.tileDataModelDetailPartialStages',
                '{{stages}} / {{fields}} company fields',
                {
                  stages: stageListCaption(pipelineStages.data.items.length, true),
                  fields: formatCount(customFields.data?.items.length),
                },
              )
            : customFields.data?.pageContinues
              ? t(
                  'settingsOverview.tileDataModelDetailPartialFields',
                  '{{stages}} stages / {{fields}}',
                  {
                    stages: formatCount(pipelineStages.data?.items.length),
                    fields: customFieldListCaption(customFields.data.items.length, true),
                  },
                )
              : t(
                  'settingsOverview.tileDataModelDetail',
                  '{{stages}} stages / {{fields}} company fields',
                  {
                    stages: formatCount(pipelineStages.data?.items.length),
                    fields: formatCount(customFields.data?.items.length),
                  },
                ),
      tone: pipelineStages.isError || customFields.isError ? 'tomato' : 'blue',
      icon: 'sliders' as const,
      section: 'crm' as const,
      adminOnly: true,
    },
    {
      title: t('settingsOverview.tileAutomationTitle', 'Automation library'),
      detail:
        tags.data?.pageContinues && templates.data?.pageContinues
          ? t(
              'settingsOverview.tileAutomationDetailPartialTagsAndTemplates',
              '{{tags}} / {{templates}} / {{rules}} rot rules',
              {
                tags: tagLibraryCaption(tags.data.items.length, true),
                templates: emailTemplateListCaption(templates.data.items.length, true),
                rules: formatCount(leadRot.data?.items.length),
              },
            )
          : tags.data?.pageContinues
            ? t(
                'settingsOverview.tileAutomationDetailPartialTags',
                '{{tags}} / {{templates}} templates / {{rules}} rot rules',
                {
                  tags: tagLibraryCaption(tags.data.items.length, true),
                  templates: formatCount(templates.data?.items.length),
                  rules: formatCount(leadRot.data?.items.length),
                },
              )
            : templates.data?.pageContinues
              ? t(
                  'settingsOverview.tileAutomationDetailPartialTemplates',
                  '{{tags}} tags / {{templates}} / {{rules}} rot rules',
                  {
                    tags: formatCount(tags.data?.items.length),
                    templates: emailTemplateListCaption(templates.data.items.length, true),
                    rules: formatCount(leadRot.data?.items.length),
                  },
                )
              : t(
                  'settingsOverview.tileAutomationDetail',
                  '{{tags}} tags / {{templates}} templates / {{rules}} rot rules',
                  {
                    tags: formatCount(tags.data?.items.length),
                    templates: formatCount(templates.data?.items.length),
                    rules: formatCount(leadRot.data?.items.length),
                  },
                ),
      tone: tags.isError || templates.isError || leadRot.isError ? 'tomato' : 'purple',
      icon: 'sparkle' as const,
      section: 'crm' as const,
      adminOnly: true,
    },
    {
      title: t('settingsOverview.tileDeveloperTitle', 'Developer access'),
      detail:
        apiKeyPhase === 'pending'
          ? t('settingsOverview.apiKeysChecking', 'Checking API keys. They have not arrived.')
          : apiKeyPhase === 'error'
            ? t('settingsOverview.apiKeysFailed', 'Could not load API keys. They have not arrived.')
            : apiKeys.data?.pageContinues
              ? t('settingsOverview.tileDeveloperDetailPartial', '{{drawn}}', {
                  drawn: apiKeyListCaption(apiKeys.data.items.length, true),
                })
              : t('settingsOverview.tileDeveloperDetail', '{{value}} API keys', {
                  value: formatCount(arrivedCount(apiKeys.data)),
                }),
      tone: apiKeys.isError ? 'tomato' : 'teal',
      read: unreadBadge(apiKeyPhase),
      icon: 'zap' as const,
      section: 'developer' as const,
      adminOnly: true,
    },
    {
      title: t('settingsOverview.tileWebhookTitle', 'Webhook delivery'),
      detail:
        webhooks.data && webhooks.data.pageContinues
          ? t(
              'settingsOverview.tileWebhookDetailPartial',
              '{{active}} active / {{failing}} failing. {{drawn}}',
              {
                active: formatCount(webhookActive),
                failing: formatCount(webhookFailing),
                drawn: webhookListCaption(webhooks.data.items.length, true),
              },
            )
          : t('settingsOverview.tileWebhookDetail', '{{active}} active / {{failing}} failing', {
              active: formatCount(webhookActive),
              failing: formatCount(webhookFailing),
            }),
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
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-primary-tint)] px-3 py-1 text-xs font-medium text-[var(--brand-primary)] dark:text-[var(--brand-deep)]">
              <Icon name="checkCircle" size={14} ariaHidden />
              {t('settingsOverview.heroBadge', 'Enterprise settings command center')}
            </div>
            <h3 className="mt-4 text-xl font-semibold tracking-tight text-[var(--fg-primary)]">
              {t(
                'settingsOverview.heroTitle',
                'Configure Polo PreSales once. Make every team move the same way.',
              )}
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--fg-secondary)]">
              {t(
                'settingsOverview.heroSubtitle',
                'Settings now surfaces the working controls that affect Polo PreSales across the app: workspace membership, roles, currencies, pipeline stages, lead recovery rules, tags, email templates, custom fields, API keys, and webhooks.',
              )}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
              {t('settingsOverview.readinessHeading', 'Readiness')}
            </div>
            <div className="mt-3 space-y-2 text-sm text-[var(--fg-secondary)]">
              <ReadinessRow
                label={t('settingsOverview.readinessPersonal', 'Personal preferences')}
                complete
              />
              <ReadinessRow
                label={t('settingsOverview.readinessWorkspace', 'Workspace controls')}
                complete={isAdmin}
                read={isAdmin ? governancePhase : undefined}
              />
              <ReadinessRow
                label={t('settingsOverview.readinessData', 'Data configuration')}
                complete={isAdmin}
              />
              <ReadinessRow
                label={t('settingsOverview.readinessApi', 'API and MCP access')}
                complete={isAdmin}
                read={isAdmin ? apiKeyPhase : undefined}
              />
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
              read={tile.read}
              onOpen={() => onNavigate(tile.section)}
            />
          ))}
      </div>

      {!isAdmin ? (
        <Card>
          <div className="p-5 text-sm text-[var(--fg-secondary)]">
            {t(
              'settingsOverview.nonAdminNotice',
              'You can manage your personal settings here. Workspace, data, and developer controls are limited to administrators.',
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function ReadinessRow({
  label,
  complete,
  read,
}: {
  label: string;
  complete: boolean;
  read?: 'pending' | 'error' | 'settled';
}) {
  const { t } = useTranslation('settings');
  const state =
    read === 'pending' ? 'checking' : read === 'error' ? 'failed' : complete ? 'ready' : 'admin';
  const tone =
    state === 'ready' ? 'jade' : state === 'failed' ? 'tomato' : state === 'checking' ? 'gray' : 'amber';
  const text =
    state === 'ready'
      ? t('settingsOverview.statusReady', 'Ready')
      : state === 'failed'
        ? t('settingsOverview.statusNotLoaded', 'Not loaded')
        : state === 'checking'
          ? t('settingsOverview.statusChecking', 'Checking')
          : t('settingsOverview.statusAdminOnly', 'Admin only');
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <Badge tone={tone}>{text}</Badge>
    </div>
  );
}

function OverviewTile({
  title,
  detail,
  icon,
  tone,
  read,
  onOpen,
}: {
  title: string;
  detail: string;
  icon: IconName;
  tone: TileTone;
  read?: 'checking' | 'failed';
  onOpen: () => void;
}) {
  const { t } = useTranslation('settings');
  const badgeText =
    read === 'checking'
      ? t('settingsOverview.statusChecking', 'Checking')
      : read === 'failed'
        ? t('settingsOverview.statusNotLoaded', 'Not loaded')
        : tone === 'tomato'
          ? t('settingsOverview.badgeNeedsAttention', 'Needs attention')
          : t('settingsOverview.badgeLive', 'Live');
  const badgeTone = read === 'checking' ? 'gray' : read === 'failed' ? 'tomato' : tone;
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-sunken)] text-[var(--brand-primary)] dark:text-[var(--brand-deep)]">
          <Icon name={icon} size={18} ariaHidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
            <Badge tone={badgeTone}>{badgeText}</Badge>
          </div>
          <p
            className="mt-1 text-sm text-[var(--fg-secondary)]"
            role={read === 'failed' ? 'alert' : read === 'checking' ? 'status' : undefined}
          >
            {detail}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onOpen}>
          {t('settingsOverview.openButton', 'Open')}
        </Button>
      </div>
    </Card>
  );
}

function formatCount(value: number | undefined): string {
  return value === undefined ? '...' : String(value);
}

type SecurityPhase = 'pending' | 'error' | 'settled';

function securityPhase(read: { isError?: boolean; status?: string }): SecurityPhase {
  if (read.isError || read.status === 'error') return 'error';
  if (read.status === 'success') return 'settled';
  return 'pending';
}

function combinePhase(left: SecurityPhase, right: SecurityPhase): SecurityPhase {
  if (left === 'error' || right === 'error') return 'error';
  if (left === 'pending' || right === 'pending') return 'pending';
  return 'settled';
}

function unreadBadge(phase: SecurityPhase): 'checking' | 'failed' | undefined {
  if (phase === 'pending') return 'checking';
  if (phase === 'error') return 'failed';
  return undefined;
}

function arrivedCount(data: { items?: readonly unknown[] } | null | undefined): number {
  return data?.items?.length ?? 0;
}
