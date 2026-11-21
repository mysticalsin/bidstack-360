import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorldMap } from './WorldMap';

vi.mock('react-simple-maps', () => ({
  ComposableMap: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Geographies: () => null,
  Geography: () => null,
  ZoomableGroup: ({ children }: { children?: React.ReactNode }) => <g>{children}</g>,
  Graticule: () => null,
  Marker: ({ children }: { children?: React.ReactNode }) => <g>{children}</g>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

afterEach(() => cleanup());

describe('WorldMap region presets', () => {
  it('exposes which preset is active, not just its colour', () => {
    render(<WorldMap data={[]} onCountryClick={vi.fn()} />);

    const global = screen.getByRole('button', { name: 'Global' });
    const europe = screen.getByRole('button', { name: 'Europe' });
    expect(global.getAttribute('aria-pressed')).toBe('true');
    expect(europe.getAttribute('aria-pressed')).toBe('false');
    expect(global.getAttribute('type')).toBe('button');

    // Icon-only zoom controls need a name. A title attribute is not the name
    // we rely on: it is absent from the accessibility tree in some browsers.
    expect(screen.getByRole('button', { name: 'Zoom In' }).getAttribute('aria-label')).toBe('Zoom In');
    expect(screen.getByRole('button', { name: 'Zoom Out' }).getAttribute('aria-label')).toBe('Zoom Out');
    expect(screen.getByRole('button', { name: 'Reset View' }).getAttribute('aria-label')).toBe('Reset View');

    fireEvent.click(europe);

    expect(europe.getAttribute('aria-pressed')).toBe('true');
    expect(global.getAttribute('aria-pressed')).toBe('false');
  });
});
