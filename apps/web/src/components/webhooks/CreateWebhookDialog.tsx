/**
 * CreateWebhookDialog — modal for registering a new webhook subscription.
 *
 * Handles URL input, grouped event checkbox selection (select-all / clear),
 * and submission with pending state. SSRF note: the URL is also validated
 * server-side; the "Must be HTTPS" hint is informational only.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';

const EVENT_OPTIONS = [
  {
    group: 'CRM',
    events: [
      'opportunity.created',
      'opportunity.updated',
      'opportunity.stage_changed',
      'contact.created',
      'lead.converted',
    ],
  },
  { group: 'Tasks & Proposals', events: ['task.created', 'task.completed', 'proposal.submitted'] },
  {
    group: 'Bids & Documents',
    events: ['bid.score_updated', 'document.extracted', 'dust.agent.completed'],
  },
  { group: 'Finance', events: ['invoice.sent', 'invoice.paid'] },
];

const ALL_EVENTS = EVENT_OPTIONS.flatMap((g) => g.events);

export function CreateWebhookDialog({
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
    <Modal open onClose={onClose} labelId="create-webhook-title">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-card)] px-6 py-4">
          <h2 id="create-webhook-title" className="text-lg font-semibold text-[var(--fg-primary)]">
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
              Endpoint URL{' '}
              <span aria-hidden="true" className="text-[var(--error-fg)]">
                *
              </span>
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
                Events{' '}
                <span aria-hidden="true" className="text-[var(--error-fg)]">
                  *
                </span>
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
            <Button type="submit" disabled={isPending || !url || selected.length === 0}>
              {isPending ? 'Creating…' : 'Create subscription'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
