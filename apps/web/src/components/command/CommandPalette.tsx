import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { CompanyLogo } from '@/components/company/CompanyLogo';
import { useCommandContextStore } from '@/hooks/useCommandContext';
import { useContacts } from '@/hooks/useContacts';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useTasks } from '@/hooks/useTasks';
import { useAgents } from '@/hooks/useAgents';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { springModal } from '@/lib/motion';
import { getRecents, pushRecent, type RecentEntry } from '@/lib/palette-recents';
import { useAccountHistory } from '@/stores/accountHistory';
import type { Contact, CrmCompany, OpportunityPage, Task } from '@bidstack/shared';

// Caps per section keep the palette scannable on large tenants. The bigger
// concern than total length is *section dominance* — one big section
// drowning the others — so we cap each independently.
const ACCOUNT_RESULT_LIMIT = 6;
const CONTACT_RESULT_LIMIT = 6;
const TASK_RESULT_LIMIT = 6;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Item {
  id: string;
  group:
    | 'navigate'
    | 'opportunity'
    | 'account'
    | 'contact'
    | 'task'
    | 'action'
    | 'company'
    | 'note'
    | 'sales_order'
    | 'invoice'
    | 'agent';
  label: string;
  hint?: string;
  // Optional leading visual (e.g. CompanyLogo for account rows). Group label
  // is suppressed when this is set so the icon carries the group affordance.
  leading?: ReactNode;
  onSelect: () => void;
}

type NavTarget = { to: string; label: string; hint: string };

