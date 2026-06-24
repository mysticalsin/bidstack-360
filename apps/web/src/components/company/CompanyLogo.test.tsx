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
  it('falls back to initials for third-party logo URLs', () => {
    render(
      <CompanyLogo
        name="Mantu"
        logo={logo('https://commons.wikimedia.org/wiki/Special:Redirect/file/Mantu.svg')}
        domain="mantu.com"
      />,
    );

    expect(screen.getByText('MA')).toBeDefined();
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders same-origin/proxied logo assets', () => {
    render(
      <CompanyLogo
        name="Mantu"
        logo={logo('/api/v1/assets/logos/mantu.png')}
        domain="mantu.com"
      />,
    );

    const img = document.querySelector('img');
    expect(img).toBeDefined();
    expect(img?.getAttribute('src')).toBe('/api/v1/assets/logos/mantu.png');
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
