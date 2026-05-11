import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { OpportunityPage } from '@bidstack/shared';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Item {
  id: string;
  group: 'navigate' | 'opportunity' | 'action';
  label: string;
  hint?: string;
  onSelect: () => void;
}

const NAV_TARGETS: Array<{ to: string; label: string; hint: string }> = [
  { to: '/dashboard', label: 'Go to Dashboard', hint: '⌘1' },
  { to: '/opportunities', label: 'Go to Opportunities', hint: '⌘2' },
  { to: '/pipeline', label: 'Go to Pipeline (kanban)', hint: '⌘3' },
  { to: '/contacts', label: 'Go to Contacts', hint: '⌘4' },
  { to: '/tasks', label: 'Go to Tasks', hint: '⌘5' },
  { to: '/reports', label: 'Go to Reports', hint: '⌘6' },
  { to: '/integrations', label: 'Go to Integrations', hint: '⌘7' },
  { to: '/settings', label: 'Go to Settings', hint: '⌘8' },
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--surface-overlay)] backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-[15vh] z-50 w-[min(560px,92vw)] -translate-x-1/2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          {/* PaletteBody mounts only while the dialog is open, so its state
              auto-resets on each open without a useEffect. */}
          {open ? <PaletteBody onClose={() => onOpenChange(false)} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const oppSearch = useQuery({
    enabled: query.trim().length >= 2,
    queryKey: ['palette:opps', query],
    queryFn: ({ signal }) =>
      api<OpportunityPage>(`/api/opportunities?search=${encodeURIComponent(query)}&limit=8`, {
        signal,
      }),
  });

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    const q = query.trim().toLowerCase();
    for (const n of NAV_TARGETS) {
      if (!q || n.label.toLowerCase().includes(q)) {
        out.push({
          id: `nav:${n.to}`,
          group: 'navigate',
          label: n.label,
          hint: n.hint,
          onSelect: () => {
            navigate(n.to);
            onClose();
          },
        });
      }
    }
    for (const o of oppSearch.data?.items ?? []) {
      out.push({
        id: `opp:${o.id}`,
        group: 'opportunity',
        label: `${o.code} — ${o.name}`,
        hint: o.customer,
        onSelect: () => {
          navigate(`/opportunities/${o.id}`);
          onClose();
        },
      });
    }
    return out;
  }, [query, oppSearch.data, navigate, onClose]);

  // Clamp active index when the items shrink (e.g. user typed a more specific
  // query). Compute the safe index inline rather than via a setState-in-effect.
  const safeIdx = items.length === 0 ? 0 : Math.min(activeIdx, items.length - 1);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="text-[var(--fg-tertiary)]" aria-hidden>
          ⌕
        </span>
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Re-anchor to the top of the new result set.
            setActiveIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIdx((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              items[safeIdx]?.onSelect();
            }
          }}
          placeholder="Search opportunities or jump to a page…"
          className="flex-1 bg-transparent text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none"
          aria-label="Search opportunities and pages"
          aria-autocomplete="list"
          aria-controls="cmdk-list"
        />
        <kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)]">
          esc
        </kbd>
      </div>

      <ul id="cmdk-list" role="listbox" className="max-h-[60vh] overflow-y-auto py-2">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-[var(--fg-tertiary)]">
            {oppSearch.isFetching ? 'Searching…' : 'No matches.'}
          </li>
        ) : null}
        {items.map((item, i) => {
          const active = i === safeIdx;
          return (
            <li
              key={item.id}
              role="option"
              aria-selected={active}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={item.onSelect}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 px-4 py-2 text-sm',
                active && 'bg-[var(--brand-primary-tint)]',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'text-[10px] font-mono uppercase tracking-wider',
                    active ? 'text-[var(--brand-primary)]' : 'text-[var(--fg-tertiary)]',
                  )}
                >
                  {item.group === 'opportunity' ? 'opp' : item.group}
                </span>
                <span
                  className={cn(
                    'truncate',
                    active ? 'text-[var(--brand-primary)] font-medium' : 'text-[var(--fg-primary)]',
                  )}
                >
                  {item.label}
                </span>
              </div>
              {item.hint ? (
                <span className="shrink-0 text-[10px] text-[var(--fg-tertiary)]">{item.hint}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
