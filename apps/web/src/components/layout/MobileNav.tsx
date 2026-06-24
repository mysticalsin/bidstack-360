// Mobile navigation drawer — full-screen overlay that replaces the sidebar
// on viewports below the md breakpoint. Opens via hamburger in the topbar
// and closes on link selection, backdrop tap, or Escape.

import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useUiStore } from '@/stores/ui';
import { useAccountHistory } from '@/stores/accountHistory';
import { useIsAdmin } from '@/lib/auth';
import { useOpportunityCount } from '@/hooks/useOpportunities';
import { useTaskSummary } from '@/hooks/useTasks';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { prefetchRoute } from '@/lib/prefetch';

import { useAppModules } from '@/hooks/useAppModules';
import { ADMIN_SETTINGS, MEMBER_SETTINGS, NAV_SECTIONS, isNavItemVisible, type NavItem, type NavSection } from './navConfig';

export function MobileNav() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);

  // Lock body scroll while open.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      document.body.style.pointerEvents = 'auto';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.pointerEvents = 'auto';
    };
  }, [open]);

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="mobile-nav-backdrop" />
        <RadixDialog.Content
          aria-describedby={undefined}
          id="mobile-nav-drawer"
          className="mobile-nav-drawer"
        >
          <RadixDialog.Title className="sr-only">Primary navigation</RadixDialog.Title>
          <MobileNavContent onClose={() => setOpen(false)} />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function MobileNavContent({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common');
  const oppsCount = useOpportunityCount({ excludeClosed: true });
  const taskSummary = useTaskSummary();
  const isAdmin = useIsAdmin();
  const recents = useAccountHistory((s) => s.recents);
  const favorites = useAccountHistory((s) => s.favorites);

  const openBids = oppsCount.data?.count ?? 0;
  const overdueTasks = taskSummary.data?.overdue ?? 0;

  const badges = { openBids, overdueTasks };
  const { data: appModules } = useAppModules();
  const sections = NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((it) => isNavItemVisible(it, appModules)),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header with close */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="sb-mark" aria-hidden>
            B
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--fg-primary)] leading-tight">
              BidStack 360
            </span>
            <span className="text-[10px] text-[var(--fg-tertiary)] font-normal leading-tight">
              Creator: Tony
            </span>
          </div>
        </div>
        <button type="button" onClick={onClose} className="iconbtn" aria-label="Close navigation">
          <Icon name="close" size={18} ariaHidden />
        </button>
      </div>

      {/* Scrollable nav */}
      <nav
        aria-label="Primary navigation"
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2"
      >
        {sections.map((section) => (
          <MobileNavSection key={section.key} section={section} badges={badges} onNavigate={onClose} />
        ))}

        {favorites.length > 0 && (
          <NavGroup title={t('nav.starred', 'Starred')}>
            {favorites.map((acc) => (
              <MobileAccountItem key={acc.slug} acc={acc} onNavigate={onClose} />
            ))}
          </NavGroup>
        )}

        {recents.length > 0 && (
          <NavGroup title={t('nav.recent', 'Recent')}>
            {recents.slice(0, 5).map((acc) => (
              <MobileAccountItem key={acc.slug} acc={acc} onNavigate={onClose} />
            ))}
          </NavGroup>
        )}

        <NavGroup title={t('nav.settings', 'Settings')}>
          {(isAdmin ? ADMIN_SETTINGS : MEMBER_SETTINGS).map((item) => (
            <MobileNavItem key={item.to} item={item} badges={badges} onNavigate={onClose} />
          ))}
        </NavGroup>
      </nav>
    </div>
  );
}

function NavGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {title}
      </div>
      {children}
    </div>
  );
}

// Collapsible primary section (accordion, mirrors the desktop sidebar):
// collapsed by default unless it holds the active route; the user's tap is
// persisted. Keeps the mobile drawer tidy and reachable without long scrolls.
function MobileNavSection({
  section,
  badges,
  onNavigate,
}: {
  section: NavSection;
  badges: { openBids: number; overdueTasks: number };
  onNavigate: () => void;
}) {
  const location = useLocation();
  const { t } = useTranslation('common');
  const override = useUiStore((s) => s.collapsedSections[section.key]);
  const setSectionCollapsed = useUiStore((s) => s.setSectionCollapsed);
  const isActive = section.items.some(
    (it) => location.pathname === it.to || location.pathname.startsWith(`${it.to}/`),
  );
  const collapsed = override === undefined ? !isActive : override;
  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setSectionCollapsed(section.key, !collapsed)}
        aria-expanded={!collapsed}
        className="flex min-h-9 w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]"
      >
        <span>{t(section.titleKey, section.title)}</span>
        <Icon name="chevron-down" size={12} className={cn('transition-transform', collapsed && '-rotate-90')} ariaHidden />
      </button>
      {!collapsed &&
        section.items.map((item) => (
          <MobileNavItem key={item.to} item={item} badges={badges} onNavigate={onNavigate} />
        ))}
    </div>
  );
}

function MobileNavItem({
  item,
  badges,
  onNavigate,
}: {
  item: NavItem;
  badges: { openBids: number; overdueTasks: number };
  onNavigate: () => void;
}) {
  const { t } = useTranslation('common');
  const label = t(item.labelKey, item.label);
  const badge = item.badgeKey ? badges[item.badgeKey] : 0;
  const location = useLocation();

  const isActive = (() => {
    try {
      const toUrl = new URL(item.to, window.location.origin);
      const toPath = toUrl.pathname;
      const toTab = toUrl.searchParams.get('tab');

      const currentTab = new URLSearchParams(location.search).get('tab');

      if (location.pathname !== toPath) return false;

      if (toTab) {
        return currentTab === toTab;
      } else {
        return !currentTab || currentTab === 'overview';
      }
    } catch {
      return false;
    }
  })();

  return (
    <NavLink
      to={item.to}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
        isActive
          ? 'bg-[var(--brand-primary-tint)] text-[var(--brand-deep)]'
          : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]',
      )}
      end={item.end ?? item.to === '/'}
      onClick={onNavigate}
      onMouseEnter={() => prefetchRoute(item.to)}
    >
      <Icon name={item.icon} size={16} />
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-semibold text-[var(--fg-tertiary)]">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

function MobileAccountItem({
  acc,
  onNavigate,
}: {
  acc: { slug: string; name: string };
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={`/accounts/${acc.slug}`}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-[var(--brand-primary-tint)] text-[var(--brand-deep)]'
            : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]',
        )
      }
      onClick={onNavigate}
      onMouseEnter={() => prefetchRoute(`/accounts/${acc.slug}`)}
    >
      <Icon name="building" size={14} />
      <span className="flex-1 truncate">{acc.name}</span>
    </NavLink>
  );
}
