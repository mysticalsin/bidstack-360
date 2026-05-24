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
import {
  useWebhookSubscriptions,
  useWebhookDeliveries,
  useCreateWebhookSubscription,
  useUpdateWebhookSubscription,
  useDeleteWebhookSubscription,
  useTestWebhookPing,
  type WebhookSub,
  type WebhookDeliveryRecord,
  type TestPingResult,
} from '@/hooks/useWebhookSubscriptions';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

// ── Constants ──────────────────────────────────────────────────────────────

const EVENT_OPTIONS = [
  { group: 'CRM', events: ['opportunity.created', 'opportunity.updated', 'opportunity.stage_changed', 'contact.created', 'lead.converted'] },
  { group: 'Tasks & Proposals', events: ['task.created', 'task.completed', 'proposal.submitted'] },
  { group: 'Bids & Documents', events: ['bid.score_updated', 'document.extracted', 'dust.agent.completed'] },
  { group: 'Finance', events: ['invoice.sent', 'invoice.paid'] },
];

const ALL_EVENTS = EVENT_OPTIONS.flatMap((g) => g.events);

const SIGNATURE_SNIPPETS = {
  'Node.js': `const crypto = require('crypto');

function verifySignature(rawBody, header, secret) {
  const [tPart, v1Part] = header.split(',');
  const t = tPart.replace('t=', '');
  const v1 = v1Part.replace('v1=', '');

  // Reject stale events (> 5 min)
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(\`\${t}.\${rawBody}\`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(v1, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}`,
  Python: `import hmac, hashlib, time

def verify_signature(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(item.split("=", 1) for item in header.split(","))
    t, v1 = parts.get("t", ""), parts.get("v1", "")

    # Reject stale events (> 5 min)
    if abs(time.time() - int(t)) > 300:
        return False

    expected = hmac.new(
        secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(v1, expected)`,
  Ruby: `require 'openssl'

def verify_signature(raw_body, header, secret)
  parts = Hash[header.split(',').map { |p| p.split('=', 2) }]
  t, v1 = parts['t'], parts['v1']

  # Reject stale events (> 5 min)
  return false if (Time.now.to_i - t.to_i).abs > 300

  expected = OpenSSL::HMAC.hexdigest('sha256', secret, "#{t}.#{raw_body}")
  ActiveSupport::SecurityUtils.secure_compare(v1, expected)
end`,
};

type Lang = keyof typeof SIGNATURE_SNIPPETS;

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

// ── DeliveryHistoryPanel ───────────────────────────────────────────────────

