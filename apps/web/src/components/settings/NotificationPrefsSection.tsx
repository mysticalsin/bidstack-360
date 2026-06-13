import { useCallback, useState } from 'react';
import { Card, SectionHeader } from '@/components/ui/Card';

interface NotificationPrefs {
  emailDigest: boolean;
  mentionPush: boolean;
  taskDueSoon: boolean;
  dealStageChange: boolean;
}

const STORAGE_KEY = 'bidstack:notifications';

function loadPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as NotificationPrefs;
  } catch {
    // ignore
  }
  return {
    emailDigest: true,
    mentionPush: true,
    taskDueSoon: true,
    dealStageChange: false,
  };
}

function savePrefs(prefs: NotificationPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode — silent */
  }
}

export function NotificationPrefsSection() {
  const [prefs, setPrefs] = useState(loadPrefs);

  const toggle = useCallback(
    (key: keyof NotificationPrefs) => {
      const next = { ...prefs, [key]: !prefs[key] };
      savePrefs(next);
      setPrefs(next);
      window.dispatchEvent(new Event('storage'));
    },
    [prefs],
  );

  const items: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
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

  return (
    <Card>
      <SectionHeader
        title="Notifications"
        caption="Choose which events trigger in-app alerts and emails."
      />
      <div className="p-5 space-y-4">
        {items.map((item) => (
          <label
            key={item.key}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-default)] p-3 hover:bg-[var(--surface-sunken)] transition-colors"
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--brand-primary)]"
              checked={prefs[item.key]}
              onChange={() => toggle(item.key)}
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-[var(--fg-primary)]">{item.label}</div>
              <div className="text-xs text-[var(--fg-secondary)]">{item.desc}</div>
            </div>
          </label>
        ))}
      </div>
    </Card>
  );
}
