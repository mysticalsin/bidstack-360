import { render, screen } from '@testing-library/react';
import { CircleCheck, CircleX, Clock, Info, Rocket, TriangleAlert } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { StatusPill, Tag, type StatusTone } from './status-pill';

describe('StatusPill', () => {
  it('always renders its text so tone is never the only signal', () => {
    render(<StatusPill tone="positive">Delivered</StatusPill>);
    expect(screen.getByText('Delivered')).toBeTruthy();
  });

  it.each<[StatusTone, string]>([
    ['neutral', 'text-fg-secondary'],
    ['brand', 'text-brand-deep'],
    ['positive', 'text-success'],
    ['negative', 'text-danger'],
    ['warning', 'text-warning'],
  ])('maps tone %s onto repo tokens', (tone, cls) => {
    render(<StatusPill tone={tone}>{tone}</StatusPill>);
    expect(screen.getByText(tone).className).toContain(cls);
  });

  it('never emits TUFFUI or shadcn token names', () => {
    const tones: StatusTone[] = ['neutral', 'brand', 'positive', 'negative', 'warning'];
    for (const tone of tones) {
      const { container } = render(
        <StatusPill tone={tone} icon={CircleCheck}>
          x
        </StatusPill>,
      );
      const html = container.innerHTML;
      expect(html).not.toMatch(/muted-foreground|text-foreground|bg-foreground|text-brand(?!-deep)/);
      expect(html).not.toMatch(/\bbg-positive|\bbg-negative|text-positive|text-negative/);
    }
  });

  it.each([CircleCheck, CircleX, TriangleAlert, Info, Clock])(
    'draws a filled glyph with a cut-out mark for %o',
    (icon) => {
      const { container } = render(
        <StatusPill tone="negative" icon={icon}>
          Failed
        </StatusPill>,
      );
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      const mask = svg?.querySelector('mask');
      expect(mask).toBeTruthy();
      const id = mask?.getAttribute('id') ?? '';
      expect(id).toMatch(/^[A-Za-z][\w-]*$/);
      expect(svg?.querySelector('g[mask]')?.getAttribute('mask')).toBe(`url(#${id})`);
    },
  );

  it('gives every filled glyph a unique mask id', () => {
    const { container } = render(
      <>
        <StatusPill icon={CircleCheck}>a</StatusPill>
        <StatusPill icon={CircleCheck}>b</StatusPill>
      </>,
    );
    const ids = [...container.querySelectorAll('mask')].map((m) => m.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('falls back to the plain lucide icon when no filled glyph exists', () => {
    const { container } = render(<StatusPill icon={Rocket}>Launched</StatusPill>);
    const svg = container.querySelector('svg');
    expect(svg?.querySelector('mask')).toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses the outline weight when iconWeight is bold', () => {
    const { container } = render(
      <StatusPill icon={CircleCheck} iconWeight="bold">
        Ok
      </StatusPill>,
    );
    expect(container.querySelector('mask')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe('2.5');
  });

  it('supports the sm size and forwards props', () => {
    render(
      <StatusPill size="sm" data-testid="pill" className="extra">
        Small
      </StatusPill>,
    );
    const pill = screen.getByTestId('pill');
    expect(pill.className).toContain('h-5');
    expect(pill.className).toContain('extra');
  });
});

describe('Tag', () => {
  it('renders a mono chip on repo tokens', () => {
    render(<Tag>https</Tag>);
    const tag = screen.getByText('https');
    expect(tag.className).toContain('font-mono');
    expect(tag.className).toContain('text-fg-secondary');
    expect(tag.className).toContain('rounded-md');
  });
});
