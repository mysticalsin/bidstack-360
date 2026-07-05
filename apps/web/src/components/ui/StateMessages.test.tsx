// WHY these tests matter: every entity list used to render the identical
// floating-sparkle empty state — the exact "three identical centered cards"
// anti-pattern the design standards ban. These tests pin the contract that
// lets each list own its zero-state (bespoke icon in a tinted chip + a
// secondary follow-up under the CTA) while guaranteeing the ~70 legacy
// consumers that pass nothing keep the sparkle unchanged. If the default
// flips or the bespoke slots stop rendering, both promises break silently.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { EmptyState, EmptyStateLink } from './StateMessages';

describe('EmptyState', () => {
  // No global auto-cleanup in this repo's vitest setup — without this, the
  // second render's copy leaks into the third test's queries.
  afterEach(() => {
    cleanup();
  });

  it('keeps the legacy sparkle glyph when no icon is passed (back-compat)', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(container.querySelector('[data-empty-icon="sparkle"]')).not.toBeNull();
  });

  it('renders a bespoke entity icon instead of the sparkle when provided', () => {
    const { container } = render(<EmptyState title="No open bids yet" icon="target" />);
    expect(container.querySelector('[data-empty-icon="target"]')).not.toBeNull();
    expect(container.querySelector('[data-empty-icon="sparkle"]')).toBeNull();
  });

  it('renders title, body, primary CTA, and the secondary follow-up together', () => {
    render(
      <MemoryRouter>
        <EmptyState
          title="No open bids yet"
          message="Convert a qualified lead or log the RFP you're chasing."
          icon="target"
          action={<button type="button">New opportunity</button>}
          secondary={<EmptyStateLink to="/settings?tab=data-import">Import CSV</EmptyStateLink>}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('No open bids yet')).toBeTruthy();
    expect(
      screen.getByText("Convert a qualified lead or log the RFP you're chasing."),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New opportunity' })).toBeTruthy();
    // The secondary link must point at a real destination — a dead-end
    // zero-state is worse than a generic one.
    expect(screen.getByRole('link', { name: /import csv/i }).getAttribute('href')).toBe(
      '/settings?tab=data-import',
    );
  });
});
