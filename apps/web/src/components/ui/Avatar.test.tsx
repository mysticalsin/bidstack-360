import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Avatar } from './Avatar';

afterEach(cleanup);

describe('Avatar', () => {
  it('renders initials from seed', () => {
    render(<Avatar seed="Tony Stark" />);
    expect(screen.getByText('TS')).toBeDefined();
  });

  it('renders single-word initials as first two letters', () => {
    render(<Avatar seed="Tony" />);
    expect(screen.getByText('TO')).toBeDefined();
  });

  it('renders custom initials when provided', () => {
    render(<Avatar seed="Tony Stark" initials="IRON" />);
    expect(screen.getByText('IRON')).toBeDefined();
  });

  it('renders img when src is provided', () => {
    render(<Avatar seed="Tony" src="https://example.com/avatar.png" />);
    const img = screen.getByRole('img');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('https://example.com/avatar.png');
  });

  it('forwards className', () => {
    render(<Avatar seed="Test" className="custom-avatar" />);
    const el = screen.getByText('TE');
    expect(el.className).toContain('custom-avatar');
  });

  it('sets aria-hidden when decorative', () => {
    render(<Avatar seed="Test" decorative />);
    const el = screen.getByText('TE');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('role')).toBeNull();
  });

  it('sets role=img and aria-label when not decorative', () => {
    render(<Avatar seed="Bruce Wayne" />);
    const el = screen.getByText('BW');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Bruce Wayne');
  });

  it('applies custom size', () => {
    render(<Avatar seed="Test" size={64} />);
    const el = screen.getByText('TE');
    expect(el.style.width).toBe('64px');
    expect(el.style.height).toBe('64px');
  });
});
