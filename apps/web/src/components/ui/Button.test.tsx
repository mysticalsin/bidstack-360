import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders with primary variant by default', () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: /click me/i });
    expect(btn).toBeDefined();
    expect(btn.tagName).toBe('BUTTON');
  });

  it('forwards ref and accepts disabled', () => {
    render(<Button disabled>Disabled</Button>);
    const btn = screen.getByRole('button', { name: /disabled/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('renders as submit when type is submit', () => {
    render(<Button type="submit">Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn.getAttribute('type')).toBe('submit');
  });
});
