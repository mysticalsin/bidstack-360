/**
 * WebhooksPage — full-page webhook subscription management.
 *
 * Features:
 *   - List active subscriptions with failure health indicators
 *   - Create subscription (URL + event picker)
 *   - Pause / resume / delete subscriptions
 *   - Per-subscription delivery history (expandable panel)
 *   - Test ping with live result
 *   - Signature verification code snippet (Node.js / Python / Ruby)
 *
 * WHY standalone page vs. SettingsPage section: webhook management is
 * developer-facing and dense enough to warrant its own route + URL
 * (users bookmark it, link to it from docs).
 */

import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
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

// ── Page ──────────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  const subs = useWebhookSubscriptions();
  const create = useCreateWebhookSubscription();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
            Webhooks
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Receive real-time HTTP callbacks when events happen in your workspace.
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="shrink-0"
          aria-label="Add webhook subscription"
        >
          <Icon name="plus" size={14} className="mr-1" />
          Add subscription
        </Button>
      </header>

      {/* Signature verification guide */}
      <SignatureGuide />

      {/* Subscription list */}
      <Card>
        <div className="border-b border-[var(--border-subtle)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Active subscriptions</h2>
        </div>

        {subs.isLoading ? (
          <div className="p-5">
            <LoadingSkeleton rows={3} />
          </div>
        ) : subs.isError ? (
          <div className="p-5">
            <ErrorState title="Failed to load" message="Could not load subscriptions. Please refresh." />
          </div>
        ) : !subs.data || subs.data.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No subscriptions yet"
              message="Create a subscription to start receiving webhook events."
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {subs.data.map((sub) => (
              <SubscriptionRow
                key={sub.id}
                subscription={sub}
                expanded={expandedId === sub.id}
                onToggleExpand={() =>
                  setExpandedId((prev) => (prev === sub.id ? null : sub.id))
                }
              />
            ))}
          </ul>
        )}
      </Card>

      {/* Create dialog */}
      {showCreate && (
        <CreateWebhookDialog
          onClose={() => setShowCreate(false)}
          onCreate={async (body) => {
            try {
              await create.mutateAsync(body);
              toast.success('Webhook subscription created');
              setShowCreate(false);
            } catch (err) {
              toast.error('Failed to create subscription', {
                description: err instanceof Error ? err.message : 'Server error',
              });
            }
          }}
          isPending={create.isPending}
        />
      )}
    </div>
  );
}

// ── SubscriptionRow ────────────────────────────────────────────────────────

function SubscriptionRow({
  subscription,
  expanded,
  onToggleExpand,
}: {
  subscription: WebhookSub;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const update = useUpdateWebhookSubscription(subscription.id);
  const del = useDeleteWebhookSubscription();
  const ping = useTestWebhookPing();
  const [pingResult, setPingResult] = useState<TestPingResult | null>(null);

  const handleToggleActive = async () => {
    try {
      await update.mutateAsync({ active: !subscription.active });
      toast.success(subscription.active ? 'Subscription paused' : 'Subscription resumed');
    } catch {
      toast.error('Failed to update subscription');
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete webhook subscription?',
      description:
        'The endpoint will stop receiving BidStack events immediately. Delivery history is retained.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(subscription.id);
      toast.success('Webhook subscription deleted');
    } catch {
      toast.error('Failed to delete subscription');
    }
  };

  const handlePing = async () => {
    setPingResult(null);
    try {
      const result = await ping.mutateAsync(subscription.id);
      setPingResult(result);
      if (result.success) {
        toast.success(`Ping delivered — ${result.statusCode} in ${result.durationMs}ms`);
      } else {
        toast.error('Ping failed', {
          description: result.error ?? `HTTP ${result.statusCode}`,
        });
      }
    } catch (err) {
      toast.error('Ping error', {
        description: err instanceof Error ? err.message : 'Unknown error',
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
      <div className="flex flex-wrap items-start gap-3 px-5 py-4">
        {/* Health dot */}
        <span
          className={cn(
            'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
            failureHealth === 'healthy' && 'bg-[var(--success-fg)]',
            failureHealth === 'warning' && 'bg-[var(--warning-fg)]',
            failureHealth === 'critical' && 'bg-[var(--error-fg)]',
          )}
          aria-label={`Health: ${failureHealth}`}
        />

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-[var(--fg-primary)] truncate max-w-sm">
              {subscription.url}
            </span>
            <Badge tone={subscription.active ? 'jade' : 'gray'} className="text-[10px]">
              {subscription.active ? 'Active' : 'Paused'}
            </Badge>
            {subscription.failureCount > 0 && (
              <Badge tone="tomato" className="text-[10px]">
                {subscription.failureCount} failure{subscription.failureCount !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-1">
            {subscription.events.map((e) => (
              <Badge key={e} tone="gray" className="text-[10px] font-mono">
                {e}
              </Badge>
            ))}
          </div>

          <div className="mt-1.5 flex gap-4 text-xs text-[var(--fg-tertiary)]">
            {subscription.lastDeliveryAt && (
              <span>Last delivery {relativeTime(subscription.lastDeliveryAt)}</span>
            )}
            {subscription.lastFailureAt && (
              <span className="text-[var(--warning-fg)]">
                Last failure {relativeTime(subscription.lastFailureAt)}
              </span>
            )}
          </div>

          {/* Ping result */}
          {pingResult && (
            <div
              className={cn(
                'mt-2 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs',
                pingResult.success
                  ? 'bg-[var(--success-surface)] text-[var(--success-fg)]'
                  : 'bg-[var(--error-surface)] text-[var(--error-fg)]',
              )}
              role="status"
            >
              <Icon name={pingResult.success ? 'check' : 'x'} size={12} />
              {pingResult.success
                ? `HTTP ${pingResult.statusCode} · ${pingResult.durationMs}ms`
                : pingResult.error ?? `HTTP ${pingResult.statusCode ?? 'timeout'}`}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePing}
            disabled={ping.isPending || !subscription.active}
            aria-label="Send test ping"
            title="Send test ping"
          >
            {ping.isPending ? (
              <Icon name="loader" size={14} className="animate-spin" />
            ) : (
              <Icon name="zap" size={14} />
            )}
            <span className="ml-1 hidden sm:inline">Ping</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-controls={`deliveries-${subscription.id}`}
            aria-label="Toggle delivery history"
          >
            <Icon name="list" size={14} />
            <span className="ml-1 hidden sm:inline">History</span>
            <Icon
              name="chevron-down"
              size={12}
              className={cn('ml-1 transition-transform', expanded && 'rotate-180')}
            />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleActive}
            disabled={update.isPending}
            aria-label={subscription.active ? 'Pause subscription' : 'Resume subscription'}
          >
            <Icon name={subscription.active ? 'pause' : 'play'} size={14} />
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={del.isPending}
            aria-label="Delete subscription"
          >
            <Icon name="trash" size={14} />
          </Button>
        </div>
      </div>

      {/* Delivery history panel */}
      {expanded && (
        <DeliveryHistoryPanel
          id={`deliveries-${subscription.id}`}
          subscriptionId={subscription.id}
        />
      )}
    </li>
  );
}

