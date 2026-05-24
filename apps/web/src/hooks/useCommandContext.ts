// Contextual command registration for the command palette (Cmd+K).
//
// WHY: Twenty's command menu shows actions that change depending on which
// record page is open. We adapt the concept: any mounted page can push a set
// of contextual actions into the palette while it is rendered; they are
// removed automatically on unmount.
//
// Usage (inside a page component):
//
//   useCommandContext([
//     { id: 'create-task', label: 'Create task for this opportunity', onSelect: () => openTaskDialog() },
//     { id: 'export-csv',  label: 'Export this opportunity to CSV',   onSelect: () => handleExport() },
//   ]);
//
// The palette reads `useCommandContextStore` to inject these items into the
// 'action' group before the global items.

import { useEffect } from 'react';
import { create } from 'zustand';

export interface ContextualCommand {
  /** Stable identifier (must be unique within the page's set) */
  id: string;
  label: string;
  hint?: string;
  onSelect: () => void;
}

interface CommandContextState {
  commands: ContextualCommand[];
  /** Pages call this to push their commands (mount). Returns a cleanup fn. */
  register: (cmds: ContextualCommand[]) => () => void;
}

// Registered command sets, keyed by registration token (monotonic counter).
const registrations = new Map<number, ContextualCommand[]>();
let seq = 0;

export const useCommandContextStore = create<CommandContextState>((set) => ({
  commands: [],

  register: (cmds) => {
    const token = ++seq;
    registrations.set(token, cmds);
    const flat = Array.from(registrations.values()).flat();
    set({ commands: flat });

    return () => {
      registrations.delete(token);
      const next = Array.from(registrations.values()).flat();
      set({ commands: next });
    };
  },
}));

/**
 * Register contextual commands for the duration of the calling component's
 * life. Commands are automatically removed when the component unmounts.
 *
 * Pass a stable array reference or wrap in useMemo to avoid re-registering
 * on every render.
 */
export function useCommandContext(commands: ContextualCommand[]): void {
  const register = useCommandContextStore((s) => s.register);

  useEffect(() => {
    // Avoid registering an empty set — keeps the store clean.
    if (commands.length === 0) return;
    const cleanup = register(commands);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, commands.length]);
}
