import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TechLogo, techMonogram } from './TechLogo';

afterEach(cleanup);

describe('TechLogo', () => {
  // WHY: the real brand logo must come same-origin (CSP blocks external img
  // hosts) via the tech proxy — not a letter-only badge — and the product
  // name has to be available on hover even when the tile is icon-sized.
  it('renders the real logo via the same-origin tech proxy for a known brand', () => {
    render(<TechLogo name="GitHub" size={18} />);
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/api/v1/logo?tech=github');
    const plate = document.querySelector('[data-tech-logo="GitHub"]');
    expect(plate?.getAttribute('data-plate')).toBe('brand');
    expect(plate?.getAttribute('title')).toBe('GitHub');
    expect(plate?.getAttribute('style') ?? '').toMatch(/background:\s*(#fff|rgb\(255,\s*255,\s*255\))/);
  });

  // WHY: a 404 / unknown brand / offline must never show a broken image.
  // Two letters keep Azure and AWS from both collapsing to "A".
  it('falls back to a two-letter monogram when the logo fails to load', () => {
    render(<TechLogo name="GitHub" size={18} />);
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(screen.getByText('GI')).toBeDefined();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[data-fallback="monogram"]')).not.toBeNull();
  });

  it('uses the monogram directly when no logo can be resolved', () => {
    render(<TechLogo name="Acme Internal Tool" size={18} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('AI')).toBeDefined();
    expect(document.querySelector('[data-tech-logo="Acme Internal Tool"]')?.getAttribute('title')).toBe('Acme Internal Tool');
  });

  it('uses a placeholder monogram when the name cannot form letters', () => {
    render(<TechLogo name="+" size={18} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('?')).toBeDefined();
  });

  // WHY: a tinted tile whose letters use the same hue can drop under 4.5:1
  // (jade on its 16% mix). The letter has to be primary text.
  it('paints monogram letters in primary text so the tint still clears contrast', () => {
    render(<TechLogo name="Google Analytics" size={20} />);
    const mark = document.querySelector('[data-fallback="monogram"]');
    expect(mark?.textContent).toBe('GA');
    expect(mark?.getAttribute('style') ?? '').toMatch(/color:\s*var\(--fg-primary\)/);
  });

  it('builds distinct monograms for brands that share a first letter', () => {
    expect(techMonogram('Azure')).toBe('AZ');
    expect(techMonogram('AWS')).toBe('AW');
    expect(techMonogram('Microsoft 365')).toBe('MI');
  });
});
