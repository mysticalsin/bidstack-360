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

import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
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

export const useToastStore = create<ToastStore>((set, get) => ({
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
