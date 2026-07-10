import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { confirm } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { CreateWebhookDialog } from '@/components/webhooks/CreateWebhookDialog';
import { DeliveryHistoryPanel } from '@/components/webhooks/DeliveryHistoryPanel';
import { SignatureGuide } from '@/components/webhooks/SignatureGuide';
import {
  useWebhookSubscriptions,
  useCreateWebhookSubscription,
  useUpdateWebhookSubscription,
  useDeleteWebhookSubscription,
  useTestWebhookPing,
  type WebhookSub,
  type TestPingResult,
} from '@/hooks/useWebhookSubscriptions';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useIsAdmin } from '@/lib/auth';

interface CreatedSecret {
  url: string;
  secret: string;
}

export function WebhooksSection() {
  const { t } = useTranslation('settings');
  const isAdmin = useIsAdmin();
  const subs = useWebhookSubscriptions({ enabled: isAdmin });
  const create = useCreateWebhookSubscription();
  const [showCreate, setShowCreate] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<CreatedSecret | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const metrics = useMemo(() => buildWebhookMetrics(subs.data ?? []), [subs.data]);

  if (!isAdmin) {
    return <AdminOnlyNotice />;
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="grid gap-5 p-5 xl:grid-cols-[1.35fr,0.65fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-primary-tint)] px-3 py-1 text-xs font-medium text-[var(--brand-primary)]">
              <Icon name="webhook" size={14} ariaHidden />
              {t('webhooks.controlPlaneBadge', 'Admin webhook control plane')}
            </div>
            <h3 className="mt-4 text-xl font-semibold tracking-tight text-[var(--fg-primary)]">
              {t('webhooks.heroTitle', 'Deliver trusted platform events to every downstream system.')}
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--fg-secondary)]">
              {t(
                'webhooks.heroBody',
                'Create signed outbound subscriptions for Dust, MCP workflows, data warehouses, Slack automations, and customer systems. Every endpoint is HTTPS-only, HMAC-signed, rate-limited for tests, and tracked with delivery history.',
              )}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Icon name="plus" size={14} className="mr-1.5" />
                {t('webhooks.addSubscription', 'Add subscription')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void subs.refetch()}
                disabled={subs.isFetching}
              >
                <Icon
                  name={subs.isFetching ? 'loader' : 'refresh'}
                  size={14}
                  className={cn('mr-1.5', subs.isFetching && 'animate-spin')}
                />
                {t('webhooks.refresh', 'Refresh')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label={t('webhooks.metricTotal', 'Total')}
              value={metrics.total}
              icon="webhook"
              tone="blue"
            />
            <MetricCard
              label={t('webhooks.metricActive', 'Active')}
              value={metrics.active}
              icon="checkCircle"
              tone="jade"
            />
            <MetricCard
              label={t('webhooks.metricFailing', 'Failing')}
              value={metrics.failing}
              icon="warning"
              tone="tomato"
            />
            <MetricCard
              label={t('webhooks.metricEvents', 'Events')}
              value={metrics.eventCount}
              icon="list"
              tone="purple"
            />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <ReadinessCard
          icon="shield"
          title={t('webhooks.readinessSignedTitle', 'Signed by default')}
          body={t(
            'webhooks.readinessSignedBody',
            'Every delivery includes X-Polo-Signature with a timestamped HMAC.',
          )}
          status={t('webhooks.readinessStatusRequired', 'Required')}
          tone="jade"
        />
        <ReadinessCard
          icon="clock"
          title={t('webhooks.readinessBudgetTitle', '10 second receiver budget')}
          body={t(
            'webhooks.readinessBudgetBody',
            'Acknowledge fast, then process asynchronously. Non-2xx responses are retried.',
          )}
          status={t('webhooks.readinessStatusOperational', 'Operational')}
          tone="blue"
        />
        <ReadinessCard
          icon="warning"
          title={t('webhooks.readinessPrivateTitle', 'Private networks blocked')}
          body={t(
            'webhooks.readinessPrivateBody',
            'HTTPS is enforced and internal hostnames, localhost, and private IP ranges are rejected.',
          )}
          status={t('webhooks.readinessStatusProtected', 'Protected')}
          tone="purple"
        />
      </div>

      {createdSecret ? (
        <SigningSecretCard secret={createdSecret.secret} url={createdSecret.url} />
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
              {t('webhooks.subscriptionsTitle', 'Webhook subscriptions')}
            </h2>
            <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
              {metrics.lastActivity
                ? t('webhooks.lastActivity', 'Last activity {{time}}', {
                    time: relativeTime(metrics.lastActivity),
                  })
                : t('webhooks.noActivity', 'No delivery activity recorded yet.')}
            </p>
          </div>
          <Badge tone={metrics.failing > 0 ? 'tomato' : 'jade'}>
            {metrics.failing > 0
              ? t('webhooks.needAttention', '{{count}} need attention', { count: metrics.failing })
              : t('webhooks.allClear', 'All clear')}
          </Badge>
        </div>

        {subs.isLoading ? (
          <div className="p-5">
            <LoadingSkeleton rows={4} />
          </div>
        ) : subs.isError ? (
          <div className="p-5">
            <ErrorState
              title={t('webhooks.errorTitle', 'Failed to load webhooks')}
              message={t(
                'webhooks.errorMessage',
                'Could not load webhook subscriptions. Check your admin permissions or refresh.',
              )}
              action={
                <Button variant="secondary" size="sm" onClick={() => void subs.refetch()}>
                  {t('webhooks.retry', 'Retry')}
                </Button>
              }
            />
          </div>
        ) : !subs.data || subs.data.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={t('webhooks.emptyTitle', 'No subscriptions yet')}
              message={t(
                'webhooks.emptyMessage',
                'Create a subscription to start sending signed platform events to your systems.',
              )}
              action={
                <Button size="sm" onClick={() => setShowCreate(true)}>
                  <Icon name="plus" size={14} className="mr-1.5" />
                  {t('webhooks.addSubscription', 'Add subscription')}
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {subs.data.map((sub) => (
              <SubscriptionRow
                key={sub.id}
                subscription={sub}
                expanded={expandedId === sub.id}
                onToggleExpand={() => setExpandedId((prev) => (prev === sub.id ? null : sub.id))}
              />
            ))}
          </ul>
        )}
      </Card>

      <SignatureGuide />

      {showCreate ? (
        <CreateWebhookDialog
          onClose={() => setShowCreate(false)}
          onSubmit={async (body) => {
            try {
              const created = await create.mutateAsync(body);
              setCreatedSecret({ url: created.url, secret: created.signingSecret });
              toast.success(t('webhooks.toastCreated', 'Webhook subscription created'));
              setShowCreate(false);
            } catch (err) {
              toast.error(t('webhooks.toastCreateFailed', 'Failed to create subscription'), {
                description:
                  err instanceof Error ? err.message : t('webhooks.serverError', 'Server error'),
              });
            }
          }}
          isPending={create.isPending}
        />
      ) : null}
    </div>
  );
}

function AdminOnlyNotice() {
  const { t } = useTranslation('settings');
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--surface-sunken)] text-[var(--brand-primary)]">
          <Icon name="shield" size={20} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('webhooks.adminOnlyTitle', 'Webhooks are limited to administrators')}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--fg-secondary)]">
            {t(
              'webhooks.adminOnlyBody',
              'Webhook subscriptions can push sensitive platform data to external systems, so only admins can view, create, test, pause, or delete them.',
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: IconName;
  tone: BadgeTone;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--fg-secondary)]">{label}</span>
        <span className="text-[var(--brand-primary)]">
          <Icon name={icon} size={15} />
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums text-[var(--fg-primary)]">
          {value}
        </span>
        <Badge tone={tone}>
          {value === 0 ? t('webhooks.metricNone', 'None') : t('webhooks.metricLive', 'Live')}
        </Badge>
      </div>
    </div>
  );
}

