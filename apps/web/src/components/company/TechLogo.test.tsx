import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TechLogo } from './TechLogo';

afterEach(cleanup);

describe('TechLogo', () => {
  // WHY: the real brand logo must come same-origin (CSP blocks external img
  // hosts) via the tech proxy — not the old letter-only badge.
  it('renders the real logo via the same-origin tech proxy for a known brand', () => {
    render(<TechLogo name="GitHub" size={18} />);
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/api/v1/logo?tech=github');
  });

  // WHY: a 404 / unknown brand / offline must never show a broken image — it
  // falls back to the deterministic monogram. (This replaces the old "no img"
  // assertion, which is intentionally obsolete now that logos render.)
  it('falls back to the monogram when the logo fails to load', () => {
    render(<TechLogo name="GitHub" size={18} />);
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(screen.getByText('G')).toBeDefined();
    expect(document.querySelector('img')).toBeNull();
  });

  it('uses the monogram directly when no slug can form', () => {
    render(<TechLogo name="+" size={18} />);
    expect(document.querySelector('img')).toBeNull();
  });
});
