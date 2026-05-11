import { useState, type ReactNode } from 'react';

import { HoverCard } from '@/components/ui/HoverCard';
import type { CrmLogo } from '@bidstack/shared';

interface CompanyLogoProps {
  name: string;
  /** CRM-resolved logo (Twenty / Brandfetch / Logo.dev / favicon). Preferred. */
  logo?: CrmLogo | null;
  /** Bare domain (no protocol) — used to query the free Clearbit Logo API as fallback. */
  domain?: string | null;
  size?: number;
  className?: string;
  /** When provided, wraps the logo in a HoverCard that reveals an enrichment brief. */
  brief?: ReactNode;
  /** Above-the-fold? Triggers fetchpriority="high" + eager loading. */
  priority?: boolean;
}

// Logo source chain:
//   1. CRM-resolved logo (Twenty / Brandfetch / Logo.dev / favicon)
//   2. Clearbit Logo API (https://logo.clearbit.com/{domain}) — free, no auth
//   3. Initials fallback (always works)
// The chain advances on <img> error, so a 404 from Clearbit gracefully degrades.
export function CompanyLogo({
  name,
  logo,
  domain,
  size = 36,
  className,
  brief,
  priority = false,
}: CompanyLogoProps) {
  const sources: string[] = [];
  if (logo?.url) sources.push(logo.url);
  if (domain) sources.push(`https://logo.clearbit.com/${domain}?size=128`);

  const [sourceIdx, setSourceIdx] = useState(0);
  const url = sources[sourceIdx] ?? null;

  const glyph = (
    <span
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
          fetchPriority={priority ? 'high' : 'auto'}
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
}

function initialsFor(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