function DeliveryHistoryPanel({
  subscriptionId,
  id,
}: {
  subscriptionId: string;
  id: string;
}) {
  const deliveries = useWebhookDeliveries(subscriptionId);

  return (
    <div
      id={id}
      className="border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-5 py-4"
    >
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        Delivery history
      </h3>

      {deliveries.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : deliveries.isError ? (
        <ErrorState title="Failed to load" message="Could not load delivery history." />
      ) : !deliveries.data || deliveries.data.data.length === 0 ? (
        <p className="text-sm text-[var(--fg-secondary)]">No deliveries recorded yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-card)]">
                  <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Event</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Duration</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Attempt</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--fg-tertiary)]">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {deliveries.data.data.map((d) => (
                  <DeliveryRow key={d.id} delivery={d} />
                ))}
              </tbody>
            </table>
          </div>
          {deliveries.data.hasMore && (
            <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
              Showing 50 most recent deliveries.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function DeliveryRow({ delivery }: { delivery: WebhookDeliveryRecord }) {
  const [showError, setShowError] = useState(false);

  return (
    <>
      <tr
        className={cn(
          'transition-colors hover:bg-[var(--surface-card)]',
          !delivery.success && 'bg-[var(--error-surface)]/30',
        )}
      >
        <td className="px-3 py-2 font-mono text-[var(--fg-primary)]">{delivery.event}</td>
        <td className="px-3 py-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
              delivery.success
                ? 'bg-[var(--success-surface)] text-[var(--success-fg)]'
                : 'bg-[var(--error-surface)] text-[var(--error-fg)]',
            )}
          >
            {delivery.success ? (
              <Icon name="check" size={9} />
            ) : (
              <Icon name="x" size={9} />
            )}
            {delivery.statusCode ?? 'timeout'}
          </span>
        </td>
        <td className="px-3 py-2 tabular-nums text-[var(--fg-secondary)]">
          {delivery.durationMs != null ? `${delivery.durationMs}ms` : '—'}
        </td>
        <td className="px-3 py-2 text-[var(--fg-secondary)]">#{delivery.attempt}</td>
        <td className="px-3 py-2 text-[var(--fg-tertiary)]">
          <div className="flex items-center gap-1">
            {relativeTime(delivery.createdAt)}
            {delivery.errorMessage && (
              <button
                type="button"
                onClick={() => setShowError((v) => !v)}
                className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-sunken)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                aria-label={showError ? 'Hide error' : 'Show error'}
                aria-expanded={showError}
              >
                <Icon name="info" size={11} className="text-[var(--error-fg)]" />
              </button>
            )}
          </div>
        </td>
      </tr>
      {showError && delivery.errorMessage && (
        <tr>
          <td
            colSpan={5}
            className="px-3 pb-2 pt-0"
          >
            <pre className="overflow-x-auto rounded bg-[var(--surface-sunken)] px-3 py-2 text-[10px] text-[var(--error-fg)]">
              {delivery.errorMessage}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

// ── CreateWebhookDialog ───────────────────────────────────────────────────

function CreateWebhookDialog({
  onClose,
  onCreate,
  isPending,
}: {
  onClose: () => void;
  onCreate: (body: { url: string; events: string[] }) => void;
  isPending: boolean;
}) {
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const toggleEvent = (e: string) => {
    setSelected((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  };

  const selectAll = () => setSelected([...ALL_EVENTS]);
  const clearAll = () => setSelected([]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || selected.length === 0) return;
    onCreate({ url, events: selected });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-webhook-title"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-card)] px-6 py-4">
          <h2
            id="create-webhook-title"
            className="text-lg font-semibold text-[var(--fg-primary)]"
          >
            New webhook subscription
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-5 px-6 py-5">
          {/* URL */}
          <div>
            <label
              htmlFor="webhook-url"
              className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
            >
              Endpoint URL <span aria-hidden="true" className="text-[var(--error-fg)]">*</span>
            </label>
            <input
              id="webhook-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.com/webhooks/bidstack"
              required
              autoFocus
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none transition-colors focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            />
            <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
              Must be HTTPS. Private/internal IPs are blocked for security.
            </p>
          </div>

          {/* Events */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-[var(--fg-secondary)]">
                Events <span aria-hidden="true" className="text-[var(--error-fg)]">*</span>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs text-[var(--brand-primary)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                >
                  Select all
                </button>
                <span className="text-[var(--fg-tertiary)]">·</span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-[var(--fg-tertiary)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {EVENT_OPTIONS.map((group) => (
                <div key={group.group}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    {group.group}
                  </p>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {group.events.map((e) => (
                      <label
                        key={e}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--fg-primary)] transition-colors hover:bg-[var(--surface-sunken)] has-[:checked]:border-[var(--brand-primary)] has-[:checked]:bg-[var(--brand-primary)]/5"
                      >
                        <input
                          type="checkbox"
                          className="accent-[var(--brand-primary)] h-4 w-4"
                          checked={selected.includes(e)}
                          onChange={() => toggleEvent(e)}
                        />
                        <span className="font-mono text-xs">{e}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {selected.length > 0 && (
              <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
                {selected.length} event{selected.length !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-[var(--border-subtle)] pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !url || selected.length === 0}
            >
              {isPending ? 'Creating…' : 'Create subscription'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── SignatureGuide ─────────────────────────────────────────────────────────

function SignatureGuide() {
  const [lang, setLang] = useState<Lang>('Node.js');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SIGNATURE_SNIPPETS[lang]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silent fail
    }
  };

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon name="shield" size={16} className="text-[var(--brand-primary)]" />
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            Signature verification
          </h2>
        </div>
        <p className="mt-1 text-xs text-[var(--fg-secondary)]">
          Every delivery includes an{' '}
          <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 font-mono text-[11px]">
            X-BidStack-Signature
          </code>{' '}
          header. Verify it to confirm the request originated from BidStack.
          Format:{' '}
          <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 font-mono text-[11px]">
            t=&lt;unix-seconds&gt;,v1=&lt;hmac-sha256-hex&gt;
          </code>
        </p>
      </div>

      <div className="px-5 py-4">
        {/* Lang tabs */}
        <div
          className="mb-3 flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-1 w-fit"
          role="tablist"
          aria-label="Signature verification language"
        >
          {(Object.keys(SIGNATURE_SNIPPETS) as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={lang === l}
              onClick={() => setLang(l)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]',
                lang === l
                  ? 'bg-[var(--surface-card)] text-[var(--fg-primary)] shadow-sm'
                  : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
              )}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Code block */}
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg bg-[var(--surface-sunken)] p-4 text-xs leading-relaxed text-[var(--fg-primary)]">
            <code>{SIGNATURE_SNIPPETS[lang]}</code>
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy code"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--fg-tertiary)] transition-colors hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
          </button>
        </div>

        <p className="mt-3 text-xs text-[var(--fg-tertiary)]">
          Reject events where{' '}
          <code className="font-mono">|now - t| &gt; 300</code>{' '}
          seconds to prevent replay attacks. Always use a timing-safe comparison.
        </p>
      </div>
    </Card>
  );
}
