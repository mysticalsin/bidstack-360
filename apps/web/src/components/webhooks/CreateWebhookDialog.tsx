import { WEBHOOK_EVENT_GROUPS } from '@bidstack/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';

const ALL_EVENTS = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events.map((event) => event.key));

export function CreateWebhookDialog({
  initialUrl = '',
  initialEvents = [],
  mode = 'create',
  onClose,
  onSubmit,
  isPending,
}: {
  initialUrl?: string;
  initialEvents?: string[];
  mode?: 'create' | 'edit';
  onClose: () => void;
  onSubmit: (body: { url: string; events: string[] }) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation('crm');
  const [url, setUrl] = useState(initialUrl);
  const [selected, setSelected] = useState<string[]>(initialEvents);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const isEditing = mode === 'edit';

  const toggleEvent = (event: string) => {
    setSelected((prev) =>
      prev.includes(event) ? prev.filter((item) => item !== event) : [...prev, event],
    );
  };

  const selectAll = () => setSelected([...ALL_EVENTS]);
  const clearAll = () => setSelected([]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim() || selected.length === 0) return;
    onSubmit({ url: url.trim(), events: selected });
  };

  return (
    <Modal open onClose={onClose} labelId="webhook-dialog-title">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-card)] px-6 py-4">
          <div>
            <Badge tone="purple" className="mb-2">
              {t('createWebhook.adminOnlyBadge', 'Admin only')}
            </Badge>
            <h2
              id="webhook-dialog-title"
              className="text-lg font-semibold text-[var(--fg-primary)]"
            >
              {isEditing
                ? t('createWebhook.editTitle', 'Edit webhook subscription')
                : t('createWebhook.createTitle', 'New webhook subscription')}
            </h2>
            <p className="mt-1 text-xs text-[var(--fg-secondary)]">
              {t(
                'createWebhook.subtitle',
                'Use a production HTTPS endpoint. BidStack signs every delivery with HMAC-SHA256.',
              )}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('createWebhook.closeAriaLabel', 'Close')}
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="grid gap-5 px-6 py-5 lg:grid-cols-[1fr,240px]">
          <div className="space-y-5">
            <div>
              <label
                htmlFor="webhook-url"
                className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]"
              >
                {t('createWebhook.endpointUrlLabel', 'Endpoint URL')}{' '}
                <span className="text-[var(--error-fg)]">*</span>
              </label>
              <input
                id="webhook-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t(
                  'createWebhook.endpointUrlPlaceholder',
                  'https://your-app.com/webhooks/bidstack',
                )}
                required
                autoFocus
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--fg-primary)] outline-none transition-colors focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
              <p className="mt-2 text-xs text-[var(--fg-tertiary)]">
                {t(
                  'createWebhook.endpointUrlHelp',
                  'HTTPS is required. Localhost, private IPs, and internal hostnames are rejected.',
                )}
              </p>
            </div>

            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <label className="text-xs font-medium text-[var(--fg-secondary)]">
                    {t('createWebhook.eventsLabel', 'Events')}{' '}
                    <span className="text-[var(--error-fg)]">*</span>
                  </label>
                  <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
                    {t(
                      'createWebhook.eventsHelp',
                      'Choose only the events your receiver actually handles.',
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={selectAll}>
                    {t('createWebhook.selectAll', 'Select all')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                    {t('createWebhook.clear', 'Clear')}
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                {WEBHOOK_EVENT_GROUPS.map((group) => (
                  <fieldset
                    key={group.group}
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)]/45 p-3"
                  >
                    <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                      {group.group}
                    </legend>
                    <p className="mb-3 text-xs leading-5 text-[var(--fg-secondary)]">
                      {group.description}
                    </p>
                    <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                      {group.events.map((event) => {
                        const checked = selectedSet.has(event.key);
                        return (
                          <label
                            key={event.key}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm transition-colors',
                              checked
                                ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/8'
                                : 'border-[var(--border-subtle)] bg-[var(--surface-card)] hover:border-[var(--border-default)]',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-[var(--brand-primary)]"
                              checked={checked}
                              onChange={() => toggleEvent(event.key)}
                            />
                            <span>
                              <span className="block font-medium text-[var(--fg-primary)]">
                                {event.label}
                              </span>
                              <code className="mt-1 block font-mono text-[11px] text-[var(--brand-primary)]">
                                {event.key}
                              </code>
                              <span className="mt-1 block text-xs leading-5 text-[var(--fg-tertiary)]">
                                {event.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
                <Icon name="shield" size={16} />
                {t('createWebhook.securityContractTitle', 'Security contract')}
              </div>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-[var(--fg-secondary)]">
                <li>{t('createWebhook.securityReturn2xx', 'Return a 2xx status within 10 seconds.')}</li>
                <li>
                  {t('createWebhook.securityVerifyHeader', 'Verify the X-BidStack-Signature header.')}
                </li>
                <li>
                  {t('createWebhook.securityRejectOld', 'Reject signatures older than 5 minutes.')}
                </li>
                <li>
                  {t(
                    'createWebhook.securityAsync',
                    'Process heavy work asynchronously after acknowledging.',
                  )}
                </li>
              </ul>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {t('createWebhook.selectedEventsLabel', 'Selected events')}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--fg-primary)]">
                {selected.length}
              </div>
              <p className="mt-1 text-xs text-[var(--fg-secondary)]">
                {selected.length === 0
                  ? t('createWebhook.selectedNone', 'Pick at least one event.')
                  : selected.length === 1
                    ? t('createWebhook.selectedOne', 'One event will be delivered.')
                    : t('createWebhook.selectedMany', '{{count}} events will be delivered.', {
                        count: selected.length,
                      })}
              </p>
            </div>
          </aside>

          <div className="flex justify-end gap-3 border-t border-[var(--border-subtle)] pt-4 lg:col-span-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('createWebhook.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={isPending || !url.trim() || selected.length === 0}>
              {isPending
                ? isEditing
                  ? t('createWebhook.saving', 'Saving...')
                  : t('createWebhook.creating', 'Creating...')
                : isEditing
                  ? t('createWebhook.saveSubscription', 'Save subscription')
                  : t('createWebhook.createSubscription', 'Create subscription')}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
