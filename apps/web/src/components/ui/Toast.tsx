// Apple-style toast system. Replaces ad-hoc alert() calls with a non-blocking
// stack of cards that fade+slide in from the bottom-right, auto-dismiss
// after a few seconds, and respect prefers-reduced-motion.
//
// Design:
// - One global Zustand store, one <Toaster /> portal at the root.
// - Public API: `toast.success(msg)`, `toast.error(msg)`, `toast.info(msg)`.
// - Each toast carries its own dismiss timer; users can also click to clear.
// - Stack is bounded to 5 — additions past that drop the oldest, matching
//   macOS Notification Center behavior.

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';

import { springModal } from '@/lib/motion';
import { useUiSound } from '@/hooks/useUiSound';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  duration: number;
  /** Optional action button — used for "Undo" on destructive ops. */
  action?: { label: string; onClick: () => void };
}

interface ToastStore {
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const useToastStore = create<ToastStore>((set, get) => ({
  items: [],
  push: (t) => {
    // Dedupe: if the same title+tone is already on screen, refresh that
    // toast's id (resets its dismiss timer) rather than stacking duplicates.
    // Prevents the "saved · saved · saved" pile during rapid edits.
    const dup = get().items.find((i) => i.title === t.title && i.tone === t.tone);
    if (dup) {
      // Bumping the id forces the ToastCard's useEffect to re-run with a
      // fresh timeout, which mirrors what users expect ("you just told me
      // that, fine, I'll wait longer").
      const id = crypto.randomUUID();
      set((s) => ({
        items: s.items.map((i) => (i.id === dup.id ? { ...i, ...t, id } : i)),
      }));
      return id;
    }
    const id = crypto.randomUUID();
    set((s) => {
      const next = [...s.items, { ...t, id }];
      // Bound the stack at 5; drop the oldest to make room.
      return { items: next.slice(-5) };
    });
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  dismissAll: () => set({ items: [] }),
}));

interface ToastInput {
  description?: string;
  /** Auto-dismiss in ms. Defaults: success/info 3500, warning 5000, error 6500. */
  duration?: number;
  /** Inline action button — typically "Undo" for destructive ops. */
  action?: { label: string; onClick: () => void };
}

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 3500,
  info: 3500,
  warning: 5000,
  error: 6500,
};

function show(tone: ToastTone, title: string, opts?: ToastInput): string {
  return useToastStore.getState().push({
    tone,
    title,
    description: opts?.description,
    duration: opts?.duration ?? DEFAULT_DURATION[tone],
    action: opts?.action,
  });
}

export const toast = {
  success: (title: string, opts?: ToastInput) => show('success', title, opts),
  error: (title: string, opts?: ToastInput) => show('error', title, opts),
  info: (title: string, opts?: ToastInput) => show('info', title, opts),
  warning: (title: string, opts?: ToastInput) => show('warning', title, opts),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};

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
      {/* Clear-all chip — only shown once the stack gets dense enough to
          benefit from a one-click clear. Three is the threshold where the
          stack starts to feel "in the way" rather than informative. */}
      {items.length >= 3 ? (
        <div className="pointer-events-auto flex justify-end">
          <button
            type="button"
            onClick={dismissAll}
            className="rounded-md dark:rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-secondary)] shadow-[var(--shadow-sm)] hover:text-[var(--fg-primary)] dark:bg-[var(--surface-glass)] dark:backdrop-blur-md"
          >
            {t('toast.clearAll', 'Clear all ({{count}})', { count: items.length })}
          </button>
        </div>
      ) : null}
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <ToastCard key={t.id} item={t} />
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

  // Audible confirmation when a toast appears — a rising chime for success, a
  // low two-note for error/warning. Keyed on item.id so it plays once per toast,
  // not again if the volume changes while it is on screen.
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
      className="pointer-events-auto overflow-hidden rounded-xl dark:rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] dark:bg-[var(--surface-glass)] dark:backdrop-blur-xl dark:border-[var(--border-glow-strong)]"
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
