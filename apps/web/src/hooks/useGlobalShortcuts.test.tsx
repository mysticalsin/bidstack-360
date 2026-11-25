// G then R is the reports chord printed on the shortcuts sheet. The demo
// seeds one shared analytics dashboard and no saved reports. /reports
// already redirects to that dashboard, but the chord jumps to
// /reports/list, which renders "No reports found", and the sheet stays
// open over it. A demo user who follows the sheet never sees the
// dashboard the nav calls Analytics & Reports.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildNavTargets } from '@/components/command/commandPaletteUtils';
import { HelpDrawer } from '@/components/help/HelpDrawer';
import { useHelpDrawer } from '@/components/help/useHelpDrawer';
import { NAV_SECTIONS } from '@/components/layout/navConfig';
import '@/i18n';

import { useGlobalShortcuts } from './useGlobalShortcuts';

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '../../public/locales');

// Same words as nav.analyticsReports, with the "go to" verb each catalog
// already uses for the other chords. A leftover "Go to Reports" string
// would put the empty library back on the sheet.
const REPORTS_CHORD_LABEL: Record<string, string> = {
  en: 'Go to Analytics & Reports',
  fr: 'Aller aux analyses et rapports',
  es: 'Ir a Analítica e informes',
  pt: 'Ir para Análises e relatórios',
  it: 'Vai ad Analisi e report',
  zh: '转到分析与报告',
};

function Probe() {
  useGlobalShortcuts();
  const { pathname } = useLocation();
  return <div data-testid="path">{pathname}</div>;
}

function pressChord(second: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: second, bubbles: true }));
  });
}

describe('reports chord on the shortcuts sheet', () => {
  beforeEach(() => {
    useHelpDrawer.setState({ open: true });
  });

  afterEach(() => {
    cleanup();
    useHelpDrawer.setState({ open: false });
  });

  it('opens the seeded analytics dashboard and dismisses the sheet', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Probe />
        <HelpDrawer />
      </MemoryRouter>,
    );

    expect(screen.getByRole('dialog')).toBeDefined();

    pressChord('r');

    // The empty saved-reports library is /reports/list. The chord must not
    // land there, and the sheet must not stay up and hide the dashboard.
    expect(screen.getByTestId('path').textContent).toBe('/analytics');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names Analytics and Reports on the open sheet', () => {
    render(<HelpDrawer />);

    expect(screen.getByText(REPORTS_CHORD_LABEL.en)).toBeDefined();
    expect(screen.queryByText('Go to Reports')).toBeNull();
  });

  it('keeps the palette hint on the analytics door, not the empty library', () => {
    const targets = buildNavTargets(NAV_SECTIONS, {}, false);
    expect(targets.find((target) => target.to === '/analytics')?.hint).toBe('g r');
    expect(targets.find((target) => target.to === '/reports/list')?.hint).toBe('');
  });

  it('keeps every shipped catalog on the analytics label', () => {
    for (const [locale, label] of Object.entries(REPORTS_CHORD_LABEL)) {
      const catalog = JSON.parse(
        readFileSync(join(LOCALES, locale, 'common.json'), 'utf8'),
      ) as { helpDrawer: { goToReports: string } };
      expect(catalog.helpDrawer.goToReports).toBe(label);
    }
  });
});
