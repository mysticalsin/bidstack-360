import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenIssuesCard } from './OpenIssuesCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    motion: {
      div: ({ children, ...props }: { children?: React.ReactNode }) =>
        React.createElement('div', props, children),
    },
    useReducedMotion: () => true,
  };
});

afterEach(() => {
  cleanup();
});

describe('OpenIssuesCard', () => {
  it('does not treat a missing register as an all-clear', () => {
    // Why: an empty risk list used to say the account was green. Absence of
    // rows is not a recorded clearance.
    render(<OpenIssuesCard risks={[]} compliance={[]} />);

    expect(screen.getByText('Nothing recorded').textContent).toBe('Nothing recorded');
    expect(screen.getByText(/not a clearance/).textContent).toContain('not a clearance');
    expect(screen.queryByText('Everything is green here.')).toBeNull();
    expect(screen.queryByText('All clear')).toBeNull();
  });
});
