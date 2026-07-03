import { Link } from 'react-router-dom';

// 5-column site footer. Renders as a single column on mobile and 5 across at md.
// Legal column links use react-router; external links open in new tabs with
// rel=noopener for security.
const FOOTER: Array<{
  title: string;
  links: Array<{ label: string; to?: string; href?: string }>;
}> = [
  {
    title: 'Product',
    links: [
      { label: 'Pipeline', to: '/' },
      { label: 'Proposals', to: '/' },
      { label: 'Accounts', to: '/' },
      { label: 'Workflows', to: '/' },
      { label: 'Pricing', to: '/pricing' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { label: 'IT services bids', to: '/' },
      { label: 'Government RFPs', to: '/' },
      { label: 'Strategic accounts', to: '/' },
      { label: 'Channel partners', to: '/' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Documentation', href: 'https://docs.bidstack.dev' },
      { label: 'Changelog', href: 'https://app.bidstack.dev/changelog' },
      { label: 'API reference', href: 'https://docs.bidstack.dev/api' },
      { label: 'Status', href: 'https://status.bidstack.dev' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/' },
      { label: 'Careers', to: '/' },
      { label: 'Contact', href: 'mailto:hello@bidstack.dev' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms', to: '/legal/terms' },
      { label: 'Privacy', to: '/legal/privacy' },
      { label: 'DPA', to: '/legal/dpa' },
      { label: 'Security', to: '/legal/security' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-[color:var(--border-default)] bg-[color:var(--surface-card)]">
      <div className="mkt-container py-12 md:py-16">
        <div className="grid grid-cols-2 gap-y-10 gap-x-6 md:grid-cols-5 md:gap-x-8">
          {FOOTER.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs font-semibold tracking-wider uppercase text-[color:var(--fg-tertiary)] mb-3">
                {col.title}
              </h3>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.to ? (
                      <Link
                        to={link.to}
                        className="link-inline text-sm text-[color:var(--fg-secondary)] hover:text-[color:var(--fg-primary)]"
                      >
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        className="link-inline text-sm text-[color:var(--fg-secondary)] hover:text-[color:var(--fg-primary)]"
                        rel={link.href?.startsWith('http') ? 'noopener noreferrer' : undefined}
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t border-[color:var(--border-subtle)] flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-[color:var(--fg-tertiary)]">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 place-items-center rounded-md text-white font-bold text-[11px]"
              style={{ background: 'var(--brand-gradient)' }}
            >
              B
            </span>
            <span>
              Polo PreSales &copy; {new Date().getFullYear()} Polo PreSales, Inc. All rights reserved.
            </span>
          </div>
          <div className="text-xs text-[color:var(--fg-muted)]">
            Built in 🇪🇺 — GDPR-ready by default
          </div>
        </div>
      </div>
    </footer>
  );
}
