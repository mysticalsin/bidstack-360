import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, stageTone } from './Badge';

describe('Badge', () => {
  it('renders with default gray tone', () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText('Default')).toBeDefined();
  });

  it('renders with each tone variant', () => {
    const tones = ['blue', 'jade', 'amber', 'tomato', 'purple', 'teal', 'rose', 'gray'] as const;
    tones.forEach((tone) => {
      const { container } = render(<Badge tone={tone}>{tone}</Badge>);
      expect(container.querySelector('span')).toBeDefined();
    });
  });

  it('forwards custom className', () => {
    render(<Badge className="custom-class">Styled</Badge>);
    const badge = screen.getByText('Styled');
    expect(badge.className).toContain('custom-class');
  });

  it('stageTone maps pipeline stages correctly', () => {
    expect(stageTone('s1_lead')).toBe('gray');
    expect(stageTone('s1_ongoing')).toBe('purple');
    expect(stageTone('s2_sent')).toBe('blue');
    expect(stageTone('s3_technical_iteration')).toBe('teal');
    expect(stageTone('s4_negotiation')).toBe('amber');
    expect(stageTone('closed_won')).toBe('jade');
    expect(stageTone('closed_lost')).toBe('tomato');
  });

  it('stageTone falls back to gray for unknown stage', () => {
    expect(stageTone('unknown_stage')).toBe('gray');
    expect(stageTone('')).toBe('gray');
  });
});
