import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/Dialog';

interface Shortcut {
  keys: string;
  descriptionKey: string;
  descriptionDefault: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: '⌘K / Ctrl+K', descriptionKey: 'keyboardShortcutsHelp.commandPalette', descriptionDefault: 'Command palette' },
  { keys: '?', descriptionKey: 'keyboardShortcutsHelp.helpPanel', descriptionDefault: 'This help panel' },
  { keys: 'G then D', descriptionKey: 'keyboardShortcutsHelp.goToDashboard', descriptionDefault: 'Go to Dashboard' },
  { keys: 'G then O', descriptionKey: 'keyboardShortcutsHelp.goToOpportunities', descriptionDefault: 'Go to Opportunities' },
  { keys: 'G then P', descriptionKey: 'keyboardShortcutsHelp.goToPipeline', descriptionDefault: 'Go to Pipeline' },
  { keys: 'G then C', descriptionKey: 'keyboardShortcutsHelp.goToContacts', descriptionDefault: 'Go to Contacts' },
  { keys: 'G then T', descriptionKey: 'keyboardShortcutsHelp.goToTasks', descriptionDefault: 'Go to Tasks' },
  { keys: 'G then R', descriptionKey: 'keyboardShortcutsHelp.goToReports', descriptionDefault: 'Go to Reports' },
  { keys: 'G then S', descriptionKey: 'keyboardShortcutsHelp.goToSettings', descriptionDefault: 'Go to Settings' },
  { keys: 'Esc', descriptionKey: 'keyboardShortcutsHelp.closeDialog', descriptionDefault: 'Close any dialog/palette' },
];

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsHelp({ open, onOpenChange }: KeyboardShortcutsHelpProps) {
  const { t } = useTranslation('crm');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent
          title={t('keyboardShortcutsHelp.title', 'Keyboard shortcuts')}
          description={t('keyboardShortcutsHelp.description', 'Press the key combination to navigate quickly.')}
          className="w-[min(420px,92vw)]"
        >
          <dl className="space-y-2">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between gap-4 text-sm">
                <dt className="text-[var(--fg-secondary)]">{t(s.descriptionKey, s.descriptionDefault)}</dt>
                <dd>
                  <kbd className="whitespace-nowrap rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[11px] font-mono text-[var(--fg-primary)]">
                    {s.keys}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
