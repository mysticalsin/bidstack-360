/**
 * usePaletteItems — builds the full command-palette item list from all data
 * sources (contextual commands, recents, nav targets, accounts, contacts,
 * tasks, global search, opportunity search).
 *
 * Extracted from CommandPalette.tsx to keep the palette shell under the
 * 400-line file cap. Returns items + loading state + selectNavTarget so the
 * keyboard handler in PaletteBody can trigger direct nav without re-deriving
 * the navigate callback.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { CompanyLogo } from '@/components/company/CompanyLogo';
import { useCommandContextStore } from '@/hooks/useCommandContext';
import { useContacts } from '@/hooks/useContacts';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useTasks } from '@/hooks/useTasks';
import { api } from '@/lib/api';
import { getRecents, pushRecent, type RecentEntry } from '@/lib/palette-recents';
import { useAccountHistory } from '@/stores/accountHistory';
import type { OpportunityPage } from '@bidstack/shared';

import {
  ACCOUNT_RESULT_LIMIT,
  CONTACT_RESULT_LIMIT,
  TASK_RESULT_LIMIT,
  NAV_TARGETS,
  type Item,
  type NavTarget,
  matchCompanies,
  matchContacts,
  matchTasks,
  accountSubtitle,
  contactSubtitle,
  taskSubtitle,
} from './commandPaletteUtils';

export interface UsePaletteItemsResult {
  items: Item[];
  isFetching: boolean;
  selectNavTarget: (target: NavTarget) => void;
}

export function usePaletteItems(query: string, onClose: () => void): UsePaletteItemsResult {
  const navigate = useNavigate();
  const { t } = useTranslation('crm');

  // Snapshot recents at mount — stable while palette is open so items don't
  // shift as the user types (could change their index mid-selection).
  const [recents] = useState<RecentEntry[]>(() => getRecents());

  // Recently-visited accounts from the cockpit history store. Slice in memo
  // rather than in the selector — a selector that slices returns a new array
  // on every store read and triggers Zustand's "getSnapshot uncached" loop.
  const allRecents = useAccountHistory((s) => s.recents);
  const accountRecents = useMemo(() => allRecents.slice(0, 3), [allRecents]);

  // Debounce the query feeding the two SERVER searches so they fire once the
  // user pauses, not on every keystroke (was 2 network calls per character).
  // Local/in-memory filtering below keeps using the live `query` for instant
  // feedback.
  const debouncedQuery = useDebouncedValue(query, 200);

  const oppSearch = useQuery({
    enabled: debouncedQuery.trim().length >= 2,
    queryKey: ['palette:opps', debouncedQuery],
    queryFn: ({ signal }) =>
      api<OpportunityPage>(
        `/api/opportunities?search=${encodeURIComponent(debouncedQuery)}&limit=8`,
        { signal },
      ),
  });

  const globalSearch = useGlobalSearch(debouncedQuery);

  // Dashboard snapshot is already in React Query cache once the user has
  // visited the dashboard — effectively free here.
  const dashboard = useCrmDashboard();
  const companies = useMemo(() => dashboard.data?.companies ?? [], [dashboard.data?.companies]);

  // Contacts + tasks use the same hooks as their pages, so the palette
  // inherits cached data without extra fetches.
  const contacts = useContacts();
  const tasks = useTasks();

  // Contextual commands registered by the currently mounted page (A3 — Twenty
  // pattern). Appear at the top of the list so page-specific actions are
  // immediately reachable without scrolling.
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
    // Filtered by query when one is typed.
    for (const cmd of contextualCommands) {
      if (
        !q ||
        cmd.label.toLowerCase().includes(q) ||
        (cmd.hint?.toLowerCase().includes(q) ?? false)
      ) {
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

    // Palette-recents (user's previous palette selections). Shown when empty
    // query — Spotlight-style "continue where you left off".
    if (!q && recents.length > 0) {
      for (const r of recents) {
        out.push({
          id: `recent:${r.id}`,
          group: r.group,
          label: r.label,
          hint: r.hint ?? t('usePaletteItems.recentlyVisited', 'Recently visited'),
          onSelect: () => {
            navigate(r.route);
            onClose();
          },
        });
      }
    }

    // Cockpit-visit recents — accounts the user actually opened the cockpit
    // for (distinct from palette-recents). Join against companies for logo.
    if (!q && accountRecents.length > 0) {
      for (const acc of accountRecents) {
        const company = companies.find((c) => c.id === acc.slug);
        const route = `/accounts/${encodeURIComponent(acc.slug)}`;
        out.push({
          id: `recent-account:${acc.slug}`,
          group: 'account',
          label: acc.name,
          hint: t('usePaletteItems.recentlyVisited', 'Recently visited'),
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
        group: g.type,
        label: g.title,
        hint: g.subtitle,
        onSelect: () => {
          pushRecent({
            id: `search:${g.type}:${g.id}`,
            group: g.type,
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
    selectNavTarget,
    contextualCommands,
    t,
  ]);

  return { items, isFetching: oppSearch.isFetching, selectNavTarget };
}
