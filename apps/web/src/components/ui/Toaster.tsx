import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { springModal } from '@/lib/motion';
import { useUiSound } from '@/hooks/useUiSound';
import { useToastStore, type ToastItem, type ToastTone } from '@/components/ui/Toast';

export function Toaster() {
  const items = useToastStore((s) => s.items);
  const dismissAll = useToastStore((s) => s.dismissAll);
  const { t } = useTranslation('common');
  return (
    <div
      role="region"
      aria-label={t('toast.regionLabel', 'Notifications')}
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(384px,90vw)] flex-col gap-2"
    >
      {items.length >= 3 ? (
        <div className="pointer-events-auto flex justify-end">
          <button
            type="button"
            onClick={dismissAll}
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-secondary)] shadow-[var(--shadow-sm)] hover:text-[var(--fg-primary)]"
          >
            {t('toast.clearAll', 'Clear all ({{count}})', { count: items.length })}
          </button>
        </div>
      ) : null}
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </AnimatePresence>
    </div>
  );
}

const TONE_STYLE: Record<ToastTone, { bar: string; icon: string }> = {
  success: { bar: 'bg-[var(--success)]', icon: '✓' },
  error: { bar: 'bg-[var(--danger)]', icon: '⚠' },
  warning: { bar: 'bg-[var(--warning)]', icon: '!' },
  info: { bar: 'bg-[var(--brand-primary)]', icon: 'i' },
};

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const reduced = useReducedMotion();
  const play = useUiSound();
  const { t } = useTranslation('common');

  useEffect(() => {
    const handle = window.setTimeout(() => dismiss(item.id), item.duration);
    return () => window.clearTimeout(handle);
  }, [item.id, item.duration, dismiss]);

  useEffect(() => {
    if (item.tone === 'success') play('success');
    else if (item.tone === 'error' || item.tone === 'warning') play('error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const style = TONE_STYLE[item.tone];

  return (
    <motion.div
      role={item.tone === 'error' ? 'alert' : 'status'}
      layout
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.98 }}
      transition={springModal}
      className="pointer-events-auto overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] dark:border-[var(--border-glow-strong)]"
    >
      <div className="flex items-start gap-3 p-3 pl-4">
        <div
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--fg-on-brand)] text-xs font-bold ${style.bar}`}
          aria-hidden
        >
          {style.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--fg-primary)]">{item.title}</div>
          {item.description ? (
            <div className="mt-0.5 text-xs text-[var(--fg-secondary)]">{item.description}</div>
          ) : null}
        </div>
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action!.onClick();
              dismiss(item.id);
            }}
            className="ml-1 shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-[var(--brand-primary)] hover:bg-[var(--brand-primary-tint)]"
          >
            {item.action.label}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => dismiss(item.id)}
          aria-label={t('toast.dismiss', 'Dismiss')}
          className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]"
        >
          ×
        </button>
      </div>
    </motion.div>
  );
}