function ReadinessCard({
  icon,
  title,
  body,
  status,
  tone,
}: {
  icon: IconName;
  title: string;
  body: string;
  status: string;
  tone: BadgeTone;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-sunken)] text-[var(--brand-primary)]">
          <Icon name={icon} size={16} />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
            <Badge tone={tone}>{status}</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--fg-secondary)]">{body}</p>
        </div>
      </div>
    </Card>
  );
}

function SigningSecretCard({ secret, url }: { secret: string; url: string }) {
  const { t } = useTranslation('settings');
  return (
    <Card className="border-[var(--brand-primary)]/35 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="shield" size={16} className="text-[var(--brand-primary)]" />
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
              {t('webhooks.signingSecretTitle', 'Copy the signing secret now')}
            </h3>
            <Badge tone="amber">{t('webhooks.shownOnce', 'Shown once')}</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]">
            {t('webhooks.signingSecretBodyBefore', 'Store this secret in the receiver for')}{' '}
            <span className="font-mono"> {url}</span>.{' '}
            {t('webhooks.signingSecretBodyAfter', 'It will not be shown again.')}
          </p>
          <code className="mt-3 block overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 font-mono text-xs text-[var(--fg-primary)]">
            {secret}
          </code>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(secret);
              toast.success(t('webhooks.toastSecretCopied', 'Signing secret copied'));
            } catch {
              toast.error(t('webhooks.toastCopyFailed', 'Copy failed'), {
                description: t('webhooks.copyFailedDescription', 'Clipboard access was not available.'),
              });
            }
          }}
        >
          <Icon name="copy" size={14} className="mr-1.5" />
          {t('webhooks.copySecret', 'Copy secret')}
        </Button>
      </div>
    </Card>
  );
}

