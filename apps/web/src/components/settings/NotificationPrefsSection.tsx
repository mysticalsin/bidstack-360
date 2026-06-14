import { Card, SectionHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
} from '@/hooks/useNotificationPrefs';
import type { NotificationPrefs } from '@bidstack/shared';

const ITEMS: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
  {
    key: 'emailDigest',
    label: 'Daily digest email',
    desc: 'A summary of your pipeline, tasks, and mentions every morning.',
  },
  {
    key: 'mentionPush',
    label: 'Mention notifications',
    desc: 'Get notified when someone @mentions you in a comment or note.',
  },
  {
    key: 'taskDueSoon',
    label: 'Task reminders',
    desc: 'Alert when a task is due within 24 hours.',
  },
  {
    key: 'dealStageChange',
    label: 'Deal stage changes',
    desc: 'Notify when an opportunity you own moves to a new stage.',
  },
];

export function NotificationPrefsSection() {
  const prefs = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();

  const toggle = (key: keyof NotificationPrefs) => {
    if (!prefs.data) return;
    update.mutate({ ...prefs.data, [key]: !prefs.data[key] });
  };

  return (
    <Card>
      <SectionHeader
        title="Notifications"
        caption="Choose which events trigger in-app alerts and emails. Saved to your account, so they follow you across devices."
      />
      <div className="p-5 space-y-4">
        {prefs.isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : prefs.isError ? (
          <ErrorState
            title="Couldn't load notification preferences"
            message="Your alerts are unaffected; the preference panel could not load."
            action={
              <Button size="sm" variant="secondary" onClick={() => void prefs.refetch()}>
                Retry
              </Button>
            }
          />
        ) : prefs.data ? (
          ITEMS.map((item) => (
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
          ))
        ) : null}
      </div>
    </Card>
  );
}
