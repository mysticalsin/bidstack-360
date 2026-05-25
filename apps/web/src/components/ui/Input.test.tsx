import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Input } from './Input';

afterEach(cleanup);

describe('Input', () => {
  it('renders with label', () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText('Email')).toBeDefined();
  });

  it('renders error message and aria-invalid', () => {
    render(<Input label="Name" error="Required" />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Required')).toBeDefined();
  });

  it('renders helper text when no error', () => {
    render(<Input label="Name" helper="Your full name" />);
    expect(screen.getByText('Your full name')).toBeDefined();
  });

  it('does not render helper when error is present', () => {
    render(<Input label="Name" helper="Your full name" error="Required" />);
    expect(screen.queryByText('Your full name')).toBeNull();
    expect(screen.getByText('Required')).toBeDefined();
  });

  it('sets disabled and aria-busy when loading', () => {
    render(<Input label="Name" isLoading />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-busy')).toBe('true');
  });

  it('forwards ref and custom props', () => {
    render(<Input label="Name" placeholder="Jane Doe" data-testid="my-input" />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.getAttribute('placeholder')).toBe('Jane Doe');
    expect(input.getAttribute('data-testid')).toBe('my-input');
  });

  it('forwards className to wrapper', () => {
    const { container } = render(<Input label="Name" className="wrapper-class" />);
    expect(container.querySelector('.wrapper-class')).not.toBeNull();
  });
});
