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

    fireEvent.click(europe);

    expect(europe.getAttribute('aria-pressed')).toBe('true');
    expect(global.getAttribute('aria-pressed')).toBe('false');
  });
});