const NAV_TARGETS: NavTarget[] = [
  { to: '/dashboard', label: 'Go to Dashboard', hint: '⌘1' },
  { to: '/accounts', label: 'Go to Accounts', hint: '⌘A' },
  { to: '/opportunities', label: 'Go to Opportunities', hint: '⌘2' },
  { to: '/pipeline', label: 'Go to Pipeline (kanban)', hint: '⌘3' },
  { to: '/contacts', label: 'Go to Contacts', hint: '⌘4' },
  { to: '/tasks', label: 'Go to Tasks', hint: '⌘5' },
  { to: '/reports', label: 'Go to Reports', hint: '⌘6' },
  { to: '/integrations', label: 'Go to Integrations', hint: '⌘7' },
  { to: '/audit-log', label: 'Go to Audit log', hint: '⌘L' },
  { to: '/settings', label: 'Go to Settings', hint: '⌘8' },
  { to: '/search', label: 'Search across workspace', hint: '⌘9' },
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const reduced = useReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-40 bg-surface-overlay backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -8 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4 }}
                transition={springModal}
                className="fixed left-1/2 top-[15vh] z-50 w-[min(560px,92vw)] -translate-x-1/2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] outline-none"
              >
                <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                <PaletteBody onClose={() => onOpenChange(false)} />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryRef = useRef('');
  // Snapshot recents at mount — we don't want them shifting around while
  // the palette is open (the user might select an item that's now at a
  // different index than when they started typing).
  const [recents] = useState<RecentEntry[]>(() => getRecents());
  // Recently-visited accounts from the cockpit history store. Distinct
  // from palette-recents (which tracks palette selections) — these come
  // from actually opening an account view. Show top 3 so we don't crowd
  // the empty-query state. We subscribe to the *whole* recents array
  // (stable reference unless the store actually changes) and slice in a
  // memo — slicing inside the selector would return a fresh array on
  // every store read and trigger Zustand's "getSnapshot uncached" loop.
  const allRecents = useAccountHistory((s) => s.recents);
  const accountRecents = useMemo(() => allRecents.slice(0, 3), [allRecents]);
  const listRef = useRef<HTMLUListElement | null>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus();
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const oppSearch = useQuery({
    enabled: query.trim().length >= 2,
    queryKey: ['palette:opps', query],
    queryFn: ({ signal }) =>
      api<OpportunityPage>(`/api/opportunities?search=${encodeURIComponent(query)}&limit=8`, {
        signal,
      }),
  });

  const globalSearch = useGlobalSearch(query);

  // Dashboard snapshot is already in the React Query cache once the user has
  // visited the dashboard, so this hook is effectively free here.
  const dashboard = useCrmDashboard();
  const companies = useMemo(() => dashboard.data?.companies ?? [], [dashboard.data?.companies]);

  // Contacts + tasks are listed via the same hooks the pages use, so the
  // palette inherits their cache state without re-fetching when the user
  // has already opened those pages.
  const contacts = useContacts();
  const tasks = useTasks();
  const agents = useAgents();
  // Contextual commands registered by the currently mounted page (A3 — Twenty pattern).
  // These appear at the top of the list (above nav) so page-specific actions are
  // immediately reachable without scrolling or querying.
  const contextualCommands = useCommandContextStore((s) => s.commands);

  const selectNavTarget = useCallback(
    (target: NavTarget) => {
      pushRecent({
        id: `nav:${target.to}`,
        group: 'navigate',
        label: target.label,
        hint: target.hint,
        route: target.to,
      });
      navigate(target.to);
      onClose();
    },
    [navigate, onClose],
  );

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    const q = query.trim().toLowerCase();

    // Contextual commands from the active page (e.g. "Create task for this opp").
    // Shown at the very top — before recents — so they are immediately reachable.
    // Filtered by query when one is typed.
    for (const cmd of contextualCommands) {
      if (!q || cmd.label.toLowerCase().includes(q) || (cmd.hint?.toLowerCase().includes(q) ?? false)) {
        out.push({
          id: `ctx:${cmd.id}`,
          group: 'action',
          label: cmd.label,
          hint: cmd.hint,
          onSelect: () => {
            cmd.onSelect();
            onClose();
          },
        });
      }
    }

    // When the query is empty and the user has a history, show recents at
    // the very top of the list — Spotlight/macOS-style "continue where you
    // left off" surface.
    if (!q && recents.length > 0) {
      for (const r of recents) {
        out.push({
          id: `recent:${r.id}`,
          group: r.group,
          label: r.label,
          hint: r.hint ?? 'Recently visited',
          onSelect: () => {
            navigate(r.route);
            onClose();
          },
        });
      }
    }
    // Cockpit-visit recents. Distinct from palette-recents — these are
    // accounts the user actually opened the cockpit for, not just navigated
    // to via the palette. Joining against `companies` lets us reuse the
    // CompanyLogo affordance when the company is known.
    if (!q && accountRecents.length > 0) {
      for (const acc of accountRecents) {
        const company = companies.find((c) => c.id === acc.slug);
        const route = `/accounts/${encodeURIComponent(acc.slug)}`;
        out.push({
          id: `recent-account:${acc.slug}`,
          group: 'account',
          label: acc.name,
          hint: 'Recently visited',
          leading: company ? (
            <CompanyLogo
              name={company.name}
              logo={company.logo}
              domain={company.domain}
              size={18}
            />
          ) : undefined,
          onSelect: () => {
            navigate(route);
            onClose();
          },
        });
      }
    }
    for (const n of NAV_TARGETS) {
      if (!q || n.label.toLowerCase().includes(q)) {
        out.push({
          id: `nav:${n.to}`,
          group: 'navigate',
          label: n.label,
          hint: n.hint,
          onSelect: () => selectNavTarget(n),
        });
      }
    }
    for (const c of matchCompanies(companies, q, ACCOUNT_RESULT_LIMIT)) {
      const route = `/accounts/${encodeURIComponent(c.id)}`;
      const subtitle = accountSubtitle(c);
      out.push({
        id: `account:${c.id}`,
        group: 'account',
        label: c.name,
        hint: subtitle,
        leading: <CompanyLogo name={c.name} logo={c.logo} domain={c.domain} size={18} />,
        onSelect: () => {
          pushRecent({
            id: `account:${c.id}`,
            group: 'account',
            label: c.name,
            ...(subtitle ? { hint: subtitle } : {}),
            route,
          });
          navigate(route);
          onClose();
        },
      });
    }
    for (const p of matchContacts(contacts.data?.items ?? [], q, CONTACT_RESULT_LIMIT)) {
      const route = `/contacts?search=${encodeURIComponent(p.name)}`;
      const subtitle = contactSubtitle(p);
      out.push({
        id: `contact:${p.id}`,
        group: 'contact',
        label: p.name,
        hint: subtitle,
        onSelect: () => {
          pushRecent({
            id: `contact:${p.id}`,
            group: 'contact',
            label: p.name,
            ...(subtitle ? { hint: subtitle } : {}),
            route,
          });
          navigate(route);
          onClose();
        },
      });
    }
    for (const t of matchTasks(tasks.data?.items ?? [], q, TASK_RESULT_LIMIT)) {
      const route = `/tasks?search=${encodeURIComponent(t.title)}`;
      const subtitle = taskSubtitle(t);
      out.push({
        id: `task:${t.id}`,
        group: 'task',
        label: t.title,
        hint: subtitle,
        onSelect: () => {
          pushRecent({
            id: `task:${t.id}`,
            group: 'task',
            label: t.title,
            ...(subtitle ? { hint: subtitle } : {}),
            route,
          });
          navigate(route);
          onClose();
        },
      });
    }
    for (const g of globalSearch.data?.items ?? []) {
      out.push({
        id: `search:${g.type}:${g.id}`,
        group: g.type === 'sales_order' ? 'opportunity' : g.type,
        label: g.title,
        hint: g.subtitle,
        onSelect: () => {
          pushRecent({
            id: `search:${g.type}:${g.id}`,
            group: g.type === 'sales_order' ? 'opportunity' : g.type,
            label: g.title,
            hint: g.subtitle,
            route: g.url,
          });
          navigate(g.url);
          onClose();
        },
      });
    }
    for (const o of oppSearch.data?.items ?? []) {
      const route = `/opportunities/${o.id}`;
      out.push({
        id: `opp:${o.id}`,
        group: 'opportunity',
        label: `${o.code} — ${o.name}`,
        hint: o.customer,
        onSelect: () => {
          pushRecent({
            id: `opp:${o.id}`,
            group: 'opportunity',
            label: `${o.code} — ${o.name}`,
            hint: o.customer,
            route,
          });
          navigate(route);
          onClose();
        },
      });
    }
    for (const a of agents.data?.items ?? []) {
      if (
        !q ||
        a.name.toLowerCase().includes(q) ||
        (a.description?.toLowerCase().includes(q) ?? false)
      ) {
        const route = `/agents`;
        out.push({
          id: `agent:${a.id}`,
          group: 'agent',
          label: `Run ${a.name}`,
          hint: a.description ?? 'Agent',
          onSelect: () => {
            pushRecent({
              id: `agent:${a.id}`,
              group: 'agent',
              label: `Run ${a.name}`,
              hint: a.description ?? 'Agent',
              route,
            });
            navigate(route);
            onClose();
          },
        });
      }
    }
    return out;
  }, [
    query,
    companies,
    oppSearch.data,
    globalSearch.data,
    contacts.data?.items,
    tasks.data?.items,
    navigate,
    onClose,
    recents,
    accountRecents,
    agents.data?.items,
    selectNavTarget,
    contextualCommands,
  ]);

  // Auto-scroll the active row into view when arrowing through long result
  // lists. Defer to next frame so the DOM has settled with the new active
  // class before we measure.
  useEffect(() => {
    if (!listRef.current) return;
    const safe = items.length === 0 ? 0 : Math.min(activeIdx, items.length - 1);
    const node = listRef.current.querySelector<HTMLElement>(`[data-cmdk-idx="${safe}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, items.length]);

  // Clamp active index when the items shrink (e.g. user typed a more specific
  // query). Compute the safe index inline rather than via a setState-in-effect.
  const safeIdx = items.length === 0 ? 0 : Math.min(activeIdx, items.length - 1);

  // Activate the focused item with Enter or Space. The parent search input
  // already handles arrow navigation; this handler is for screen-reader users
  // who arrow directly into the listbox via voiceover/jaws gestures.
  const handleItemKeyDown = (e: KeyboardEvent<HTMLLIElement>, item: Item) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      item.onSelect();
    }
  };

  const appendQueryCharacter = useCallback((key: string) => {
    inputRef.current?.focus();
    setQuery((prev) => {
      const next = `${prev}${key}`;
      queryRef.current = next;
      return next;
    });
    setActiveIdx(0);
  }, []);

  useEffect(() => {
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.target === inputRef.current) return;
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
      appendQueryCharacter(event.key);
      event.preventDefault();
    };

    document.addEventListener('keydown', handleDocumentKeyDown, true);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown, true);
  }, [appendQueryCharacter]);

  const handlePaletteKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    if (e.target === inputRef.current) return;
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    appendQueryCharacter(e.key);
    e.preventDefault();
  };

  return (
    <div onKeyDown={handlePaletteKeyDown}>
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="text-[var(--fg-tertiary)]" aria-hidden>
          ⌕
        </span>
        <input
          ref={inputRef}
          role="combobox"
          autoFocus
          type="search"
          value={query}
          onChange={(e) => {
            const nextQuery = e.currentTarget.value;
            queryRef.current = nextQuery;
            setQuery(nextQuery);
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
              const directRoute = findDirectNavTarget(queryRef.current || e.currentTarget.value);
              if (directRoute) {
                selectNavTarget(directRoute);
                return;
              }
              items[safeIdx]?.onSelect();
            }
          }}
          placeholder="Search accounts, contacts, tasks, opportunities…"
          className="flex-1 bg-transparent text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none"
          aria-label="Search across the CRM"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={items.length ? `cmdk-option-${safeIdx}` : undefined}
        />
        <kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)]">
          esc
        </kbd>
      </div>

      <ul ref={listRef} id="cmdk-list" role="listbox" className="max-h-[60vh] overflow-y-auto py-2">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-[var(--fg-tertiary)]">
            {oppSearch.isFetching ? 'Searching…' : 'No matches.'}
          </li>
        ) : null}
        {items.map((item, i) => {
          const active = i === safeIdx;
          return (
            <li
              id={`cmdk-option-${i}`}
              key={item.id}
              data-cmdk-idx={i}
              role="option"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={item.onSelect}
              onKeyDown={(e) => handleItemKeyDown(e, item)}
              // min-h-11 keeps touch targets ≥ 44px (WCAG 2.5.5 AA);
              // the active row also gets a tinted background.
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm',
                active && 'bg-[var(--brand-primary-tint)]',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                {item.leading ? (
                  <span className="shrink-0" aria-hidden>
                    {item.leading}
                  </span>
                ) : (
                  <span
                    className={cn(
                      'text-[10px] font-mono uppercase tracking-wider',
                      active ? 'text-[var(--brand-primary)]' : 'text-[var(--fg-tertiary)]',
                    )}
                  >
                    {groupTag(item.group)}
                  </span>
                )}
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
    </div>
  );
}

// Substring match across name / legalName / domain. Cheap and predictable —
// no fuzzy lib dependency, which is overkill for the dashboard's company list.
function matchCompanies(companies: CrmCompany[], q: string, limit: number): CrmCompany[] {
  if (!q) return companies.slice(0, limit);
  const out: CrmCompany[] = [];
  for (const c of companies) {
    const haystack = [c.name, c.legalName ?? '', c.domain ?? ''].join('\n').toLowerCase();
    if (haystack.includes(q)) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

function matchContacts(contacts: Contact[], q: string, limit: number): Contact[] {
  if (!q) return [];
  const out: Contact[] = [];
  for (const c of contacts) {
    const haystack = [c.name, c.email ?? '', c.role ?? '', c.customer].join('\n').toLowerCase();
    if (haystack.includes(q)) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

function matchTasks(tasks: Task[], q: string, limit: number): Task[] {
  if (!q) return [];
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.title.toLowerCase().includes(q)) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

function accountSubtitle(c: CrmCompany): string | undefined {
  const parts = [c.industry, c.domain].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(' · ') : undefined;
}

function contactSubtitle(c: Contact): string | undefined {
  const parts = [c.role, c.customer].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(' · ') : undefined;
}

function taskSubtitle(t: Task): string | undefined {
  return t.dueDate ? `Due ${t.dueDate} · ${t.status}` : t.status;
}

function findDirectNavTarget(query: string): NavTarget | undefined {
  const normalized = normalizeNavQuery(query);
  if (!normalized) return undefined;
  return NAV_TARGETS.find((target) => {
    const label = normalizeNavQuery(
      target.label
        .replace(/^go to\s+/i, '')
        .replace(/\([^)]*\)/g, '')
        .trim(),
    );
    const route = normalizeNavQuery(target.to.replace(/^\//, ''));
    return normalized === label || normalized === route;
  });
}

function normalizeNavQuery(value: string) {
  return value.trim().toLowerCase();
}

function groupTag(group: Item['group']): string {
  if (group === 'opportunity') return 'opp';
  if (group === 'account') return 'acct';
  if (group === 'contact') return 'who';
  if (group === 'task') return 'todo';
  if (group === 'agent') return 'agent';
  return group;
}