function SubscriptionRow({
  subscription,
  expanded,
  onToggleExpand,
}: {
  subscription: WebhookSub;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const { t } = useTranslation('settings');
  const update = useUpdateWebhookSubscription(subscription.id);
  const del = useDeleteWebhookSubscription();
  const ping = useTestWebhookPing();
  const [pingResult, setPingResult] = useState<TestPingResult | null>(null);
  const [editing, setEditing] = useState(false);

  const handleToggleActive = async () => {
    try {
      await update.mutateAsync({ active: !subscription.active });
      toast.success(
        subscription.active
          ? t('webhooks.toastPaused', 'Subscription paused')
          : t('webhooks.toastResumed', 'Subscription resumed'),
      );
    } catch {
      toast.error(t('webhooks.toastUpdateFailed', 'Failed to update subscription'));
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: t('webhooks.deleteConfirmTitle', 'Delete webhook subscription?'),
      description: t(
        'webhooks.deleteConfirmDescription',
        'The endpoint will stop receiving Polo PreSales events immediately. Delivery history is retained.',
      ),
      confirmLabel: t('webhooks.deleteConfirmLabel', 'Delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(subscription.id);
      toast.success(t('webhooks.toastDeleted', 'Webhook subscription deleted'));
    } catch {
      toast.error(t('webhooks.toastDeleteFailed', 'Failed to delete subscription'));
    }
  };

  const handlePing = async () => {
    setPingResult(null);
    try {
      const result = await ping.mutateAsync(subscription.id);
      setPingResult(result);
      if (result.success) {
        toast.success(
          t('webhooks.toastPingDelivered', 'Ping delivered - {{statusCode}} in {{durationMs}}ms', {
            statusCode: result.statusCode,
            durationMs: result.durationMs,
          }),
        );
      } else {
        toast.error(t('webhooks.toastPingFailed', 'Ping failed'), {
          description:
            result.error ??
            t('webhooks.httpStatus', 'HTTP {{statusCode}}', { statusCode: result.statusCode }),
        });
      }
    } catch (err) {
      toast.error(t('webhooks.toastPingError', 'Ping error'), {
        description: err instanceof Error ? err.message : t('webhooks.unknownError', 'Unknown error'),
      });
    }
  };

  const failureHealth =
    subscription.failureCount === 0
      ? 'healthy'
      : subscription.failureCount < 5
        ? 'warning'
        : 'critical';

  return (
    <li>
      <div className="grid gap-4 px-5 py-4 xl:grid-cols-[1fr,auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <HealthDot health={failureHealth} />
            <span className="break-all font-mono text-sm font-medium text-[var(--fg-primary)]">
              {subscription.url}
            </span>
            <Badge tone={subscription.active ? 'jade' : 'gray'}>
              {subscription.active
                ? t('webhooks.statusActive', 'Active')
                : t('webhooks.statusPaused', 'Paused')}
            </Badge>
            {subscription.failureCount > 0 ? (
              <Badge tone="tomato">
                {subscription.failureCount === 1
                  ? t('webhooks.failureCount.one', '{{count}} failure', {
                      count: subscription.failureCount,
                    })
                  : t('webhooks.failureCount.other', '{{count}} failures', {
                      count: subscription.failureCount,
                    })}
              </Badge>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {subscription.events.map((event) => (
              <Badge key={event} tone="gray" className="font-mono text-[10px]">
                {event}
              </Badge>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--fg-tertiary)]">
            <span>
              {t('webhooks.createdAt', 'Created {{time}}', {
                time: relativeTime(subscription.createdAt),
              })}
            </span>
            {subscription.lastDeliveryAt ? (
              <span>
                {t('webhooks.lastDelivery', 'Last delivery {{time}}', {
                  time: relativeTime(subscription.lastDeliveryAt),
                })}
              </span>
            ) : null}
            {subscription.lastFailureAt ? (
              <span className="text-[var(--warning-fg)]">
                {t('webhooks.lastFailure', 'Last failure {{time}}', {
                  time: relativeTime(subscription.lastFailureAt),
                })}
              </span>
            ) : null}
          </div>

          {pingResult ? (
            <div
              className={cn(
                'mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
                pingResult.success
                  ? 'bg-[var(--success-surface)] text-[var(--success-fg)]'
                  : 'bg-[var(--error-surface)] text-[var(--error-fg)]',
              )}
              role="status"
            >
              <Icon name={pingResult.success ? 'check' : 'x'} size={12} />
              {pingResult.success
                ? t('webhooks.pingResultSuccess', 'HTTP {{statusCode}} - {{durationMs}}ms', {
                    statusCode: pingResult.statusCode,
                    durationMs: pingResult.durationMs,
                  })
                : (pingResult.error ??
                  t('webhooks.pingResultFailure', 'HTTP {{statusCode}}', {
                    statusCode: pingResult.statusCode ?? t('webhooks.timeout', 'timeout'),
                  }))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePing}
            disabled={ping.isPending || !subscription.active}
            aria-label={t('webhooks.pingAriaLabel', 'Send test ping')}
            title={t('webhooks.pingAriaLabel', 'Send test ping')}
          >
            <Icon
              name={ping.isPending ? 'loader' : 'zap'}
              size={14}
              className={cn(ping.isPending && 'animate-spin')}
            />
            <span className="ml-1.5">{t('webhooks.ping', 'Ping')}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-controls={`deliveries-${subscription.id}`}
          >
            <Icon name="list" size={14} />
            <span className="ml-1.5">{t('webhooks.history', 'History')}</span>
            <Icon
              name="chevron-down"
              size={12}
              className={cn('ml-1 transition-transform', expanded && 'rotate-180')}
            />
          </Button>

          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Icon name="pencil" size={14} />
            <span className="ml-1.5">{t('webhooks.edit', 'Edit')}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleActive}
            disabled={update.isPending}
            aria-label={
              subscription.active
                ? t('webhooks.pauseAriaLabel', 'Pause subscription')
                : t('webhooks.resumeAriaLabel', 'Resume subscription')
            }
          >
            <Icon name={subscription.active ? 'pause' : 'play'} size={14} />
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={del.isPending}
            aria-label={t('webhooks.deleteAriaLabel', 'Delete subscription')}
          >
            <Icon name="trash" size={14} />
          </Button>
        </div>
      </div>

      {expanded ? (
        <DeliveryHistoryPanel
          id={`deliveries-${subscription.id}`}
          subscriptionId={subscription.id}
        />
      ) : null}

      {editing ? (
        <CreateWebhookDialog
          mode="edit"
          initialUrl={subscription.url}
          initialEvents={subscription.events}
          onClose={() => setEditing(false)}
          onSubmit={async (body) => {
            try {
              await update.mutateAsync(body);
              toast.success(t('webhooks.toastUpdated', 'Webhook subscription updated'));
              setEditing(false);
            } catch (err) {
              toast.error(t('webhooks.toastUpdateFailed', 'Failed to update subscription'), {
                description:
                  err instanceof Error ? err.message : t('webhooks.serverError', 'Server error'),
              });
            }
          }}
          isPending={update.isPending}
        />
      ) : null}
    </li>
  );
}

function HealthDot({ health }: { health: 'healthy' | 'warning' | 'critical' }) {
  const { t } = useTranslation('settings');
  return (
    <span
      className={cn(
        'h-2.5 w-2.5 shrink-0 rounded-full',
        health === 'healthy' && 'bg-[var(--success-fg)]',
        health === 'warning' && 'bg-[var(--warning-fg)]',
        health === 'critical' && 'bg-[var(--error-fg)]',
      )}
      aria-label={t('webhooks.healthLabel', 'Health: {{health}}', { health })}
    />
  );
}

function buildWebhookMetrics(subscriptions: WebhookSub[]) {
  const active = subscriptions.filter((subscription) => subscription.active).length;
  const failing = subscriptions.filter((subscription) => subscription.failureCount > 0).length;
  const eventCount = new Set(subscriptions.flatMap((subscription) => subscription.events)).size;
  const lastActivity = subscriptions
    .flatMap((subscription) => [subscription.lastDeliveryAt, subscription.lastFailureAt])
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return {
    total: subscriptions.length,
    active,
    failing,
    eventCount,
    lastActivity,
  };
}
