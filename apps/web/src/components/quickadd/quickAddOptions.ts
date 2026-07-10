// Shared "New …" option config + selection logic for quick-add.
//
// WHY split out of QuickAddMenu.tsx: the command palette's ⌘K "Create" group
// needs the exact same entity list/labels/dialogs as the `N`-key picker so
// the two surfaces can never drift the way NAV_TARGETS drifted from
// navConfig.ts (the A5 defect this feature fixes). Both callers import this
// file instead of each hand-rolling their own option list.
import { useQuickAddStore, type QuickAddEntity } from '@/stores/quickAdd';

export type { QuickAddEntity };

export interface QuickAddOption {
  key: QuickAddEntity;
  label: string;
  hint: string;
  description: string;
}

// `key`/`hint` are logic values (map keys + keyboard shortcuts) and stay
// untranslated; only the prose `label`/`description` are externalized.
export function buildQuickAddOptions(
  t: (key: string, defaultValue: string) => string,
): QuickAddOption[] {
  return [
    {
      key: 'opportunity',
      label: t('quickAddMenu.option.opportunity.label', 'New opportunity'),
      hint: 'O',
      description: t('quickAddMenu.option.opportunity.description', 'Add a bid to the pipeline.'),
    },
    {
      key: 'task',
      label: t('quickAddMenu.option.task.label', 'New task'),
      hint: 'T',
      description: t(
        'quickAddMenu.option.task.description',
        'Create a follow-up, optionally linked to an opp.',
      ),
    },
    {
      key: 'contact',
      label: t('quickAddMenu.option.contact.label', 'New contact'),
      hint: 'C',
      description: t('quickAddMenu.option.contact.description', 'Add a decision-maker.'),
    },
    {
      key: 'note',
      label: t('quickAddMenu.option.note.label', 'New note'),
      hint: 'M',
      description: t(
        'quickAddMenu.option.note.description',
        'Drop a thought on the current account.',
      ),
    },
  ];
}

/**
 * Select a quick-add entity. Notes have no global dialog yet (they live
 * per-account) so they navigate directly; everything else mounts its dialog
 * via the shared store so QuickAddMenu.tsx — the single owner of those
 * dialogs — renders it. Shared between the `N` picker and the ⌘K "Create"
 * group so both funnel through the identical dialogs; no duplicate forms.
 */
export function chooseQuickAdd(entity: QuickAddEntity, navigate: (to: string) => void): void {
  useQuickAddStore.getState().setMenuOpen(false);
  if (entity === 'note') {
    navigate('/accounts/mantu');
    return;
  }
  useQuickAddStore.getState().setPick(entity);
}
