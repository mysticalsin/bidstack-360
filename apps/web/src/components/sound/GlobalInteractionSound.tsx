import { useEffect } from 'react';

import { useUiSound } from '@/hooks/useUiSound';
import type { UiSoundKind } from '@/lib/soundEngine';

function isDisabled(element: Element): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return true;
  if (element instanceof HTMLButtonElement) return element.disabled;
  if (element instanceof HTMLInputElement) return element.disabled;
  if (element instanceof HTMLSelectElement) return element.disabled;
  return false;
}

function soundKindFor(element: Element): UiSoundKind {
  const role = element.getAttribute('role');
  if (
    role === 'tab' ||
    role === 'switch' ||
    role === 'menuitemcheckbox' ||
    role === 'menuitemradio'
  ) {
    return 'toggle';
  }

  if (element instanceof HTMLInputElement) {
    return element.type === 'checkbox' || element.type === 'radio' ? 'toggle' : 'click';
  }

  return 'click';
}

export function GlobalInteractionSound() {
  const play = useUiSound();

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const interactive = event.target.closest(
        'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], input[type="checkbox"], input[type="radio"], select, summary',
      );
      if (!interactive) return;
      if (interactive.closest('[data-ui-sound-handled="true"]')) return;
      if (isDisabled(interactive)) return;

      play(soundKindFor(interactive));
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [play]);

  return null;
}
