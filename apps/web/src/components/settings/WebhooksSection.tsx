import { useState } from 'react';
import {
  useWebhookSubscriptions,
  useCreateWebhookSubscription,
  useUpdateWebhookSubscription,
  useDeleteWebhookSubscription,
} from '@/hooks/useWebhookSubscriptions';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { Badge } from '@/components/ui/Badge';

const EVENT_OPTIONS = [
  'opportunity.created',
  'opportunity.updated',
  'opportunity.stage_changed',
  'contact.created',
  'task.created',
  'task.completed',
  'invoice.sent',
  'invoice.paid',
  'lead.converted',
];

export function WebhooksSection() {
  const subs = useWebhookSubscriptions();
  const create = useCreateWebhookSubscription();
  const del = useDeleteWebhookSubscription();
  const [showNew, setShowNew] = useState(false);

  return (
    <Card>
      <SectionHeader
        title="Webhook subscriptions"
        caption="Send real-time HTTP callbacks to your own endpoints."
      />
      <div className="p-5">
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setShowNew(true)}>
            <Icon name="plus" size={14} />
            Add subscription
          </Button>
        </div>

        {showNew && (
          <NewWebhookDialog
            onClose={() => setShowNew(false)}
            onCreate={async (body) => {
              await create.mutateAsync(body);
              setShowNew(false);
            }}
            isPending={create.isPending}
          />
        )}

        {subs.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : !subs.data || subs.data.length === 0 ? (
          <p className="text-sm text-[var(--fg-secondary)]">No webhook subscriptions yet.</p>
        ) : (
          <div className="space-y-2">
            {subs.data.map((s) => (
              <WebhookRow key={s.id} subscription={s} onDelete={(id) => del.mutate(id)} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function WebhookRow({
  subscription,
  onDelete,
}: {
  subscription: { id: string; url: string; events: string[]; active: boolean };
  onDelete: (id: string) => void;
}) {
  const update = useUpdateWebhookSubscription(subscription.id);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-subtle)] px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--fg-primary)] truncate">
          {subscription.url}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {subscription.events.map((e) => (
            <Badge key={e} tone="gray" className="text-[10px]">
              {e}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => update.mutate({ active: !subscription.active })}
        >
          {subscription.active ? 'Pause' : 'Resume'}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            if (confirm('Delete this webhook subscription?')) onDelete(subscription.id);
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function NewWebhookDialog({
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || selected.length === 0) return;
    onCreate({ url, events: selected });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            New webhook subscription
          </h2>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
              Endpoint URL
            </label>
            <input
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.com/webhooks/bidstack"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--fg-secondary)] mb-1">
              Events
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EVENT_OPTIONS.map((e) => (
                <label
                  key={e}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 hover:bg-[var(--surface-sunken)]"
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--brand-primary)]"
                    checked={selected.includes(e)}
                    onChange={() => toggleEvent(e)}
                  />
                  <span className="text-sm text-[var(--fg-primary)]">{e}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create subscription'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
