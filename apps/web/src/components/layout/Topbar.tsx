import { useState } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '@/stores/theme';

export function Topbar() {
  const { theme, toggle } = useThemeStore();
  const { user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || 'U'
    : '??';

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 lg:px-6"
      role="banner"
    >
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:rounded-md focus-visible:bg-[var(--brand-primary)] focus-visible:px-3 focus-visible:py-1.5 focus-visible:text-white"
      >
        Skip to content
      </a>

      <div className="flex items-center gap-3 flex-1 max-w-md">
        <SearchBar />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-pressed={theme === 'dark'}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] transition-colors"
        >
          {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
        </button>

        <button
          type="button"
          aria-label="Notifications"
          disabled
          title="Coming soon"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] transition-colors opacity-50 cursor-not-allowed"
        >
          <BellIcon className="h-4 w-4" />
        </button>

        <div className="ml-2 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--surface-sunken)]">
          <div className="h-7 w-7 rounded-full bg-[var(--brand-primary)] text-white flex items-center justify-center text-xs font-semibold">
            {initials}
          </div>
          <div className="hidden md:flex flex-col leading-tight">
            <span className="text-xs font-medium text-[var(--fg-primary)]">
              {user?.fullName ?? 'Guest'}
            </span>
            <span className="text-[10px] text-[var(--fg-tertiary)]">
              {user?.primaryEmailAddress?.emailAddress ?? ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => signOut(() => navigate('/login'))}
            className="ml-1 text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--danger)] transition-colors"
            title="Sign out"
          >
            Exit
          </button>
        </div>
      </div>
    </header>
  );
}

function SearchBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/opportunities?search=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex-1">
      <span className="sr-only">Search opportunities, contacts, tasks</span>
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
        aria-hidden
      >
        ⌕
      </span>
      <input
        type="search"
        placeholder="Search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] py-1.5 pl-9 pr-12 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] hover:border-[var(--border-strong)] focus-visible:border-[var(--border-focus)] transition-colors"
      />
      <kbd
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)]"
        aria-hidden
      >
        ⌘K
      </kbd>
    </form>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
