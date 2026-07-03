import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Shared layout for all four legal pages. Provides a narrow reading column,
// a left rail of cross-links, and the "last updated" line that auditors look
// for first. All four pages share these so visitors know they're in the legal
// section consistently.
export interface LegalLayoutProps {
  title: string;
  updated: string;
  intro?: ReactNode;
  children: ReactNode;
}

const LEGAL_NAV = [
  { label: 'Terms of Service', to: '/legal/terms' },
  { label: 'Privacy Policy', to: '/legal/privacy' },
  { label: 'Data Processing Agreement', to: '/legal/dpa' },
  { label: 'Security', to: '/legal/security' },
];

export function LegalLayout({ title, updated, intro, children }: LegalLayoutProps) {
  return (
    <div className="bg-[color:var(--surface-page)]">
      <div className="mkt-container py-12 md:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-10 lg:gap-16 max-w-5xl mx-auto">
          {/* Side nav — collapses to a horizontal scroller on mobile */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <h2 className="text-xs font-semibold tracking-wider uppercase text-[color:var(--fg-tertiary)] mb-3">
              Legal
            </h2>
            <nav aria-label="Legal sections">
              <ul className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
                {LEGAL_NAV.map((l) => (
                  <li key={l.to}>
                    <Link
                      to={l.to}
                      className="link-inline block px-3 py-2 rounded-lg text-sm text-[color:var(--fg-secondary)] hover:text-[color:var(--fg-primary)] hover:bg-[color:var(--surface-sunken)] whitespace-nowrap"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <article>
            <header className="mb-8">
              <h1 className="mkt-display text-3xl md:text-5xl text-[color:var(--fg-primary)]">
                {title}
              </h1>
              <p className="mt-3 text-sm text-[color:var(--fg-tertiary)]">
                Last updated: <time>{updated}</time>
              </p>
              {intro && <div className="mt-6 mkt-prose">{intro}</div>}
            </header>
            <div className="mkt-prose">{children}</div>
            <p className="mt-12 pt-6 border-t border-[color:var(--border-default)] text-xs text-[color:var(--fg-tertiary)]">
              This document contains placeholder fields (
              <code>[COMPANY NAME]</code>, <code>[JURISDICTION]</code>,{' '}
              <code>[EFFECTIVE DATE]</code>) that will be replaced when Polo PreSales incorporates and
              publishes its production legal pack. Review with counsel before relying on this
              document as a final agreement.
            </p>
          </article>
        </div>
      </div>
    </div>
  );
}
