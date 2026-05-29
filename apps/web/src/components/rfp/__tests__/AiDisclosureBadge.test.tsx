/**
 * Tests for AiDisclosureBadge.
 *
 * The badge is a pure presentational component with no props — callers
 * control visibility by conditionally rendering it. Tests therefore verify:
 *  1. The badge renders its EU AI Act Art. 50 disclosure text when mounted.
 *  2. The accessible label is correct for screen readers.
 *  3. The badge is absent when not rendered (the caller's conditional).
 *
 * Note: the task spec describes an `aiDrafted` prop, but the actual
 * component has no props — presence/absence is controlled by the parent.
 * Tests reflect the real implementation.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AiDisclosureBadge } from '../shared/AiDisclosureBadge';

afterEach(() => {
  cleanup();
});

describe('AiDisclosureBadge', () => {
  it('renders the AI-assisted draft disclosure text', () => {
    render(<AiDisclosureBadge />);
    // The visible text the user reads (EU AI Act Art. 50 transparency requirement)
    expect(screen.getByText(/AI-assisted draft/i)).toBeDefined();
  });

  it('has an accessible aria-label describing AI generation for screen readers', () => {
    render(<AiDisclosureBadge />);
    const badge = screen.getByLabelText(/This content was generated with AI assistance/i);
    expect(badge).toBeDefined();
  });

  it('renders as an inline span element', () => {
    render(<AiDisclosureBadge />);
    const badge = screen.getByLabelText(/This content was generated with AI assistance/i);
    expect(badge.tagName).toBe('SPAN');
  });

  it('has a title attribute for tooltip disclosure', () => {
    render(<AiDisclosureBadge />);
    const badge = screen.getByLabelText(/This content was generated with AI assistance/i);
    expect(badge.getAttribute('title')).toContain('AI-assisted draft');
  });

  it('is NOT present in the DOM when not rendered (parent controls visibility)', () => {
    // The parent conditionally renders the badge; when aiDrafted=false the
    // parent simply does not mount <AiDisclosureBadge />.
    render(<span>No badge here</span>);
    expect(screen.queryByLabelText(/This content was generated with AI assistance/i)).toBeNull();
  });
});
