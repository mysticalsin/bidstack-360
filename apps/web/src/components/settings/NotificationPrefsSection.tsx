import { useTranslation } from 'react-i18next';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useNotificationPrefs, useUpdateNotificationPrefs } from '@/hooks/useNotificationPrefs';
import type { NotificationPrefs } from '@bidstack/shared';

import { NotificationDeliverySection } from './NotificationDeliverySection';

type TFunc = (key: string, defaultValue: string) => string;

// emailDigest is stored and nothing sends it. It is not a switch on this page.
type LivePrefKey = 'mentionPush' | 'taskDueSoon' | 'dealStageChange';

const buildItems = (t: TFunc): { key: LivePrefKey; label: string; desc: string }[] => [
  {
    key: 'mentionPush',
    label: t('notificationPrefs.mentionPushLabel', 'Mention notifications'),
    desc: t(
      'notificationPrefs.mentionPushDesc',
      'Get notified when someone @mentions you in a comment or note.',
    ),
  },
  {
    key: 'taskDueSoon',
    label: t('notificationPrefs.taskDueSoonLabel', 'Task reminders'),
    desc: t('notificationPrefs.taskDueSoonDesc', 'Alert when a task is due within 24 hours.'),
  },
  {
    key: 'dealStageChange',
    label: t('notificationPrefs.dealStageChangeLabel', 'Deal stage changes'),
    desc: t(
      'notificationPrefs.dealStageChangeDesc',
      'Notify when an opportunity you own moves to a new stage.',
    ),
  },
];

export function NotificationPrefsSection() {
  const { t } = useTranslation('settings');
  const prefs = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const items = buildItems(t);

  const toggle = (key: LivePrefKey) => {
    if (!prefs.data) return;
    const next: NotificationPrefs = { ...prefs.data, [key]: !prefs.data[key] };
    update.mutate(next);
  };

  return (
    <Card>
      <SectionHeader
        title={t('notificationPrefs.title', 'Notifications')}
        caption={t(
          'notificationPrefs.caption',
          'Choose which events trigger in-app alerts and emails. Saved to your account, so they follow you across devices.',
        )}
      />
      <div className="p-5 space-y-4">
        {prefs.isLoading ? (
          <div
            aria-busy="true"
            aria-live="polite"
            aria-label={t('notificationPrefs.loading', 'Loading notification preferences')}
          >
            <LoadingSkeleton rows={4} />
          </div>
        ) : prefs.isError ? (
          <ErrorState
            title={t('notificationPrefs.errorTitle', "Couldn't load notification preferences")}
            message={t(
              'notificationPrefs.errorMessage',
              'Your alerts are unaffected; the preference panel could not load.',
            )}
            action={
              <Button size="sm" variant="secondary" onClick={() => void prefs.refetch()}>
                {t('notificationPrefs.retry', 'Retry')}
              </Button>
            }
          />
        ) : prefs.data ? (
          <>
            <div className="rounded-lg border border-[var(--border-default)] p-3">
              <div className="text-sm font-medium text-[var(--fg-primary)]">
                {t('notificationPrefs.emailDigestLabel', 'Daily digest email')}
              </div>
              <div className="text-xs text-[var(--fg-secondary)]">
                {t(
                  'notificationPrefs.emailDigestNotSent',
                  'Not sent. A morning summary of pipeline, tasks, and mentions is not delivered.',
                )}
              </div>
            </div>
            {items.map((item) => (
              <label
                key={item.key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-default)] p-3 hover:bg-[var(--surface-sunken)] transition-colors"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--brand-primary)]"
                  checked={prefs.data[item.key]}
                  onChange={() => toggle(item.key)}
                  disabled={update.isPending}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--fg-primary)]">{item.label}</div>
                  <div className="text-xs text-[var(--fg-secondary)]">{item.desc}</div>
                </div>
              </label>
            ))}
          </>
        ) : (
          <EmptyState
            title={t('notificationPrefs.emptyTitle', 'Notification preferences are not loaded')}
            message={t(
              'notificationPrefs.emptyMessage',
              'The preference panel has no saved settings to show.',
            )}
            action={
              <Button size="sm" variant="secondary" onClick={() => void prefs.refetch()}>
                {t('notificationPrefs.retry', 'Retry')}
              </Button>
            }
          />
        )}
        <NotificationDeliverySection />
      </div>
    </Card>
  );
}
