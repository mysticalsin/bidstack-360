import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { useHelpDrawer } from '@/components/help/useHelpDrawer';
import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { useSignOut, useUser } from '@/lib/auth';
import { useThemeStore } from '@/stores/theme';
import { useRecentSearches } from '@/stores/recentSearches';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

// Breadcrumb labels by first-path segment. Nested routes inherit their parent.
const CRUMB_LABELS: Record<string, string> = {
  dashboard: 'Portfolio',
  accounts: 'Accounts',
  opportunities: 'Opportunities',
  pipeline: 'Pipeline',
  contacts: 'Contacts',
  tasks: 'Tasks',
  reports: 'Reports',
  integrations: 'Integrations',
  'audit-log': 'Audit log',
  settings: 'Settings',
};

function useCrumbs(): { label: string; here: boolean }[] {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0];
  if (!root) return [{ label: 'Portfolio', here: true }];

  const rootLabel = CRUMB_LABELS[root] ?? capitalize(root);
  const second = segments[1];
  if (!second) {
    return [{ label: rootLabel, here: true }];
  }
  // Second segment is typically an id — show a generic "Detail" rather than
  // a raw UUID, until we wire per-record names through React Query cache.
  return [
    { label: rootLabel, here: false },
    { label: prettifySegment(second), here: true },
  ];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prettifySegment(s: string): string {
  if (/^[0-9a-f-]{12,}$/i.test(s)) return 'Detail';
  return capitalize(s.replace(/-/g, ' '));
}

export function Topbar() {
  useDocumentTitle();
  const crumbs = useCrumbs();
  const { theme, toggle } = useThemeStore();
  const { user } = useUser();
  const { signOut } = useSignOut();
  const navigate = useNavigate();
  const openHelp = useHelpDrawer((s) => s.setOpen);

  const seed = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Guest';

  return (
    <header className="topbar" role="banner">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <nav aria-label="Breadcrumb" className="crumbs">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className="crumbs-seg">
            {i > 0 && (
              <span className="sep" aria-hidden>
                /
              </span>
            )}
            <span
              className={c.here ? 'here' : undefined}
              aria-current={c.here ? 'page' : undefined}
            >
              {c.label}
            </span>
          </span>
        ))}
      </nav>

      <div className="tb-spacer" />

      <SearchBar />

      <Tooltip content={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
        <button
          type="button"
          onClick={toggle}
          className="iconbtn relative overflow-hidden"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-pressed={theme === 'dark'}
        >
          <AnimatedThemeIcon theme={theme} />
        </button>
      </Tooltip>

      <Tooltip content="Notifications coming soon">
        <button type="button" className="iconbtn" aria-label="Notifications (coming soon)" disabled>
          <Icon name="bell" size={16} ariaHidden />
        </button>
      </Tooltip>

      <Tooltip content="Help & shortcuts (?)">
        <button
          type="button"
          className="iconbtn"
          aria-label="Help and keyboard shortcuts"
          onClick={() => openHelp(true)}
        >
          <Icon name="help" size={16} ariaHidden />
        </button>
      </Tooltip>

      <div className="tb-user" title={user?.primaryEmailAddress?.emailAddress ?? ''}>
        <Avatar seed={seed} size={32} decorative className="av" />
        <div className="who">
          <div className="name">{user?.fullName ?? 'Guest'}</div>
          <div className="role">{user?.primaryEmailAddress?.emailAddress ?? 'Not signed in'}</div>
        </div>
        <button
          type="button"
          onClick={() => signOut(() => navigate('/login'))}
          className="tb-signout"
          aria-label="Sign out"
          title="Sign out"
        >
          ↩
        </button>
      </div>
    </header>
  );
}

// macOS Control-Center-style rotate-and-fade between sun and moon. The
// outgoing glyph rotates out while the incoming rotates in from the
// opposite direction; a slight scale on entry gives the "click landed"
// haptic. Reduced-motion users get a plain crossfade.
function AnimatedThemeIcon({ theme }: { theme: 'light' | 'dark' }) {
  const reduced = useReducedMotion();
  return (
    <span aria-hidden className="relative inline-flex h-4 w-4 items-center justify-center">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={theme}
          initial={reduced ? { opacity: 0 } : { opacity: 0, rotate: -90, scale: 0.6 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, rotate: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, rotate: 90, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          className="absolute inset-0 inline-flex items-center justify-center"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} ariaHidden />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function SearchBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const recents = useRecentSearches((s) => s.items);
  const pushRecent = useRecentSearches((s) => s.push);
  const clearRecents = useRecentSearches((s) => s.clear);

  const runSearch = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    pushRecent(trimmed);
    setQuery(trimmed);
    setOpen(false);
    navigate(`/opportunities?search=${encodeURIComponent(trimmed)}`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  return (
    <form onSubmit={onSubmit} className="tb-search relative" role="search">
      <Icon name="search" size={14} ariaHidden />
      <label htmlFor="tb-search-input" className="sr-only">
        Search opportunities, contacts, tasks
      </label>
      <input
        id="tb-search-input"
        type="search"
        placeholder="Search or jump to…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        // Delay the close so a click on a dropdown item lands before the
        // dropdown unmounts. 150ms is the standard browser delay.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      <kbd aria-hidden>⌘K</kbd>
      {open && !query && recents.length > 0 ? (
        <div
          role="listbox"
          aria-label="Recent searches"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-md)]"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            <span>Recent</span>
            <button
              type="button"
              onMouseDown={(e) => {
                // Use mousedown not click so it fires before the input's
                // blur tears the dropdown down.
                e.preventDefault();
                clearRecents();
              }}
              className="text-[10px] hover:text-[var(--fg-primary)]"
            >
              Clear
            </button>
          </div>
          <ul>
            {recents.map((r) => (
              <li key={r}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runSearch(r);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-sunken)]"
                >
                  {r}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
