import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, InteractiveCard } from './Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeDefined();
  });

  it('forwards custom className', () => {
    render(<Card className="my-card">Content</Card>);
    const card = screen.getByText('Content');
    expect(card.className).toContain('my-card');
  });

  it('renders as a div by default', () => {
    render(<Card>Block</Card>);
    const card = screen.getByText('Block');
    expect(card.tagName).toBe('DIV');
  });
});

describe('InteractiveCard', () => {
  it('renders children', () => {
    render(<InteractiveCard>Interactive</InteractiveCard>);
    expect(screen.getByText('Interactive')).toBeDefined();
  });

  it('has cursor-pointer class', () => {
    render(<InteractiveCard>Clickable</InteractiveCard>);
    const card = screen.getByText('Clickable');
    expect(card.className).toContain('cursor-pointer');
  });

  it('forwards data-testid', () => {
    render(<InteractiveCard data-testid="test-card">ID</InteractiveCard>);
    expect(screen.getByTestId('test-card')).toBeDefined();
  });
});
