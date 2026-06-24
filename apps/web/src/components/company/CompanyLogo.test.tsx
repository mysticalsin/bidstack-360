import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrmLogo } from '@bidstack/shared';

import { CompanyLogo } from './CompanyLogo';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string>) =>
      values?.name ? fallback.replace('{{name}}', values.name) : fallback,
  }),
}));

afterEach(cleanup);

describe('CompanyLogo', () => {
  // WHY: a real domain resolves the live logo through the same-origin proxy
  // (primary source) — even over a raw third-party logo.url, which CSP/privacy
  // would block anyway.
  it('uses the same-origin domain proxy as the primary source for a real domain', () => {
    render(<CompanyLogo name="Mantu" logo={logo('https://third-party.example/x.svg')} domain="mantu.com" />);
    const img = document.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/v1/logo?domain=mantu.com');
  });

  // WHY: with no real domain to proxy, a same-origin/proxied logo.url still
  // renders (the displayableLogoUrl gate allows same-origin assets).
  it('falls back to a same-origin logo.url when there is no proxyable domain', () => {
    render(<CompanyLogo name="Mantu" logo={logo('/api/v1/assets/logos/mantu.png')} domain={null} />);
    const img = document.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/v1/assets/logos/mantu.png');
  });

  // WHY: raw third-party URLs are rejected (no proxy + gate fails) → initials,
  // never a cross-origin request.
  it('falls back to initials for a third-party logo URL with no usable domain', () => {
    render(
      <CompanyLogo
        name="Mantu"
        logo={logo('https://commons.wikimedia.org/wiki/Special:Redirect/file/Mantu.svg')}
        domain={null}
      />,
    );
    expect(screen.getByText('MA')).toBeDefined();
    expect(document.querySelector('img')).toBeNull();
  });
});

function logo(url: string): CrmLogo {
  return {
    url,
    source: 'manual',
    cachedAt: '2026-06-23T00:00:00.000Z',
    attribution: null,
  } as CrmLogo;
}
