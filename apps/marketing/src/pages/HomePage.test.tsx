import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';

import { HomePage } from './HomePage';

// Smoke test: the home page renders the hero headline, primary CTA, and FAQ-free
// surface. If any of these break we have a regression worth catching before deploy.
describe('HomePage', () => {
  it('renders the hero headline', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: /winning bids/i }),
    ).toBeDefined();
  });

  it('shows the primary CTA to start free', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    const ctas = screen.getAllByRole('link', { name: /start free/i });
    expect(ctas.length).toBeGreaterThan(0);
  });

  it('lists all six feature cards', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    const featureTitles = [
      /pipeline that adapts/i,
      /proposals with ai/i,
      /360° accounts/i,
      /workflows that actually run/i,
      /bid scoring/i,
      /audit-ready compliance/i,
    ];
    for (const re of featureTitles) {
      expect(screen.getByRole('heading', { name: re })).toBeDefined();
    }
  });
});
