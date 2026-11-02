import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { IntelPayload } from '@bidstack/shared';

import { DataFreshnessRibbon } from './IntelCards';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

describe('DataFreshnessRibbon', () => {
  it('does not use a live green pulse when sources are not verified', () => {
    const { container } = render(
      <DataFreshnessRibbon
        intel={{ refreshedAt: '2026-06-01T00:00:00.000Z', triggers: [{ id: 't1' }] } as IntelPayload}
      />,
    );
    expect(screen.getByText(/Sources are not verified/)).toBeTruthy();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(container.innerHTML).not.toContain('--success');
  });
});