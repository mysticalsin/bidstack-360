import { useState, forwardRef, type ReactNode } from 'react';

import { HoverCard } from '@/components/ui/HoverCard';
import type { CrmLogo } from '@bidstack/shared';

interface CompanyLogoProps {
  name: string;
  /** CRM-resolved logo (External CRM / Brandfetch / Logo.dev / favicon). Preferred. */
  logo?: CrmLogo | null;
  /** Bare domain (no protocol) - used to request the website favicon fallback. */
  domain?: string | null;
  size?: number;
  className?: string;
  /** When provided, wraps the logo in a HoverCard that reveals a data brief. */
  brief?: ReactNode;
  /** Above-the-fold? Triggers fetchpriority="high" + eager loading. */
  priority?: boolean;
}

// Logo source chain:
//   1. CRM-resolved high-confidence logo (External CRM / Brandfetch / Logo.dev)
//   2. Small favicon fallback for compact table/sidebar uses
//   3. Initials fallback (always works)
// Large favicons are often pale generic tiles, so card/hero logos prefer
// strong initials unless an actual brand asset has been resolved.
export const CompanyLogo = forwardRef<HTMLSpanElement, CompanyLogoProps>(function CompanyLogo(
  { name, logo, domain, size = 36, className, brief, priority = false },
  ref,
) {
  const sources: string[] = [];
  const normalizedDomain = normalizeDomain(domain);
  const shouldUseCompactFavicon =
    size <= 64 && normalizedDomain !== null && !isReservedDomain(normalizedDomain);

  if (logo?.url && logo.source !== 'favicon') {
    sources.push(logo.url);
  }
  if (normalizedDomain && shouldUseCompactFavicon) {
    sources.push(`https://www.google.com/s2/favicons?domain=${normalizedDomain}&sz=${size * 2}`);
  }
  if (
    logo?.url &&
    logo.source === 'favicon' &&
    shouldUseCompactFavicon &&
    !logo.url.endsWith('/favicon.ico')
  ) {
    sources.push(logo.url);
  }

  const [sourceIdx, setSourceIdx] = useState(0);
  const url = sources[sourceIdx] ?? null;

  const glyph = (
    <span
      ref={ref}
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, Math.round(size * 0.18)),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        background: 'var(--brand-primary-tint)',
        color: 'var(--brand-primary)',
        border: '1px solid var(--border-default)',
        fontSize: Math.max(11, Math.round(size * 0.3)),
        fontWeight: 700,
      }}
      title={logo?.attribution?.label ?? `${name} logo`}
      aria-label={`${name} logo`}
    >
      {url ? (
        <img
          // Cache-bust source switches so the browser actually retries the next URL.
          key={`${sourceIdx}-${url}`}
          src={url}
          // Logo is decorative — the brand name is already announced by the
          // wrapping aria-label, so an empty alt is correct per WCAG H67
          // (text alternatives for images that are decorative). Explicit
          // empty alt (vs. omitted) tells screen readers to skip the image.
          alt=""
          // Above-the-fold logos (cockpit hero) get eager loading + high
          // fetchpriority to keep them out of the LCP critical path. Below
          // the fold they stay lazy. `decoding="async"` is safe in both
          // cases — keeps the main thread responsive while the image
          // decodes.
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setSourceIdx((i) => i + 1)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }}
        />
      ) : (
        initialsFor(name)
      )}
    </span>
  );

  if (brief) {
    return <HoverCard content={brief}>{glyph}</HoverCard>;
  }
  return glyph;
});

function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const [host] = domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/');
  return host?.trim().toLowerCase() || null;
}

function isReservedDomain(domain: string): boolean {
  return (
    domain.endsWith('.example') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.localhost') ||
    domain.endsWith('.test') ||
    domain === 'example.com' ||
    domain === 'example.org' ||
    domain === 'example.net'
  );
}

function initialsFor(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
