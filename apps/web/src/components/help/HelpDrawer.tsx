// Slide-from-right shortcuts drawer. Opens via the topbar help button or
// by pressing `?` (unmodified) anywhere outside an input. Mirrors the
// "Help" sheets in GitHub, Linear, and Notion. Content is grouped by
// surface (Global, Navigation, Records) so a new user can read it
// top-to-bottom.

import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { springModal } from '@/lib/motion';

import { useHelpDrawer } from './useHelpDrawer';

interface Shortcut {
  keys: string[];
  label: string;
}

const GROUPS: Array<{ title: string; items: Shortcut[] }> = [
  {
    title: 'Global',
    items: [
      { keys: ['⌘', 'K'], label: 'Open command palette' },
      { keys: ['N'], label: 'Quick-add menu' },
      { keys: ['?'], label: 'Open this drawer' },
      { keys: ['⌘', '.'], label: 'Close any dialog' },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { keys: ['G', 'D'], label: 'Go to Dashboard' },
      { keys: ['G', 'O'], label: 'Go to Opportunities' },
      { keys: ['G', 'P'], label: 'Go to Pipeline' },
      { keys: ['G', 'C'], label: 'Go to Contacts' },
      { keys: ['G', 'T'], label: 'Go to Tasks' },
      { keys: ['G', 'R'], label: 'Go to Reports' },
      { keys: ['G', 'A'], label: 'Go to Accounts' },
      { keys: ['G', 'S'], label: 'Go to Settings' },
      { keys: ['G', 'F'], label: 'Go to Search' },
    ],
  },
  {
    title: 'Records',
    items: [
      { keys: ['↑', '↓'], label: 'Move selection in lists' },
      { keys: ['Enter'], label: 'Open record' },
      { keys: ['E'], label: 'Edit selected record' },
      { keys: ['⌫'], label: 'Delete (with confirmation)' },
    ],
  },
];

export function HelpDrawer() {
  const open = useHelpDrawer((s) => s.open);
  const setOpen = useHelpDrawer((s) => s.setOpen);
  const reduced = useReducedMotion();

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="fixed inset-0 z-40 bg-[var(--surface-overlay)] backdrop-blur-sm"
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.aside
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
                transition={springModal}
                className="fixed bottom-0 right-0 top-0 z-50 w-[min(420px,92vw)] overflow-y-auto border-l border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] outline-none"
              >
                <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
                  <RadixDialog.Title className="text-sm font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    Keyboard shortcuts
                  </RadixDialog.Title>
                  <RadixDialog.Close
                    aria-label="Close shortcuts"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]"
                  >
                    ×
                  </RadixDialog.Close>
                </header>

                <div className="space-y-5 p-5">
                  {GROUPS.map((g) => (
                    <section key={g.title}>
                      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                        {g.title}
                      </h3>
                      <ul className="space-y-1.5">
                        {g.items.map((item) => (
                          <li
                            key={item.label}
                            className="flex items-center justify-between gap-3 text-sm"
                          >
                            <span className="text-[var(--fg-primary)]">{item.label}</span>
                            <span className="flex items-center gap-1">
                              {item.keys.map((k, idx) => (
                                <kbd
                                  key={`${item.label}-${idx}`}
                                  className="rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]"
                                >
                                  {k}
                                </kbd>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}

                  <footer className="pt-2 text-[11px] text-[var(--fg-tertiary)]">
                    Most shortcuts work everywhere except inside text fields. The full list lives in
                    Settings → Shortcuts (coming soon).
                  </footer>
                </div>
              </motion.aside>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
