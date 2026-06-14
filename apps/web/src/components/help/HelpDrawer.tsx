// Slide-from-right shortcuts drawer. Opens via the topbar help button or
// by pressing `?` (unmodified) anywhere outside an input. Mirrors the
// "Help" sheets in GitHub, Linear, and Notion. Content is grouped by
// surface (Global, Navigation, Records) so a new user can read it
// top-to-bottom.

import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Icon } from '@/components/ui/Icon';
import { springModal } from '@/lib/motion';

import { useHelpDrawer } from './useHelpDrawer';

interface Shortcut {
  keys: string[];
  label: string;
}

function buildGroups(t: TFunction): Array<{ id: string; title: string; items: Shortcut[] }> {
  return [
    {
      id: 'Global',
      title: t('helpDrawer.groupGlobal', 'Global'),
      items: [
        { keys: ['Ctrl', 'K'], label: t('helpDrawer.openCommandPalette', 'Open command palette') },
        { keys: ['N'], label: t('helpDrawer.quickAddMenu', 'Quick-add menu') },
        { keys: ['?'], label: t('helpDrawer.openThisDrawer', 'Open this drawer') },
        { keys: ['Esc'], label: t('helpDrawer.closeCurrentDialog', 'Close current dialog') },
      ],
    },
    {
      id: 'Navigation',
      title: t('helpDrawer.groupNavigation', 'Navigation'),
      items: [
        { keys: ['G', 'D'], label: t('helpDrawer.goToDashboard', 'Go to Dashboard') },
        { keys: ['G', 'O'], label: t('helpDrawer.goToOpportunities', 'Go to Opportunities') },
        { keys: ['G', 'P'], label: t('helpDrawer.goToPipeline', 'Go to Pipeline') },
        { keys: ['G', 'C'], label: t('helpDrawer.goToContacts', 'Go to Contacts') },
        { keys: ['G', 'T'], label: t('helpDrawer.goToTasks', 'Go to Tasks') },
        { keys: ['G', 'R'], label: t('helpDrawer.goToReports', 'Go to Reports') },
        { keys: ['G', 'A'], label: t('helpDrawer.goToAccounts', 'Go to Accounts') },
        { keys: ['G', 'S'], label: t('helpDrawer.goToSettings', 'Go to Settings') },
        { keys: ['G', 'F'], label: t('helpDrawer.goToSearch', 'Go to Search') },
      ],
    },
    {
      id: 'Records',
      title: t('helpDrawer.groupRecords', 'Records'),
      items: [
        { keys: ['Up', 'Down'], label: t('helpDrawer.moveSelectionInLists', 'Move selection in lists') },
        { keys: ['Enter'], label: t('helpDrawer.openRecord', 'Open record') },
        { keys: ['E'], label: t('helpDrawer.editSelectedRecord', 'Edit selected record') },
        { keys: ['Del'], label: t('helpDrawer.deleteWithConfirmation', 'Delete with confirmation') },
      ],
    },
  ];
}

export function HelpDrawer() {
  const open = useHelpDrawer((s) => s.open);
  const setOpen = useHelpDrawer((s) => s.setOpen);
  const reduced = useReducedMotion();
  const { t } = useTranslation('common');
  const groups = buildGroups(t);

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
                className="fixed inset-0 z-40 bg-surface-overlay backdrop-blur-sm"
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
                    {t('helpDrawer.title', 'Keyboard shortcuts')}
                  </RadixDialog.Title>
                  <RadixDialog.Close
                    aria-label={t('helpDrawer.closeAria', 'Close shortcuts')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]"
                  >
                    <Icon name="close" size={16} />
                  </RadixDialog.Close>
                </header>

                <div className="space-y-5 p-5">
                  {groups.map((g) => (
                    <section key={g.id}>
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
                    {t(
                      'helpDrawer.footer',
                      'Most shortcuts work everywhere except inside text fields. Press ? any time to reopen this drawer.',
                    )}
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
