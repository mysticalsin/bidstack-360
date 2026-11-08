import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  NotificationChannel,
  NotificationChannelSettings,
  NotificationKindGroup,
} from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import {
  useClearTeamsWebhook,
  useNotificationChannels,
  useSaveTeamsWebhook,
  useTestTeamsWebhook,
  useUpdateNotificationChannels,
} from '@/hooks/useNotificationChannels';

const GROUPS: { key: NotificationKindGroup; label: string; desc: string }[] = [
  {
    key: 'account_activity',
    label: 'Account activity',
    desc: 'Notes, meetings, contacts and documents on accounts you follow',
  },
  { key: 'deals', label: 'Deals', desc: 'New deals, stage and owner changes' },
  { key: 'tasks', label: 'Tasks', desc: 'Tasks created or completed, and due reminders' },
  { key: 'mentions', label: 'Mentions', desc: 'When someone @mentions you' },
];

const CHANNELS: { key: NotificationChannel; label: string }[] = [
  { key: 'in_app', label: 'In-app' },
  { key: 'email', label: 'Email' },
  { key: 'teams', label: 'Teams' },
];

function TeamsWebhookBlock({ settings }: { settings: NotificationChannelSettings }) {
  const { t } = useTranslation('settings');
  const [url, setUrl] = useState('');
  const save = useSaveTeamsWebhook();
  const clear = useClearTeamsWebhook();
  const test = useTestTeamsWebhook();
  const { configured, host } = settings.teamsWebhook;

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-default)] p-3">
      <div>
        <div className="text-sm font-medium text-[var(--fg-primary)]">
          {t('notificationPrefs.teams.title', 'Microsoft Teams')}
        </div>
        <p className="text-xs text-[var(--fg-secondary)]">
          {t(
            'notificationPrefs.teams.help',
            'In Teams, create a Workflows flow "Post to a chat or channel when a webhook request is received", then paste its URL here. Polo sends alerts about your accounts only.',
          )}
        </p>
      </div>
      {configured ? (
        <p className="text-xs text-[var(--fg-secondary)]">
          {t('notificationPrefs.teams.saved', 'Saved webhook on')}{' '}
          <span className="font-medium text-[var(--fg-primary)]">{host}</span>
        </p>
      ) : null}
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          save.mutate(url.trim(), { onSuccess: () => setUrl('') });
        }}
      >
        <Input
          label={configured ? 'Replace webhook URL' : 'Webhook URL'}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={!url.trim() || save.isPending}>
          {t('notificationPrefs.teams.save', 'Save')}
        </Button>
      </form>
      {configured ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={test.isPending}
            onClick={() => test.mutate()}
          >
            {t('notificationPrefs.teams.test', 'Send test')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
          >
            {t('notificationPrefs.teams.remove', 'Remove')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function NotificationDeliverySection() {
  const { t } = useTranslation('settings');
  const channels = useNotificationChannels();
  const update = useUpdateNotificationChannels();

  if (channels.isLoading) return <LoadingSkeleton rows={3} />;
  if (!channels.data) return null;
  const settings = channels.data;

  const toggle = (group: NotificationKindGroup, channel: NotificationChannel) => {
    const groups = {
      ...settings.groups,
      [group]: { ...settings.groups[group], [channel]: !settings.groups[group][channel] },
    };
    update.mutate({ groups, dailyDigest: settings.dailyDigest });
  };

  return (
    <section aria-labelledby="notif-delivery-title" className="space-y-3">
      <div>
        <h3 id="notif-delivery-title" className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('notificationPrefs.delivery.title', 'Delivery')}
        </h3>
        <p className="text-xs text-[var(--fg-secondary)]">
          {t(
            'notificationPrefs.delivery.caption',
            'Where each kind of alert reaches you. Alerts are about Polo data for Polo users only.',
          )}
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--fg-secondary)]">
              <th scope="col" className="p-3 text-left font-medium">
                {t('notificationPrefs.delivery.kind', 'Alert')}
              </th>
              {CHANNELS.map((c) => (
                <th key={c.key} scope="col" className="w-20 p-3 text-center font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <tr key={g.key} className="border-b border-[var(--border-subtle)] last:border-0">
                <th scope="row" className="p-3 text-left font-normal">
                  <div className="font-medium text-[var(--fg-primary)]">{g.label}</div>
                  <div className="text-xs text-[var(--fg-secondary)]">{g.desc}</div>
                </th>
                {CHANNELS.map((c) => (
                  <td key={c.key} className="p-3 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${g.label}: ${c.label}`}
                      className="h-4 w-4 accent-[var(--brand-primary)]"
                      checked={settings.groups[g.key][c.key]}
                      onChange={() => toggle(g.key, c.key)}
                      disabled={update.isPending}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-default)] p-3 transition-colors hover:bg-[var(--surface-sunken)]">
        <input
          type="checkbox"
          className="mt-0.5 accent-[var(--brand-primary)]"
          checked={settings.dailyDigest}
          onChange={() =>
            update.mutate({ groups: settings.groups, dailyDigest: !settings.dailyDigest })
          }
          disabled={update.isPending}
        />
        <div className="flex-1">
          <div className="text-sm font-medium text-[var(--fg-primary)]">
            {t('notificationPrefs.delivery.digestLabel', 'Daily account digest email')}
          </div>
          <div className="text-xs text-[var(--fg-secondary)]">
            {t(
              'notificationPrefs.delivery.digestDesc',
              'One email a day with the account alerts you received.',
            )}
          </div>
        </div>
      </label>
      {settings.groups.account_activity.teams ||
      settings.groups.deals.teams ||
      settings.groups.tasks.teams ||
      settings.groups.mentions.teams ||
      settings.teamsWebhook.configured ? (
        <TeamsWebhookBlock settings={settings} />
      ) : null}
    </section>
  );
}
