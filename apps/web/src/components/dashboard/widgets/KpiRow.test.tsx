import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { KpiRow } from './KpiRow';
import type { OrgKpi } from './dashboard-types';

// The strip replaced six identical glow-icon cards (each in its own accent
// hue with a decorative sparkbar). These tests pin the two design decisions
// that made that fix a fix: every metric is a plain link with an accessible
// name, and exactly the ONE metric flagged `emphasis` carries the accent —
// regressing to per-metric decoration or accenting everything fails here.
const KPIS: OrgKpi[] = [
  {
    label: 'Companies',
    value: 6,
    detail: 'in portfolio',
    tone: 'blue',
    icon: 'building',
    href: '/companies',
    signal: [],
  },
  {
    label: 'Open Pipeline',
    value: 4,
    detail: 'active deals',
    tone: 'teal',
    icon: 'dollar',
    href: '/opportunities',
    signal: [],
    emphasis: true,
  },
  {
    label: 'Tasks',
    value: 5,
    detail: 'follow-ups',
    tone: 'rose',
    icon: 'tasks',
    href: '/tasks',
    signal: [],
  },
];

function renderRow() {
  return render(
    <MemoryRouter>
      <KpiRow kpis={KPIS} reduced={true} />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('KpiRow (workspace metric strip)', () => {
  it('renders each metric as a link with its value in the accessible name', () => {
    renderRow();

    expect(screen.getByRole('link', { name: 'Companies: 6' }).getAttribute('href')).toBe(
      '/companies',
    );
    expect(screen.getByRole('link', { name: 'Open Pipeline: 4' }).getAttribute('href')).toBe(
      '/opportunities',
    );
    expect(screen.getByRole('link', { name: 'Tasks: 5' }).getAttribute('href')).toBe('/tasks');
  });

  it('accents only the metric flagged emphasis — one accent, not six', () => {
    renderRow();

    const emphasized = screen.getByRole('link', { name: 'Open Pipeline: 4' });
    expect(emphasized.className).toContain('is-primary');

    for (const name of ['Companies: 6', 'Tasks: 5']) {
      expect(screen.getByRole('link', { name }).className).not.toContain('is-primary');
    }
  });

  it('drops the per-metric decoration: no icons, no sparkbar signals', () => {
    const { container } = renderRow();

    expect(container.querySelector('.kpi-icon')).toBeNull();
    expect(container.querySelector('.kpi-signal')).toBeNull();
  });
});
