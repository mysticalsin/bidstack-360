import { Dialog, DialogContent } from '@/components/ui/Dialog';

interface Shortcut {
  keys: string;
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: '⌘K / Ctrl+K', description: 'Command palette' },
  { keys: '?', description: 'This help panel' },
  { keys: 'G then D', description: 'Go to Dashboard' },
  { keys: 'G then O', description: 'Go to Opportunities' },
  { keys: 'G then P', description: 'Go to Pipeline' },
  { keys: 'G then C', description: 'Go to Contacts' },
  { keys: 'G then T', description: 'Go to Tasks' },
  { keys: 'G then R', description: 'Go to Reports' },
  { keys: 'G then S', description: 'Go to Settings' },
  { keys: 'Esc', description: 'Close any dialog/palette' },
];

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsHelp({ open, onOpenChange }: KeyboardShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent
          title="Keyboard shortcuts"
          description="Press the key combination to navigate quickly."
          className="w-[min(420px,92vw)]"
        >
          <dl className="space-y-2">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between gap-4 text-sm">
                <dt className="text-[var(--fg-secondary)]">{s.description}</dt>
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
