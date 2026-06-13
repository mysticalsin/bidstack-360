// Per-user "Customize layout" control for the account cockpit. Lets each user
// show/hide blocks (Tony's in-meeting commitment: "final version will allow
// choosing blocks per user"). Backed by the per-user useCockpitLayout store
// (localStorage, scoped by userId) — no server round-trip.
import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { COCKPIT_CARDS, useCockpitLayout } from '@/stores/cockpitLayout';

export function CockpitCustomizeMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visibleCards = useCockpitLayout((s) => s.visibleCards);
  const toggleCard = useCockpitLayout((s) => s.toggleCard);
  const resetLayout = useCockpitLayout((s) => s.resetLayout);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const hiddenCount = COCKPIT_CARDS.filter((c) => visibleCards[c.id] === false).length;
  const groups: { key: 'main' | 'side'; label: string }[] = [
    { key: 'main', label: 'Main column' },
    { key: 'side', label: 'Sidebar' },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="iconbtn relative inline-flex items-center gap-1.5 px-3 text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="sliders" size={15} ariaHidden />
        <span className="hidden sm:inline">Customize</span>
        {hiddenCount > 0 && (
          <span className="text-xs text-[var(--fg-tertiary)]">({hiddenCount} hidden)</span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Customize cockpit blocks"
          className="absolute right-0 top-[calc(100%+6px)] z-30 max-h-[70vh] w-72 overflow-y-auto rounded-lg glass-menu p-1.5"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
            <span className="text-sm font-semibold text-[var(--fg-primary)]">Show blocks</span>
            <button
              type="button"
              className="text-xs text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:underline"
              onClick={() => resetLayout()}
            >
              Reset
            </button>
          </div>
          {groups.map((g) => (
            <div key={g.key} className="px-1 py-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                {g.label}
              </p>
              {COCKPIT_CARDS.filter((c) => c.group === g.key).map((c) => {
                const checked = visibleCards[c.id] !== false;
                return (
                  <label
                    key={c.id}
                    className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-[var(--fg-primary)] transition-colors hover:bg-[var(--surface-hover)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCard(c.id)}
                      className="h-4 w-4 cursor-pointer accent-[var(--brand-primary)]"
                    />
                    {c.label}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
