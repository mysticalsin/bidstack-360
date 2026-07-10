import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useTheme } from '@/lib/theme';
import { PoloPreSalesLogo } from '@/components/brand/PoloPreSalesLogo';
import { AccentPicker } from '@/components/AccentPicker';

// Sticky top nav. Scroll-aware: solid background once the viewport has scrolled
// past the hero. Includes the dark-mode toggle so visitors who prefer a single
// theme have a one-click escape from the auto-detected default.
export function NavBar() {
  const { theme, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close mobile menu on Escape — standard a11y pattern for popovers.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const linkClass = (isActive: boolean) =>
    `link-inline text-sm font-medium transition-colors ${
      isActive
        ? 'text-[color:var(--brand-primary)]'
        : 'text-[color:var(--fg-secondary)] hover:text-[color:var(--fg-primary)]'
    }`;

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all ${
        scrolled
          ? 'border-b border-[color:var(--border-default)] bg-[color:var(--surface-card)]/85 backdrop-blur-md'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="mkt-container flex items-center gap-4 py-3">
        <Link
          to="/"
          aria-label="Polo PreSales home"
          className="link-inline flex items-center"
        >
          <PoloPreSalesLogo
            variant="full"
            title=""
            tone={theme === 'dark' ? 'inverse' : 'default'}
            className="h-7 w-auto"
          />
        </Link>

        <nav
          aria-label="Primary"
          className="hidden md:flex items-center gap-6 ml-8"
        >
          <NavLink to="/" end className={({ isActive }) => linkClass(isActive)}>
            Product
          </NavLink>
          <NavLink to="/pricing" className={({ isActive }) => linkClass(isActive)}>
            Pricing
          </NavLink>
          <a href="/#why" className={linkClass(false)}>
            Why Polo PreSales
          </a>
          <a href="/#ai" className={linkClass(false)}>
            AI
          </a>
        </nav>

        <div className="flex-1" />

        <AccentPicker />

        <button
          type="button"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="mkt-btn mkt-btn-ghost h-11 w-11 p-0"
        >
          {theme === 'dark' ? (
            // sun
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            // moon
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <a
          href="https://app.bidstack.dev/sign-in"
          className="link-inline hidden! md:inline-flex! items-center text-sm font-medium text-[color:var(--fg-secondary)] hover:text-[color:var(--fg-primary)] px-2"
        >
          Sign in
        </a>
        <a
          href="https://app.bidstack.dev/sign-up"
          className="mkt-btn mkt-btn-primary hidden! md:inline-flex!"
        >
          Start free
        </a>

        <button
          type="button"
          className="mkt-btn mkt-btn-ghost h-11 w-11 p-0 md:hidden!"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          )}
        </button>
      </div>

      {mobileOpen && (
        <div
          id="mobile-menu"
          className="md:hidden border-t border-[color:var(--border-default)] bg-[color:var(--surface-card)]"
        >
          <nav className="mkt-container py-4 flex flex-col gap-1" aria-label="Mobile primary">
            <Link to="/" onClick={() => setMobileOpen(false)} className="link-inline py-3 text-[color:var(--fg-primary)] font-medium">
              Product
            </Link>
            <Link to="/pricing" onClick={() => setMobileOpen(false)} className="link-inline py-3 text-[color:var(--fg-primary)] font-medium">
              Pricing
            </Link>
            <a href="/#why" onClick={() => setMobileOpen(false)} className="link-inline py-3 text-[color:var(--fg-primary)] font-medium">
              Why Polo PreSales
            </a>
            <a href="/#ai" onClick={() => setMobileOpen(false)} className="link-inline py-3 text-[color:var(--fg-primary)] font-medium">
              AI
            </a>
            <div className="h-px bg-[color:var(--border-default)] my-2" />
            <a href="https://app.bidstack.dev/sign-in" className="link-inline py-3 text-[color:var(--fg-primary)] font-medium">
              Sign in
            </a>
            <a href="https://app.bidstack.dev/sign-up" className="mkt-btn mkt-btn-primary w-full mt-2">
              Start free
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
