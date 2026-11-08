// Navigation drawer for viewports below 56rem, where the sidebar rail is
// hidden. Opens from the topbar hamburger as an in-place drawer inside the
// app shell (no body portal) and closes on link selection, backdrop tap, or
// Escape. Focus moves in on open, Tab is trapped, and focus returns to the
// element that opened it.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { PoloPreSalesLogo } from '@/components/brand/PoloPreSalesLogo';
import { useUiStore } from '@/stores/ui';
import { useAccountHistory } from '@/stores/accountHistory';
import { useIsAdmin } from '@/lib/auth';
import { useOpportunityCount } from '@/hooks/useOpportunities';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useTaskSummary } from '@/hooks/useTasks';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { prefetchRoute } from '@/lib/prefetch';

import { useAppModules } from '@/hooks/useAppModules';
import { ADMIN_SETTINGS, MEMBER_SETTINGS, NAV_SECTIONS, isNavItemVisible, type NavItem, type NavSection } from './navConfig';
import { useIsWideShell } from './shellBreakpoint';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MobileNav() {
  const wide = useIsWideShell();
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);

  // The drawer only exists below 56rem; widening the window past it closes
  // a drawer left open so it cannot reappear when the window narrows again.
  useEffect(() => {
    if (!wide || !open) return;
    setOpen(false);
    // The drawer just unmounted with focus inside it; hand focus to the rail.
    if (document.activeElement === document.body) {
      document.querySelector<HTMLElement>('.sb-toggle')?.focus();
    }
  }, [wide, open, setOpen]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  if (wide) return null;
  return <NavDrawer open={open} onClose={close} />;
}

function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // Mount the nav on first open, then keep it so the slide-out has content.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    const el = panel.current;
    if (!el) return undefined;
    if (open) {
      wasOpen.current = true;
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.removeAttribute('inert');
      el.focus();
      document.body.style.overflow = 'hidden';
      // aria-modal alone does not stop touch screen readers swiping into the
      // page behind, so the drawer's shell siblings go inert while it is open.
      const behind = Array.from(root.current?.parentElement?.children ?? []).filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node !== root.current && !node.hasAttribute('inert'),
      );
      for (const node of behind) node.setAttribute('inert', '');
      return () => {
        for (const node of behind) node.removeAttribute('inert');
        document.body.style.overflow = '';
      };
    }
    // Read focus before `inert` lands: inert blurs whatever it contains.
    const focusWasInside = el.contains(document.activeElement) || document.activeElement === document.body;
    el.setAttribute('inert', '');
    if (wasOpen.current && focusWasInside) {
      const target =
        returnFocus.current?.isConnected === true
          ? returnFocus.current
          : document.querySelector<HTMLElement>('[aria-controls="mobile-nav-drawer"]');
      target?.focus();
    }
    wasOpen.current = false;
    returnFocus.current = null;
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const trapTab = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const root = panel.current;
    if (event.key !== 'Tab' || !root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <div
      ref={root}
      className="mobile-nav-root"
      data-state={open ? 'open' : 'closed'}
      data-motion={reduced ? 'instant' : 'animate'}
    >
      <button
        type="button"
        className="mobile-nav-backdrop"
        aria-label="Close navigation"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panel}
        id="mobile-nav-drawer"
        // Closed, it stays mounted for the slide-out; no dialog role then, so
        // `[role="dialog"]` checks elsewhere never see a phantom open dialog.
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label="Primary navigation"
        tabIndex={-1}
        data-state={open ? 'open' : 'closed'}
        className="mobile-nav-drawer"
        onKeyDown={trapTab}
      >
        {mounted ? <MobileNavContent onClose={onClose} /> : null}
      </div>
    </div>
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
            <PoloPreSalesLogo variant="mark" title="" className="h-6 w-auto" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--fg-primary)] leading-tight">
              Polo PreSales
            </span>
            <span className="text-[10px] text-[var(--fg-tertiary)] font-normal leading-tight">
              Mantu · Bid &amp; presales
            </span>
          </div>
        </div>
        <button type="button" onClick={onClose} className="iconbtn" aria-label={t('actions.close', 'Close')}>
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
